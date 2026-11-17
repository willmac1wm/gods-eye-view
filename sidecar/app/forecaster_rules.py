"""Forecaster rules (D1). Pure: numbers first, LLM second.

The county's causal chains are RULES first — these functions compute the
prediction (text, confidence, exact sources, what would change it); the
LLM only drafts the plain-English version, and the rule checks the
numbers before anything is stored. No rule ever invents a position, a
road name, or an intent:

- flood: tide + NWS coastal-flood alert. Road names come only from the
  county fact table; when the fact is not curated the text says so.
- outage: lightning + severe-thunderstorm warning + past outage counts.
- mil-surge: an ADS-B pattern note, NOT a prediction of intent — it says
  how often this pattern appeared in stored history and stops there.

Every rule returns None when its inputs do not fire, or a dict with
{ rule_id, text, confidence, source_record_ids, what_would_change_it,
  valid_until_ms }. Outcome checkers are pure too: they read the stored
follow-up (CAD/fire dispatch items, tide/outage series) and return
'confirmed', 'wrong', or None (uncheckable — stays open, never silently
marked confirmed).
"""
from __future__ import annotations

from typing import Any

FLOOD_RULE_ID = "flood-noreaster"
OUTAGE_RULE_ID = "outage-thunderstorm"
MIL_SURGE_RULE_ID = "mil-surge-pattern"

# The flood rule fires when the tide is within this far of the minor-flood
# threshold AND rising AND a coastal-flood alert is active.
FLOOD_WARN_WITHIN_FT = 1.0
FLOOD_FAST_RISE_FT_PER_H = 0.5


def _coastal_flood_active(nws_alerts: list[dict[str, Any]]) -> bool:
    for alert in nws_alerts or []:
        event = str(alert.get("event") or "")
        if "coastal flood" in event.lower():
            return True
    return False


def _severe_thunderstorm_active(nws_alerts: list[dict[str, Any]]) -> bool:
    for alert in nws_alerts or []:
        event = str(alert.get("event") or "")
        if "severe thunderstorm" in event.lower():
            return True
    return False


def evaluate_flood_rule(
    *,
    nws_alerts: list[dict[str, Any]],
    tide_now_ft: float | None,
    tide_prev_ft: float | None,
    tide_now_ms: int,
    facts: dict[str, Any],
) -> dict[str, Any] | None:
    """Nor'easter → flooding → closures. Fires on an active coastal-flood
    alert with the Cape May tide rising toward the minor-flood threshold."""
    if tide_now_ft is None or tide_prev_ft is None:
        return None
    if not _coastal_flood_active(nws_alerts):
        return None
    threshold = facts.get("nws_minor_flood_ft")
    if not isinstance(threshold, (int, float)):
        return None
    rise = tide_now_ft - tide_prev_ft
    if rise <= 0:
        return None
    if tide_now_ft < threshold - FLOOD_WARN_WITHIN_FT:
        return None
    roads = facts.get("first_flood_roads")
    roads_text = (
        f"expect the usual first closures at {roads}"
        if isinstance(roads, str) and roads.strip()
        else "the usual first-flood roads are not yet curated in the county fact table"
    )
    confidence = 0.7
    if rise >= FLOOD_FAST_RISE_FT_PER_H:
        confidence = 0.8
    alert_ids = [
        f"news_alert:{a.get('incident_key')}"
        for a in (nws_alerts or [])
        if "coastal flood" in str(a.get("event") or "").lower()
        and a.get("incident_key")
    ]
    return {
        "rule_id": FLOOD_RULE_ID,
        "text": (
            f"Water over the usual first-flood roads by the next high tide "
            f"(tide {tide_now_ft:.2f} ft and rising {rise:.2f} ft/hr toward the "
            f"{threshold:.2f} ft minor-flood threshold); {roads_text}. "
            f"Confidence {confidence:.2f}."
        ),
        "confidence": confidence,
        "source_record_ids": alert_ids
        + ["snapshot:tides:8536110", "fact:nws_minor_flood_ft"],
        "what_would_change_it": (
            "Confidence would rise if the next tide reading confirms the curve; "
            "it would fall if winds shift offshore or the tide turns before "
            f"{threshold:.2f} ft."
        ),
        "valid_until_ms": tide_now_ms + 6 * 3600 * 1000,
    }


