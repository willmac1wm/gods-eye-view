"""Daily brief (D5) — the blog writer pointed at the day, not one story.

Once a day at 07:00 local (and once more within 15 minutes of a critical
alert) the writer synthesizes the last 24 h of stored items + alerts
into one brief: What happened / Still active / What to watch. The brief
is a `news_posts` row with `topic_key='daily-brief'` (category Blog), so
it appears on /news + /blog + the daily-brief layer with no new surface.

The gate is the blog-writer gate, reused verbatim — this module never
reimplements it: `news_writer.write_post` (with a brief prompt),
`news_writer.decide_gate`, `news_writer.validate_post`. A brief that
names a person, cites a review-only source, or scores under 0.75 goes
to the review queue like any post. With no GEMINI_API_KEY nothing is
generated and nothing crashes (the main.py loop is inert).

A brief older than 24 h is stale by the layer's clock, not by the
store — the store keeps the last brief until a new one replaces it.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

log = logging.getLogger("cape_dispatch.daily_brief")

BRIEF_TOPIC_KEY = "daily-brief"
BRIEF_CATEGORY = "Blog"
BRIEF_WINDOW_HOURS = 24
BRIEF_DAILY_HOUR_LOCAL = 7
BRIEF_LOCAL_TZ = "America/New_York"
BRIEF_CRITICAL_WINDOW_MIN = 15
BRIEF_SECTIONS = ("What happened", "Still active", "What to watch")


def brief_slug_for(day: date) -> str:
    """daily-brief-YYYY-MM-DD for a local date."""
    return f"daily-brief-{day.isoformat()}"


def local_today(now_s: float | None = None) -> date:
    """Local (America/New_York) date for an epoch time."""
    now = datetime.fromtimestamp(
        float(now_s) if now_s is not None else time.time(),
        tz=ZoneInfo(BRIEF_LOCAL_TZ),
    )
    return now.date()


def brief_headline_for(day: date) -> str:
    """Cape May County — Daily Brief, Nov. 17, 2026."""
    return f"Cape May County — Daily Brief, {day.strftime('%b. %d, %Y')}"


def alert_to_gate_items(alert: dict[str, Any]) -> list[dict[str, Any]]:
    """One gate item per source id of an alert.

    The gate checks the SET of source ids, so a review-only source hiding
    in an alert's second source must still force review. The prompt gets
    one brief per alert instead (see _alert_brief).
    """
    sources = alert.get("sources") or []
    if not sources:
        sources = [""]
    urls = alert.get("urls") or []
    url = str(urls[0]) if urls else ""
    published = ""
    last_seen = alert.get("last_seen")
    if last_seen:
        try:
            published = datetime.fromtimestamp(
                float(last_seen), tz=ZoneInfo(BRIEF_LOCAL_TZ)
            ).isoformat()
        except (TypeError, ValueError, OSError):
            published = ""
    return [
        {
            "source_id": str(source_id),
            "source_name": str(source_id),
            "title": str(alert.get("title") or ""),
            "summary": str(alert.get("summary") or ""),
            "url": url,
            "published": published,
        }
        for source_id in sources
    ]


def _alert_brief(alert: dict[str, Any]) -> str:
    urls = alert.get("urls") or []
    return (
        f"- [ALERT {str(alert.get('severity') or '').upper()}] "
        f"{alert.get('title') or ''}\n"
        f"  {alert.get('summary') or ''}\n"
        f"  URL: {str(urls[0]) if urls else ''} | "
        f"Sources: {', '.join(str(s) for s in (alert.get('sources') or []))}"
    )


def build_brief_prompt(
    items: list[dict[str, Any]],
    alerts: list[dict[str, Any]],
    *,
    brief_date: date,
) -> str:
    """House-style prompt for one day's brief (WRITER_SYSTEM + brief rules)."""
    # Late import: the writer owns the house style; the brief adds its shape.
    from app import news_writer

    parts = [news_writer.WRITER_SYSTEM]
    parts.append(
        f"Write the Cape May County daily brief for {brief_date.strftime('%B %d, %Y')}.\n"
        f"Headline: \"{brief_headline_for(brief_date)}\". Category: Blog. "
        "Municipality: CAPE MAY COURT HOUSE.\n"
        "Body: a lede (25–30 words, never over 35), then exactly three "
        "sections with markdown headings, in this order:\n"
        "## What happened\n## Still active\n## What to watch\n"
        "Each section is 1–3 short paragraphs. Every factual paragraph "
        "must contain an attribution phrase (the headings themselves need "
        "none). \"What to watch\" may only state what a source states — "
        "warning end times, scheduled items, conditions a source says are "
        "coming. Never invent a forecast, never name an individual: if a "
        "source names someone, summarize without the name and set "
        "contains_named_individuals to true so the brief goes to review.\n"
        "If there is no source material at all, write a short quiet-day "
        "brief saying so, with confidence 0.75, and end with "
        "\"Sources: No new items in the last 24 hours.\"\n"
        "image_plan: {\"kind\": \"none\"} — a brief has no single image."
    )
    if items or alerts:
        parts.append("Source material from the last 24 hours (do not copy sentences from these):")
        parts.extend(news_writer._item_brief(it) for it in items)
        parts.extend(_alert_brief(a) for a in alerts)
    else:
        parts.append("Source material: none — nothing new in the last 24 hours.")
    return "\n\n".join(parts)


