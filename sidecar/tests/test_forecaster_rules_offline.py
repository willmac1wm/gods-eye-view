"""Forecaster rules (D1, app/forecaster_rules.py). Pure, no network, no key.

Covers: the flood rule fires only on an active coastal-flood alert with a
rising tide near the threshold (and never invents road names — the fact
table supplies them or the text says they are not curated); the outage
rule fires only on a first flash + severe-thunderstorm warning; the
mil-surge rule is a pattern note, never a prediction of intent; the
outcome checkers mark confirmed/wrong from fixture follow-ups and return
None (uncheckable — stays open) when the evidence is missing.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import forecaster_rules as R  # noqa: E402

NOW = 1794800000000
HOUR = 3600 * 1000

FLOOD_ALERTS = [
    {"incident_key": "nws-coastal-1", "event": "Coastal Flood Warning", "severity": "Severe"},
]
FACTS = {"nws_minor_flood_ft": 6.2, "first_flood_roads": "Ocean Ave, Beach Ave"}


def test_flood_rule_fires_with_rising_tide_near_threshold():
    pred = R.evaluate_flood_rule(
        nws_alerts=FLOOD_ALERTS,
        tide_now_ft=5.8,
        tide_prev_ft=5.4,
        tide_now_ms=NOW,
        facts=FACTS,
    )
    assert pred is not None
    assert pred["rule_id"] == "flood-noreaster"
    assert pred["confidence"] == 0.7
    assert "Ocean Ave" in pred["text"]
    assert "5.80 ft" in pred["text"]
    assert "news_alert:nws-coastal-1" in pred["source_record_ids"]
    assert "fact:nws_minor_flood_ft" in pred["source_record_ids"]
    assert "would rise" in pred["what_would_change_it"]
    assert pred["valid_until_ms"] == NOW + 6 * HOUR


def test_flood_rule_fast_rise_raises_confidence():
    pred = R.evaluate_flood_rule(
        nws_alerts=FLOOD_ALERTS,
        tide_now_ft=5.9,
        tide_prev_ft=5.3,
        tide_now_ms=NOW,
        facts=FACTS,
    )
    assert pred["confidence"] == 0.8


def test_flood_rule_never_invents_road_names():
    pred = R.evaluate_flood_rule(
        nws_alerts=FLOOD_ALERTS,
        tide_now_ft=5.8,
        tide_prev_ft=5.4,
        tide_now_ms=NOW,
        facts={"nws_minor_flood_ft": 6.2},
    )
    assert pred is not None
    assert "not yet curated" in pred["text"]
    assert "Ocean Ave" not in pred["text"]


def test_flood_rule_does_not_fire_without_alert_falling_tide_or_low_tide():
    assert (
        R.evaluate_flood_rule(
            nws_alerts=[{"incident_key": "x", "event": "Freeze Warning"}],
            tide_now_ft=5.8,
            tide_prev_ft=5.4,
            tide_now_ms=NOW,
            facts=FACTS,
        )
        is None
    )
    assert (
        R.evaluate_flood_rule(
            nws_alerts=FLOOD_ALERTS,
            tide_now_ft=5.4,
            tide_prev_ft=5.8,
            tide_now_ms=NOW,
            facts=FACTS,
        )
        is None
    )
    assert (
        R.evaluate_flood_rule(
            nws_alerts=FLOOD_ALERTS,
            tide_now_ft=4.0,
            tide_prev_ft=3.8,
            tide_now_ms=NOW,
            facts=FACTS,
        )
        is None
    )
    assert (
        R.evaluate_flood_rule(
            nws_alerts=FLOOD_ALERTS,
            tide_now_ft=5.8,
            tide_prev_ft=5.4,
            tide_now_ms=NOW,
            facts={},
        )
        is None
    )


def test_outage_rule_fires_on_flash_plus_warning():
    pred = R.evaluate_outage_rule(
        lightning_flash=True,
        nws_alerts=[{"event": "Severe Thunderstorm Warning"}],
        outage_now=0,
        outage_last_storm_max=1200,
        now_ms=NOW,
    )
    assert pred is not None
    assert pred["rule_id"] == "outage-thunderstorm"
    assert pred["confidence"] == 0.6
    assert "1200 ACE customers" in pred["text"]
    assert pred["valid_until_ms"] == NOW + 2 * HOUR


def test_outage_rule_confidence_rises_when_customers_already_out():
    pred = R.evaluate_outage_rule(
        lightning_flash=True,
        nws_alerts=[{"event": "Severe Thunderstorm Warning"}],
        outage_now=45,
        outage_last_storm_max=None,
        now_ms=NOW,
    )
    assert pred["confidence"] == 0.7
    assert "no past-storm outage count is stored yet" in pred["text"]


def test_outage_rule_does_not_fire_without_flash_or_warning():
    assert (
        R.evaluate_outage_rule(
            lightning_flash=False,
            nws_alerts=[{"event": "Severe Thunderstorm Warning"}],
            outage_now=0,
            outage_last_storm_max=100,
            now_ms=NOW,
        )
        is None
    )
    assert (
        R.evaluate_outage_rule(
            lightning_flash=True,
            nws_alerts=[{"event": "Freeze Warning"}],
            outage_now=0,
            outage_last_storm_max=100,
            now_ms=NOW,
        )
        is None
    )


def test_mil_surge_rule_is_a_pattern_note_not_intent():
    pred = R.evaluate_mil_surge_rule(
        mil_count_1h=9,
        mil_median_30d=2.0,
        spike_hours_30d=4,
        now_ms=NOW,
    )
    assert pred is not None
    assert pred["rule_id"] == "mil-surge-pattern"
    assert pred["confidence"] == 0.5
    assert "pattern note, not a prediction of intent" in pred["text"]
    assert "appeared 4 times" in pred["text"]
    assert "4.5x" in pred["text"]


def test_mil_surge_rule_does_not_fire_below_threshold():
    assert (
        R.evaluate_mil_surge_rule(
            mil_count_1h=5, mil_median_30d=2.0, spike_hours_30d=4, now_ms=NOW
        )
        is None
    )
    assert (
        R.evaluate_mil_surge_rule(
            mil_count_1h=9, mil_median_30d=None, spike_hours_30d=4, now_ms=NOW
        )
        is None
    )


def test_flood_outcome_confirmed_by_tide_or_mention():
    assert (
        R.check_flood_outcome(tide_max_ft=6.4, threshold_ft=6.2, flood_mentions=0)
        == "confirmed"
    )
    assert (
        R.check_flood_outcome(tide_max_ft=5.0, threshold_ft=6.2, flood_mentions=2)
        == "confirmed"
    )


def test_flood_outcome_wrong_when_tide_never_came_close():
    assert (
        R.check_flood_outcome(tide_max_ft=5.5, threshold_ft=6.2, flood_mentions=0)
        == "wrong"
    )


def test_flood_outcome_uncheckable_when_evidence_missing_or_borderline():
    assert R.check_flood_outcome(tide_max_ft=None, threshold_ft=6.2, flood_mentions=0) is None
    assert (
        R.check_flood_outcome(tide_max_ft=6.0, threshold_ft=6.2, flood_mentions=0)
        is None
    )


def test_outage_outcome_confirmed_on_clear_rise_wrong_on_flat():
    assert (
        R.check_outage_outcome(outage_at_prediction=0, outage_max_in_window=50)
        == "confirmed"
    )
    assert (
        R.check_outage_outcome(outage_at_prediction=100, outage_max_in_window=100)
        == "wrong"
    )
    assert (
        R.check_outage_outcome(outage_at_prediction=100, outage_max_in_window=105)
        is None
    )
    assert R.check_outage_outcome(outage_at_prediction=None, outage_max_in_window=50) is None
