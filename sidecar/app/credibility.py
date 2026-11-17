"""Credibility + escalation scoring (D2) — rules over stored news/alerts.

Scores every stored alert cluster 0-100 with an explainable breakdown and
an escalation trend (Stabilizing / Elevated / Escalating). Rules first,
thresholds human-set: the numbers below are pinned constants, William sets
the final thresholds; this module only computes them.

The model is ConflictZone's credibility + escalation score, rebuilt as
auditable rules over our own stored records — no model call, no new
service, no external fetch. Input is a `news_alerts` row (as returned by
`news_ingest.latest_alerts` / `get_alert`): incident_key, severity, title,
first_seen / last_seen (SECOND epochs), source_count, sources (source ids),
urls.

Source tiers (the tier lists mirror `news_writer.AUTO_PUBLISH_SOURCE_IDS`:
official sources + the local-media summarize+link set; a test pins the
overlap so the two lists cannot drift silently):
  Tier 1 — official (base 90): NWS, county Alert Center / newsflash /
    news, FAA ground-stop feeds, prosecutor / police releases.
  Tier 2 — local media, summarize+link (base 70): the writer's media set.
  Tier 3 — aggregator / unvetted (base 40): any other ingested source id.

Blocked at ingest (never scored, never shown): RT, Sputnik, PressTV and
equivalents — the ConflictZone hard-block list. A cluster whose urls touch
a blocked domain is excluded from the feed, with the exclusion counted
and logged by the caller, never silent.

Scoring rules (all pinned, all shown in the breakdown):
  base  = highest tier base among the cluster's sources
  +10 per additional independent source beyond the first (cap +20)
  +5  when an official (tier 1) source confirms a media-first story
  -20 when the only source is tier 3
  -15 when a human has flagged the cluster's sources as disagreeing
      (`disputed=True`; v1 has no dispute flag yet — the parameter exists,
      the endpoint passes False, and a review-queue action is the
      follow-on that sets it. A score never claims a disagreement the
      store cannot show.)
  clamped to 0-100. No sources -> None (unscored, never a default 50).

Trend (v1, from the alert row only — the store has no per-item incident
link yet, so a true count-trend is a follow-on):
  Escalating: updated in the last 6 h AND >= 2 sources AND
    (first seen in the last 6 h OR severity critical/high)
  Elevated:   updated in the last 6 h AND
    (severity critical/high OR >= 2 sources)
  Stabilizing: anything else (no update in 6 h, or a single
    low-severity source).
"""

from __future__ import annotations

import time
from urllib.parse import urlparse

# ── Tiers ───────────────────────────────────────────────────────────────────
# Tier 1: official sources (base 90). Mirrors the official half of
# news_writer.AUTO_PUBLISH_SOURCE_IDS plus the review-only official
# releases (prosecutor / police — high tier for facts, still review-gated
# when they name defendants; the tier is about the source, the gate is
# about the content).
TIER1_OFFICIAL = frozenset(
    {
        "nws_mt_holly_alerts",
        "county_alerts",
        "county_news",
        "cmc_county",
        "gnews_faa_groundstop",
        "gnews_nj_airports_groundstop",
        "cmcpo_press",
        "capemay_pd",
    }
)

# Tier 2: local media, summarize+link (base 70). Exactly the media half of
# news_writer.AUTO_PUBLISH_SOURCE_IDS (see test_credibility_offline.py).
TIER2_MEDIA = frozenset(
    {
        "capemay_scanner",
        "seaisle_news",
        "ocnj_daily",
        "herald",
        "capemay_daily_ps",
        "espn973_capemay",
        "gnews_capemay",
        "gnews_wildwood",
        "gnews_pressofac",
        "gnews_6abc_capemay",
        "nj1015",
        "fox29",
        "abc6",
        "oc_sentinel",
    }
)

TIER_BASE = {1: 90, 2: 70, 3: 40}
TIER_LABELS = {1: "Official", 2: "Local media", 3: "Unvetted"}

# ── Blocked domains (hard block at ingest — ConflictZone's list) ──────────
# Human-curated; William may add domains. A cluster touching one is
# excluded from the feed, never scored.
BLOCKED_DOMAINS = frozenset(
    {
        "rt.com",
        "sputniknews.com",
        "presstv.ir",
    }
)

# ── Point values (pinned; William sets the final numbers) ─────────────────
CORROBORATION_PER_SOURCE = 10
CORROBORATION_CAP = 20
OFFICIAL_CONFIRMATION_BONUS = 5
SINGLE_UNVETTED_PENALTY = 20
DISPUTED_PENALTY = 15

TREND_WINDOW_S = 6 * 3600