def should_generate_brief(
    *,
    now_s: float,
    today_brief: dict[str, Any] | None,
    latest_brief: dict[str, Any] | None,
    critical_alerts: list[dict[str, Any]],
) -> tuple[str | None, str]:
    """Pure trigger decision. Returns (trigger, reason).

    trigger is 'daily' | 'critical' | None.
    - 'critical': a critical alert fired after the latest brief was
      written (within the caller's recency window) — write an update.
    - 'daily': it is 07:00 local or later and there is no daily brief
      yet, or the day's brief was written before 07:00 (a pre-dawn
      critical brief) and deserves a fresh morning edition.
    - None: nothing to do (too early, or the brief is already current).
    """
    now_local = datetime.fromtimestamp(now_s, tz=ZoneInfo(BRIEF_LOCAL_TZ))
    morning = now_local.replace(
        hour=BRIEF_DAILY_HOUR_LOCAL, minute=0, second=0, microsecond=0
    )
    morning_s = morning.timestamp()

    if critical_alerts:
        latest_seen = max(
            float(a.get("last_seen") or 0) for a in critical_alerts
        )
        latest_updated = None
        if latest_brief is not None:
            latest_updated = latest_brief.get("updated_at") or latest_brief.get("published_at")
        if latest_updated is None or float(latest_updated) < latest_seen:
            return "critical", "critical alert fired after the latest brief"
    if today_brief is None:
        if now_s >= morning_s:
            return "daily", "no brief for today yet and it is past 07:00 local"
        return None, "before 07:00 local and no brief yet"
    updated = today_brief.get("updated_at") or today_brief.get("published_at")
    if updated is not None and float(updated) < morning_s:
        return "daily", "today's brief predates 07:00 local (pre-dawn critical brief)"
    return None, "today's brief is current"


def generate_brief(
    *,
    items: list[dict[str, Any]],
    alerts: list[dict[str, Any]],
    api_key: str | None = None,
    model: str | None = None,
    transport: Any | None = None,
    db_path: Any | None = None,
    brief_date: date | None = None,
    now_s: float | None = None,
) -> dict[str, Any]:
    """Write one brief through the writer gate and store it.

    Returns the stored post dict (with status + gate_reasons). Raises
    RuntimeError if the Gemini call fails — nothing is stored then.
    A critical update attaches to today's daily brief as its parent
    (headline prefixed UPDATE:); a morning brief stands alone.
    """
    # Late imports: news_blog owns the store; the writer owns the pipeline.
    from app import news_blog, news_writer

    day = brief_date or local_today(now_s)
    slug = brief_slug_for(day)
    existing = news_blog.get_post_by_slug(slug, db_path=db_path)
    is_update = existing is not None
    gate_items: list[dict[str, Any]] = list(items)
    for alert in alerts:
        gate_items.extend(alert_to_gate_items(alert))
    prompt = build_brief_prompt(items, alerts, brief_date=day)
    draft, errors = news_writer.write_post(
        gate_items,
        api_key=api_key,
        model=model,
        transport=transport,
        prompt=prompt,
    )
    headline = brief_headline_for(day)
    if is_update:
        headline = "UPDATE: " + headline
    status, reasons = news_writer.decide_gate(
        draft, gate_items, validation_errors=errors
    )
    post = news_blog.create_post(
        {
            "slug": None if is_update else slug,
            "topic_key": BRIEF_TOPIC_KEY,
            "parent_id": existing.get("id") if is_update else None,
            "status": status,
            "category": BRIEF_CATEGORY,
            "municipality": "CAPE MAY COURT HOUSE",
            "headline": headline,
            "dek": draft.get("dek") or "",
            "dateline": draft.get("dateline") or "",
            "body_md": draft.get("body_md") or "",
            "lead_image_url": None,
            "lead_image_alt": "",
            "lead_image_credit": "",
            "lead_image_source_url": "",
            "sources": draft.get("sources") or [],
            "lat": None,
            "lon": None,
            "is_update": is_update,
            "confidence": draft.get("confidence"),
            "contains_named_individuals": bool(
                draft.get("contains_named_individuals")
            ),
            "gate_reasons": reasons,
            "author": "Cape Dispatch Desk",
        },
        db_path=db_path,
    )
    guids = [
        str(it.get("id") or it.get("url") or "")
        for it in gate_items
    ]
    news_blog.attach_sources(
        post["id"], [g for g in guids if g], db_path=db_path
    )
    post["gate_reasons"] = reasons
    log.info(
        "daily_brief: %s %s (%s)",
        "update" if is_update else "brief",
        post.get("slug"),
        status,
    )
    return post
