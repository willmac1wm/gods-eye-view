"""story_link.py — Link news items to dispatch incidents (story posts).

Phase 2 of the "story" vision (news_ingest.py is phase 1): given news items
(from news_ingest.latest()) and incidents (from Fire Wire's /api/incidents),
attach the incidents each article is probably about, so the /news page can
render story posts — the article together with matching dispatch audio and
the map pin.

Pure functions, stdlib only: no network, no DB. The Dispatch app fetches both
lists and calls link_news_to_incidents(); the /news template renders the
"related" attachments. Never raises.

Matching signals (weighted):
  - location: a Cape May County place name appearing in both (+3)
  - incident type keyword: fire/crash/arrest/etc. in both (+2)
  - unit or agency mention overlap (+1)
  - recency: incidents closer in time to the article rank higher (tiebreak)

Only incidents within ±window_hours of the article's pub date are considered.
"""
from __future__ import annotations

import re
from typing import Any

# ── Cape May County place gazetteer ─────────────────────────────────────────
# Keep lowercase; matched as whole words against news text and incident fields.
PLACES = [
    "wildwood", "north wildwood", "wildwood crest", "west wildwood",
    "cape may", "west cape may", "cape may point", "cape may court house",
    "ocean city", "sea isle city", "avalon", "stone harbor",
    "middle township", "lower township", "dennis township", "upper township",
    "woodbine", "dias creek", "goshen", "green creek", "town bank",
    "villias", "north cape may", "ermont", "rio grande", "cape may county",
    "delaware bay", "hereford inlet", "townsend inlet",
]

# incident_type -> keywords likely to appear in news headlines about it
TYPE_KEYWORDS: dict[str, list[str]] = {
    "fire": ["fire", "blaze", "burning", "smoke", "arson"],
    "ems": ["ems", "ambulance", "medical", "overdose", "injured", "hospital"],
    "police": ["police", "arrest", "shooting", "stabbing", "robbery", "burglary",
               "assault", "crash", "dui", "warrant", "swat"],
    "crash": ["crash", "collision", "accident", "overturned", "pileup",
              "struck", "hit-and-run"],
    "marine": ["boat", "boating", "drowning", "water rescue", "coast guard"],
    "weather": ["flood", "flooding", "storm", "nor'easter", "noreaster",
                "hurricane", "tornado", "erosion"],
}

_SCORE_LOCATION = 3.0
_SCORE_TYPE = 2.0
_SCORE_UNIT = 1.0


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9']+", (text or "").lower()))


def _find_places(text: str) -> set[str]:
    low = (text or "").lower()
    found = set()
    for place in PLACES:
        # whole-word match so "cape may" doesn't hit inside other words
        if re.search(rf"(?<![a-z]){re.escape(place)}(?![a-z])", low):
            found.add(place)
    return found


def _incident_text(inc: dict[str, Any]) -> str:
    """All searchable text for an incident."""
    parts = [
        str(inc.get("incident_type") or ""),
        str(inc.get("title") or ""),
        str(inc.get("summary") or ""),
        str(inc.get("location_text") or ""),
        str(inc.get("address") or ""),
        str(inc.get("units") or ""),
        str(inc.get("agency") or ""),
    ]
    tx = inc.get("transmissions") or inc.get("transcripts") or []
    if isinstance(tx, list):
        for t in tx[:5]:
            if isinstance(t, dict):
                parts.append(str(t.get("transcript_clean") or t.get("text") or ""))
            else:
                parts.append(str(t))
    return " ".join(parts)


def _score(news_text: str, news_words: set[str], inc: dict[str, Any]) -> float:
    """Match score between one news item and one incident."""
    itext = _incident_text(inc)
    iwords = _words(itext)

    score = 0.0
    # Shared place names are the strongest signal.
    if _find_places(news_text) & _find_places(itext):
        score += _SCORE_LOCATION
    # Incident-type keywords.
    itype = str(inc.get("incident_type") or "").lower()
    keywords = TYPE_KEYWORDS.get(itype, [])
    if any(k in news_words for k in keywords):
        score += _SCORE_TYPE
    else:
        # Fallback: any type keyword from any category appearing in both.
        for kws in TYPE_KEYWORDS.values():
            if any(k in news_words and k in iwords for k in kws):
                score += _SCORE_TYPE / 2
                break
    # Unit / agency token overlap (e.g. "station 3", "wildwood fire").
    units = _words(str(inc.get("units") or "") + " " + str(inc.get("agency") or ""))
    units -= {"fire", "police", "ems", "department", "dept"}  # too generic alone
    if units & news_words:
        score += _SCORE_UNIT
    return score


def _pub_ms(item: dict[str, Any]) -> int:
    try:
        return int(item.get("pub_ms") or 0)
    except (TypeError, ValueError):
        return 0


def _incident_ms(inc: dict[str, Any]) -> int:
    for key in ("created_at_ms", "start_ms", "occurred_ms"):
        try:
            v = int(inc.get(key) or 0)
            if v:
                return v
        except (TypeError, ValueError):
            continue
    return 0


def link_news_to_incidents(
    news_items: list[dict[str, Any]],
    incidents: list[dict[str, Any]],
    window_hours: float = 72,
    min_score: float = 2.0,
    max_related: int = 3,
) -> list[dict[str, Any]]:
    """Attach related incidents to each news item.

    Returns new dicts (inputs untouched); each gains a "related" list of
    incident dicts sorted by score desc, then time proximity. Never raises.
    """
    window_ms = int(window_hours * 3600 * 1000)
    out: list[dict[str, Any]] = []
    for news in news_items or []:
        try:
            nms = _pub_ms(news)
            ntext = f"{news.get('title', '')} {news.get('summary', '')}"
            nwords = _words(ntext)
            scored: list[tuple[float, int, dict[str, Any]]] = []
            for inc in incidents or []:
                ims = _incident_ms(inc)
                if nms and ims and abs(nms - ims) > window_ms:
                    continue
                s = _score(ntext, nwords, inc)
                if s >= min_score:
                    # tiebreak: closer in time ranks higher
                    gap = abs(nms - ims) if (nms and ims) else window_ms
                    scored.append((s, -gap, inc))
            scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
            related = [dict(inc) for _, _, inc in scored[:max_related]]
            merged = dict(news)
            merged["related"] = related
            merged["related_count"] = len(related)
            out.append(merged)
        except Exception:
            merged = dict(news)
            merged["related"] = []
            merged["related_count"] = 0
            out.append(merged)
    return out