_HIGH_SEVERITIES = frozenset({"critical", "high"})


def tier_of(source_id: str) -> int:
    """Tier (1/2/3) for a stored source id. Unknown ids are tier 3."""
    if source_id in TIER1_OFFICIAL:
        return 1
    if source_id in TIER2_MEDIA:
        return 2
    return 3


def blocked_urls(urls) -> list[str]:
    """Urls whose host (or parent domain) is on the blocked list."""
    out = []
    for url in urls or []:
        try:
            host = (urlparse(str(url)).hostname or "").lower()
        except Exception:
            continue
        if not host:
            continue
        if any(host == d or host.endswith("." + d) for d in BLOCKED_DOMAINS):
            out.append(str(url))
    return out


def score_sources(source_ids, urls=(), *, disputed: bool = False) -> dict | None:
    """Score one cluster's sources. Returns None when there is nothing to score.

    The returned dict carries the score plus its full working, so the panel
    can show why: { credibility, tier, tier_label, breakdown: [{rule,
    points}], sources, blocked: [...] }.
    """
    sources = sorted({str(s) for s in (source_ids or []) if str(s or "").strip()})
    if not sources:
        return None
    blocked = blocked_urls(urls)
    if blocked:
        return {
            "credibility": None,
            "tier": None,
            "tier_label": None,
            "breakdown": [{"rule": "blocked source — excluded", "points": 0}],
            "sources": sources,
            "blocked": blocked,
            "excluded": True,
        }
    tiers = [tier_of(s) for s in sources]
    top_tier = min(tiers)
    base = TIER_BASE[top_tier]
    breakdown = [
        {
            "rule": f"highest source tier: {TIER_LABELS[top_tier]}",
            "points": base,
        }
    ]
    score = base
    extra = len(sources) - 1
    if extra > 0:
        corroboration = min(extra * CORROBORATION_PER_SOURCE, CORROBORATION_CAP)
        breakdown.append(
            {"rule": f"corroborated by {extra} additional source(s)", "points": corroboration}
        )
        score += corroboration
    if top_tier == 1 and any(t == 2 for t in tiers):
        breakdown.append(
            {"rule": "official source confirms media-first story", "points": OFFICIAL_CONFIRMATION_BONUS}
        )
        score += OFFICIAL_CONFIRMATION_BONUS
    if len(sources) == 1 and top_tier == 3:
        breakdown.append(
            {"rule": "single unvetted source", "points": -SINGLE_UNVETTED_PENALTY}
        )
        score -= SINGLE_UNVETTED_PENALTY
    if disputed:
        breakdown.append(
            {"rule": "sources disagree on a material fact", "points": -DISPUTED_PENALTY}
        )
        score -= DISPUTED_PENALTY
    score = max(0, min(100, score))
    return {
        "credibility": score,
        "tier": top_tier,
        "tier_label": TIER_LABELS[top_tier],
        "breakdown": breakdown,
        "sources": sources,
        "blocked": [],
        "excluded": False,
    }


def trend_for_alert(alert: dict, now_s: int | None = None) -> str:
    """Escalation trend for one alert row (v1 rules — see module docstring)."""
    now_s = int(now_s if now_s is not None else time.time())
    try:
        last_seen = int(alert.get("last_seen") or 0)
    except (TypeError, ValueError):
        last_seen = 0
    try:
        first_seen = int(alert.get("first_seen") or 0)
    except (TypeError, ValueError):
        first_seen = 0
    try:
        source_count = int(alert.get("source_count") or len(alert.get("sources") or []))
    except (TypeError, ValueError):
        source_count = 0
    severity = str(alert.get("severity") or "").strip().lower()
    updated_recently = last_seen > 0 and (now_s - last_seen) <= TREND_WINDOW_S
    first_recently = first_seen > 0 and (now_s - first_seen) <= TREND_WINDOW_S
    if (
        updated_recently
        and source_count >= 2
        and (first_recently or severity in _HIGH_SEVERITIES)
    ):
        return "Escalating"
    if updated_recently and (
        severity in _HIGH_SEVERITIES or source_count >= 2
    ):
        return "Elevated"
    return "Stabilizing"


def score_alert(alert: dict, now_s: int | None = None) -> dict | None:
    """Score one `news_alerts` row. Returns None when the row has no sources.

    Returns the alert dict plus credibility fields (the alert's own fields
    are kept verbatim — the score is added, the record is not rewritten).
    """
    if not alert:
        return None
    scored = score_sources(alert.get("sources"), alert.get("urls"))
    if scored is None:
        return None
    out = dict(alert)
    out.update(scored)
    out["trend"] = trend_for_alert(alert, now_s)
    return out
