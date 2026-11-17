"""Credibility + escalation scoring (D2, app/credibility.py). No network.

Covers: tier bases (official 90 / media 70 / unvetted 40), corroboration
(+10 per extra source, cap +20), official-confirmation bonus (+5),
single-unvetted penalty (-20), disputed penalty (-15, human flag),
blocked-domain exclusion (RT / Sputnik / PressTV), the tier lists' overlap
with news_writer's auto-publish sets (they must not drift silently),
trend transitions (Escalating / Elevated / Stabilizing), and clamping.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import credibility, news_writer


def test_official_only_scores_90():
    scored = credibility.score_sources(["nws_mt_holly_alerts"])
    assert scored["credibility"] == 90
    assert scored["tier"] == 1
    assert scored["tier_label"] == "Official"
    assert scored["excluded"] is False


def test_media_only_scores_70():
    scored = credibility.score_sources(["capemay_scanner"])
    assert scored["credibility"] == 70
    assert scored["tier"] == 2


def test_unknown_source_is_tier3_at_40_then_single_penalty():
    # Unknown id -> tier 3 base 40, single unvetted source -> -20 = 20.
    scored = credibility.score_sources(["some_new_aggregator"])
    assert scored["credibility"] == 20
    assert scored["tier"] == 3
    assert scored["tier_label"] == "Unvetted"


def test_no_sources_is_unscored_not_default_50():
    assert credibility.score_sources([]) is None
    assert credibility.score_sources(None) is None


def test_corroboration_adds_10_per_source_capped_at_20():
    # Official + 1 media = 90 + 10 + 5 (official confirms) = 105 -> clamp 100.
    scored = credibility.score_sources(
        ["nws_mt_holly_alerts", "capemay_scanner"]
    )
    assert scored["credibility"] == 100
    # Media + 2 more media = 70 + 20 (cap) = 90, no official bonus.
    scored = credibility.score_sources(
        ["capemay_scanner", "herald", "ocnj_daily"]
    )
    assert scored["credibility"] == 90
    # Media + 4 more media still caps at +20.
    scored = credibility.score_sources(
        ["capemay_scanner", "herald", "ocnj_daily", "nj1015", "fox29"]
    )
    assert scored["credibility"] == 90


def test_official_confirmation_bonus_only_with_media_present():
    scored = credibility.score_sources(
        ["nws_mt_holly_alerts", "county_alerts"]
    )
    # 90 + 10 corroboration, no media -> no +5.
    assert scored["credibility"] == 100
    assert all("confirms" not in b["rule"] for b in scored["breakdown"])


def test_disputed_penalty_is_human_flagged():
    scored = credibility.score_sources(
        ["nws_mt_holly_alerts", "capemay_scanner"], disputed=True
    )
    # 90 + 10 + 5 - 15 = 90.
    assert scored["credibility"] == 90
    assert any(b["points"] == -15 for b in scored["breakdown"])
    clean = credibility.score_sources(
        ["nws_mt_holly_alerts", "capemay_scanner"], disputed=False
    )
    assert clean["credibility"] == 100


def test_blocked_domain_excludes_the_cluster():
    scored = credibility.score_sources(
        ["nws_mt_holly_alerts"],
        urls=["https://www.rt.com/news/example"],
    )
    assert scored["excluded"] is True
    assert scored["credibility"] is None
    assert scored["blocked"] == ["https://www.rt.com/news/example"]
    # Subdomains count too; unrelated domains do not.
    assert credibility.score_sources(
        ["capemay_scanner"], urls=["https://subdomain.sputniknews.com/x"]
    )["excluded"] is True
    assert credibility.score_sources(
        ["capemay_scanner"], urls=["https://example.com/press-release"]
    )["excluded"] is False


def test_tier_lists_match_news_writer_auto_publish_sets():
    # The media tier must stay exactly the writer's media set, and the
    # official tier must contain the writer's official set — otherwise the
    # score and the gate disagree about what a source is.
    official_in_writer = {
        "nws_mt_holly_alerts",
        "county_alerts",
        "county_news",
        "cmc_county",
        "gnews_faa_groundstop",
        "gnews_nj_airports_groundstop",
    }
    assert official_in_writer <= credibility.TIER1_OFFICIAL
    assert official_in_writer <= news_writer.AUTO_PUBLISH_SOURCE_IDS
    media_in_writer = set(news_writer.AUTO_PUBLISH_SOURCE_IDS) - official_in_writer
    assert credibility.TIER2_MEDIA == media_in_writer


def _alert(**overrides):
    now = 1794800000
    alert = {
        "incident_key": "test-incident",
        "rule_id": "test",
        "severity": "high",
        "title": "Test incident",
        "first_seen": now - 3600,
        "last_seen": now - 600,
        "alerted_at": now - 3600,
        "source_count": 2,
        "sources": ["nws_mt_holly_alerts", "capemay_scanner"],
        "urls": ["https://api.weather.gov/alerts/x"],
    }
    alert.update(overrides)
    return alert, now


def test_trend_escalating_new_multi_source_high_severity():
    alert, now = _alert()
    assert credibility.trend_for_alert(alert, now) == "Escalating"


def test_trend_elevated_recent_update_without_newness():
    # First seen long ago, updated recently, medium severity, two sources:
    # corroborated and active, but neither new nor high-severity -> Elevated.
    alert, now = _alert(
        severity="medium", first_seen=1794800000 - 12 * 3600
    )
    assert credibility.trend_for_alert(alert, now) == "Elevated"


def test_trend_stabilizing_when_quiet_for_6h():
    alert, now = _alert(
        last_seen=1794800000 - 7 * 3600, first_seen=1794800000 - 12 * 3600
    )
    assert credibility.trend_for_alert(alert, now) == "Stabilizing"
    # Single low-severity source, even recent, never escalates.
    alert, now = _alert(
        severity="low", source_count=1, sources=["capemay_scanner"]
    )
    assert credibility.trend_for_alert(alert, now) == "Stabilizing"


def test_score_alert_keeps_the_record_and_adds_the_score():
    alert, now = _alert()
    scored = credibility.score_alert(alert, now)
    assert scored["incident_key"] == "test-incident"
    assert scored["title"] == "Test incident"
    assert scored["credibility"] == 100
    assert scored["trend"] == "Escalating"
    assert scored["breakdown"]
    assert credibility.score_alert({}) is None
    assert credibility.score_alert({"sources": []}) is None


def test_score_never_exceeds_bounds():
    low = credibility.score_sources(["unknown-1"], disputed=True)
    assert low["credibility"] == 5  # 40 - 20 - 15
    assert 0 <= low["credibility"] <= 100