def evaluate_outage_rule(
    *,
    lightning_flash: bool,
    nws_alerts: list[dict[str, Any]],
    outage_now: int | None,
    outage_last_storm_max: int | None,
    now_ms: int,
) -> dict[str, Any] | None:
    """Thunderstorm → lightning + outages. Fires on a first county flash
    with a severe-thunderstorm warning active."""
    if not lightning_flash:
        return None
    if not _severe_thunderstorm_active(nws_alerts):
        return None
    confidence = 0.6
    if (outage_now or 0) > 0:
        confidence = 0.7
    last = (
        f"the last similar storm knocked out {outage_last_storm_max} ACE customers"
        if isinstance(outage_last_storm_max, int)
        else "no past-storm outage count is stored yet"
    )
    return {
        "rule_id": OUTAGE_RULE_ID,
        "text": (
            "Outages likely in Cape May County within the next hour "
            f"(first county lightning flash + severe thunderstorm warning); {last}."
        ),
        "confidence": confidence,
        "source_record_ids": ["snapshot:lightning", "snapshot:outages:34009"],
        "what_would_change_it": (
            "Confidence would rise if the outage count climbs in the next 15 minutes; "
            "it would fall if the storm cell passes without a flash in the next hour."
        ),
        "valid_until_ms": now_ms + 2 * 3600 * 1000,
    }


def evaluate_mil_surge_rule(
    *,
    mil_count_1h: int,
    mil_median_30d: float | None,
    spike_hours_30d: int | None,
    now_ms: int,
) -> dict[str, Any] | None:
    """Military flight surge — a PATTERN note, never a prediction of intent.
    Fires when the last hour's military ADS-B count is >= 3x the 30-day
    median (and at least 3 aircraft). The output says how often this
    pattern appeared in stored history and stops there."""
    if mil_median_30d is None:
        return None
    threshold = max(3, 3 * mil_median_30d)
    if mil_count_1h < threshold:
        return None
    ratio = mil_count_1h / mil_median_30d if mil_median_30d else float(mil_count_1h)
    history = (
        f"This pattern has appeared {spike_hours_30d} times in our stored history."
        if isinstance(spike_hours_30d, int)
        else "No stored history of this pattern yet."
    )
    return {
        "rule_id": MIL_SURGE_RULE_ID,
        "text": (
            f"Military flight activity is {ratio:.1f}x the 30-day median this hour "
            f"({mil_count_1h} military aircraft tracked). {history} "
            "This is a pattern note, not a prediction of intent."
        ),
        "confidence": 0.5,
        "source_record_ids": ["snapshot:aircraft:mil"],
        "what_would_change_it": (
            "This note stands while the count stays above the threshold; "
            "it lapses when the count drops back to the median."
        ),
        "valid_until_ms": now_ms + 6 * 3600 * 1000,
    }


def check_flood_outcome(
    *,
    tide_max_ft: float | None,
    threshold_ft: float | None,
    flood_mentions: int,
) -> str | None:
    """Outcome of a flood prediction: 'confirmed' when the tide reached the
    threshold or CAD/fire dispatch mentioned flooding in the window;
    'wrong' when the tide never got within 0.5 ft of the threshold AND
    nothing mentioned flooding; None when the evidence is missing."""
    if tide_max_ft is None and flood_mentions == 0:
        return None
    if flood_mentions > 0:
        return "confirmed"
    if threshold_ft is not None and tide_max_ft is not None:
        if tide_max_ft >= threshold_ft:
            return "confirmed"
        if tide_max_ft < threshold_ft - 0.5:
            return "wrong"
    return None


def check_outage_outcome(
    *,
    outage_at_prediction: int | None,
    outage_max_in_window: int | None,
) -> str | None:
    """Outcome of an outage prediction: 'confirmed' on a clear rise
    (>= 2x or +10 customers), 'wrong' when the count never rose at all,
    None when the evidence is missing or the rise is too small to call."""
    if outage_at_prediction is None or outage_max_in_window is None:
        return None
    if outage_max_in_window <= outage_at_prediction:
        return "wrong"
    if outage_max_in_window >= max(
        outage_at_prediction * 2, outage_at_prediction + 10
    ):
        return "confirmed"
    return None
