"""Auto-catch: anomaly alerts + incident reports (app/news_ingest.py).
No network. Built with what Cape Dispatch already has — no SDR, no new
API, no LiveATC scraping.

Covers: FAA ground-stop detection (national + local ACY/PHL/EWR),
corroboration across sources, cooldown/dedupe by incident_key, severe
NWS warnings only, routine delays and advisories do NOT alert, and the
auto-built incident report (headline + excerpt + link-outs only).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import news_ingest


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")


def _gs(title, url, source_id="gnews_faa_groundstop", publisher="Reuters",
        summary="The FAA ordered a nationwide ground stop."):
    return {
        "id": url,
        "source_id": source_id,
        "source_name": "FAA ground stop",
        "kind": "media",
        "title": title,
        "url": url,
        "summary": summary,
        "publisher": publisher,
        "published": "Fri, 13 Nov 2026 20:54:00 GMT",
        "pub_ms": 1794636840000,
    }


def _nws(event, url="https://api.weather.gov/alerts/urn:oid:test"):
    return {
        "id": url + "|" + event,
        "source_id": "nws_mt_holly_alerts",
        "source_name": "NWS Mount Holly alerts",
        "kind": "official",
        "title": f"{event} — Cape May County",
        "url": url,
        "summary": f"{event} in effect for Cape May County.",
        "publisher": "National Weather Service",
        "published": "2026-11-13T12:43:00-05:00",
        "pub_ms": 1794608580000,
    }


# ------------------------------------------------------------------ detection

def test_national_ground_stop_triggers_critical_alert():
    items = [
        _gs(
            "FAA halts departing flights nationwide in ground stop",
            "https://example.com/reuters-ground-stop",
        )
    ]
    anomalies = news_ingest.detect_anomalies(items)
    assert len(anomalies) == 1
    a = anomalies[0]
    assert a["incident_key"] == "faa-ground-stop"
    assert a["severity"] == "critical"
    assert a["rule_id"] == "faa_ground_stop_national"
    assert a["source_ids"] == ["gnews_faa_groundstop"]


def test_local_acy_ground_stop_joins_same_incident():
    items = [
        _gs(
            "FAA halts departing flights nationwide in ground stop",
            "https://example.com/reuters-ground-stop",
        ),
        _gs(
            "Ground stop at Atlantic City International Airport",
            "https://example.com/acy-ground-stop",
            source_id="gnews_nj_airports_groundstop",
            publisher="Press of Atlantic City",
        ),
    ]
    anomalies = news_ingest.detect_anomalies(items)
    # Both rules match the same incident_key, from two sources.
    keys = {a["incident_key"] for a in anomalies}
    assert keys == {"faa-ground-stop"}
    assert all(a["severity"] == "critical" for a in anomalies)


def test_routine_delay_does_not_alert():
    items = [
        _gs(
            "Flight delays at Philadelphia International Airport",
            "https://example.com/phl-delays",
            summary="Departures delayed by weather, no ground stop in effect.",
        )
    ]
    assert news_ingest.detect_anomalies(items) == []


def test_nws_tornado_warning_alerts_but_freeze_warning_does_not():
    assert len(news_ingest.detect_anomalies([_nws("Tornado Warning")])) == 1
    a = news_ingest.detect_anomalies([_nws("Tornado Warning")])[0]
    assert a["severity"] == "high"
    assert a["incident_key"].startswith("nws-")
    assert news_ingest.detect_anomalies([_nws("Freeze Warning")]) == []
    assert news_ingest.detect_anomalies([_nws("Wind Advisory")]) == []


# ------------------------------------------------------------------ alerts + reports

def test_first_alert_is_new_second_is_updated_no_duplicate(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    items = [
        _gs(
            "FAA halts departing flights nationwide in ground stop",
            "https://example.com/reuters-ground-stop",
        )
    ]
    first = news_ingest.process_items_for_alerts(items, now_s=1794637000)
    assert first == [{"incident_key": "faa-ground-stop", "status": "new"}]
    second = news_ingest.process_items_for_alerts(items, now_s=1794637100)
    assert second == [{"incident_key": "faa-ground-stop", "status": "updated"}]
    alerts = news_ingest.latest_alerts()
    assert len(alerts) == 1
    assert alerts[0]["incident_key"] == "faa-ground-stop"
    assert alerts[0]["severity"] == "critical"
    assert alerts[0]["status"] == "active"


def test_corroboration_grows_source_count_and_report(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    items = [
        _gs(
            "FAA halts departing flights nationwide in ground stop",
            "https://example.com/reuters-ground-stop",
        ),
        _gs(
            "Ground stop at Atlantic City International Airport",
            "https://example.com/acy-ground-stop",
            source_id="gnews_nj_airports_groundstop",
            publisher="Press of Atlantic City",
        ),
    ]
    news_ingest.process_items_for_alerts(items, now_s=1794637000)
    alert = news_ingest.get_alert("faa-ground-stop")
    assert alert is not None
    assert alert["source_count"] == 2
    assert "gnews_faa_groundstop" in alert["sources"]
    assert "gnews_nj_airports_groundstop" in alert["sources"]
    report = alert["report_md"]
    assert "FAA nationwide ground stop" in report
    assert "https://example.com/reuters-ground-stop" in report
    assert "https://example.com/acy-ground-stop" in report
    assert "Reuters" in report
    assert "Press of Atlantic City" in report


def test_fast_sources_are_faa_and_nws_only():
    assert news_ingest.FAST_SOURCE_IDS == {
        "gnews_faa_groundstop",
        "gnews_nj_airports_groundstop",
        "nws_mt_holly_alerts",
    }
    assert news_ingest.FAST_REFRESH_INTERVAL == 300
    assert news_ingest.FAST_REFRESH_INTERVAL < news_ingest.REFRESH_INTERVAL
