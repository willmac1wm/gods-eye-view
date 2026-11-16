"""FEMA IPAWS alert watcher (app/ipaws_watch.py). No network.

Fixtures are modeled on the real IpawsArchivedAlerts record shape
(verified live 2026-11-15 — e.g. a Fort Wayne "Local Area Emergency"
with SAME geocode, circle geometry, and CMAM parameters).

Covers: Cape May SAME code 034009 in, Atlantic County out, NJ
statewide Severe naming Cape May in (Moderate, or not naming Cape
May, out), Test / Exercise / restricted scope / Ack excluded, Cancel
consumed without alerting, circle and polygon geometry, severity
mapping, dedupe by (identifier, sent), Update supersedes Alert, the
1-hour window, description truncation, and the OData poll URL.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import ipaws_watch, news_ingest

NOW = 1794656400  # 2026-11-15 17:00 UTC


def _iso(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )


def _info(**kw):
    base = {
        "event": "Flash Flood Warning",
        "category": ["Met"],
        "severity": "Severe",
        "urgency": "Immediate",
        "certainty": "Likely",
        "language": "en-US",
        "effective": _iso(NOW - 1800),
        "onset": _iso(NOW - 1800),
        "expires": _iso(NOW + 7200),
        "description": (
            "Flash flooding is expected across Cape May County. "
            "Do not drive through flooded roadways."
        ),
        "responseType": ["Avoid"],
        "senderName": "NWS Mount Holly",
        "area": [
            {
                "areaDesc": "Cape May County",
                "geocode": [{"name": "SAME", "value": "034009"}],
                "circle": [
                    {
                        "type": "Circle",
                        "radius": 5.0,
                        "coordinates": [[-74.9, 39.08]],
                    }
                ],
            }
        ],
    }
    base.update(kw)
    return base


def _record(**kw):
    base = {
        "identifier": "NWS-PHI-20261115-001",
        "sender": "NWS_Mount_Holly",
        "senderName": "NWS Mount Holly",
        "sent": _iso(NOW - 600),
        "status": "Actual",
        "msgType": "Alert",
        "scope": "Public",
        "info": [_info()],
    }
    base.update(kw)
    return base


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")


# ------------------------------------------------------------------ locality

def test_cape_may_same_code_alerts():
    a = ipaws_watch.match_ipaws_record(_record())
    assert a is not None
    assert a["severity"] == "high"
    assert a["incident_key"] == "ipaws-NWS-PHI-20261115-001"
    assert "Flash Flood Warning" in a["title"]
    assert "Cape May County" in a["title"]


def test_extreme_immediate_is_critical():
    a = ipaws_watch.match_ipaws_record(
        _record(info=[_info(event="Tornado Warning", severity="Extreme")])
    )
    assert a is not None and a["severity"] == "critical"


def test_atlantic_county_does_not_alert():
    rec = _record(
        identifier="NWS-PHI-20261115-002",
        info=[
            _info(
                area=[
                    {
                        "areaDesc": "Atlantic County",
                        "geocode": [{"name": "SAME", "value": "034001"}],
                        "circle": [
                            {
                                "type": "Circle",
                                "radius": 5.0,
                                "coordinates": [[-74.5, 39.4]],
                            }
                        ],
                    }
                ]
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is None


def test_statewide_severe_naming_cape_may_alerts():
    rec = _record(
        identifier="NJ-STATE-001",
        info=[
            _info(
                event="Tornado Watch",
                area=[
                    {
                        "areaDesc": "New Jersey",
                        "geocode": [{"name": "SAME", "value": "034000"}],
                    }
                ],
                description=(
                    "A tornado watch is in effect for southern New Jersey, "
                    "including Cape May County, until 9 PM."
                ),
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is not None


def test_statewide_moderate_naming_cape_may_does_not_alert():
    rec = _record(
        identifier="NJ-STATE-002",
        info=[
            _info(
                event="Coastal Flood Advisory",
                severity="Moderate",
                area=[
                    {
                        "areaDesc": "New Jersey",
                        "geocode": [{"name": "SAME", "value": "034000"}],
                    }
                ],
                description="Minor coastal flooding is possible in Cape May County.",
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is None


def test_statewide_severe_not_naming_cape_may_does_not_alert():
    rec = _record(
        identifier="NJ-STATE-003",
        info=[
            _info(
                event="Severe Thunderstorm Warning",
                area=[
                    {
                        "areaDesc": "New Jersey",
                        "geocode": [{"name": "SAME", "value": "034000"}],
                    }
                ],
                description="Severe thunderstorms are expected across northern New Jersey.",
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is None


def test_area_desc_cape_may_alerts_without_same_code():
    rec = _record(
        identifier="LOCAL-001",
        info=[
            _info(
                area=[
                    {
                        "areaDesc": "Cape May County",
                        "geocode": [],
                    }
                ]
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is not None


def test_circle_geometry_in_county_alerts():
    rec = _record(
        identifier="GEO-001",
        info=[
            _info(
                area=[
                    {
                        "areaDesc": "Coastal waters",
                        "geocode": [],
                        "circle": [
                            {
                                "type": "Circle",
                                "radius": 10.0,
                                "coordinates": [[-74.9, 39.08]],
                            }
                        ],
                    }
                ]
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is not None


def test_circle_geometry_outside_county_does_not_alert():
    rec = _record(
        identifier="GEO-002",
        info=[
            _info(
                area=[
                    {
                        "areaDesc": "Philadelphia area",
                        "geocode": [],
                        "circle": [
                            {
                                "type": "Circle",
                                "radius": 5.0,
                                "coordinates": [[-75.16, 39.95]],
                            }
                        ],
                    }
                ]
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is None


def test_polygon_vertex_in_county_alerts():
    rec = _record(
        identifier="GEO-003",
        info=[
            _info(
                area=[
                    {
                        "areaDesc": "Southern New Jersey",
                        "geocode": [],
                        "polygon": [
                            {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        [-75.2, 39.4],
                                        [-74.8, 39.4],
                                        [-74.8, 39.0],
                                        [-75.2, 39.0],
                                        [-75.2, 39.4],
                                    ]
                                ],
                            }
                        ],
                    }
                ]
            )
        ],
    )
    assert ipaws_watch.match_ipaws_record(rec) is not None


# ------------------------------------------------------------------ exclusion

def test_test_status_does_not_alert():
    assert ipaws_watch.match_ipaws_record(_record(status="Test")) is None


def test_exercise_status_does_not_alert():
    assert ipaws_watch.match_ipaws_record(_record(status="Exercise")) is None


def test_restricted_scope_does_not_alert():
    assert ipaws_watch.match_ipaws_record(_record(scope="Restricted")) is None


def test_ack_msgtype_does_not_alert():
    assert ipaws_watch.match_ipaws_record(_record(msgType="Ack")) is None


def test_empty_description_test_event_excluded():
    rec = _record(
        info=[
            _info(
                event="Test of Emergency Alert System",
                severity="Minor",
                description="",
            )
        ]
    )
    assert ipaws_watch.match_ipaws_record(rec) is None


def test_stale_record_outside_window_does_not_alert():
    rec = _record(sent=_iso(NOW - 4 * 24 * 3600))
    assert ipaws_watch.detect_records([rec], now_s=NOW) == []


# ------------------------------------------------------------------ severity

def test_severity_mapping():
    cases = [
        ("Extreme", "Immediate", "critical"),
        ("Extreme", "Future", "high"),
        ("Severe", "Immediate", "high"),
        ("Severe", "Expected", "high"),
        ("Severe", "Future", "normal"),
        ("Moderate", "Immediate", "normal"),
        ("Minor", "Immediate", "normal"),
        ("Unknown", "Unknown", "normal"),
    ]
    for severity, urgency, expected in cases:
        got = ipaws_watch.severity_for(
            _record(), _info(severity=severity, urgency=urgency)
        )
        assert got == expected, (severity, urgency, got)


# ------------------------------------------------------------------ shape

def test_summary_truncates_description():
    long_desc = "Water is rising. " * 40  # ~680 chars
    rec = _record(info=[_info(description=long_desc)])
    a = ipaws_watch.match_ipaws_record(rec)
    assert a is not None
    quoted = a["summary"].split(": ", 1)[1]
    assert len(quoted) <= ipaws_watch.SUMMARY_DESC_MAX + len(" Expires .") + 30
    assert "…" in a["summary"]
    assert long_desc[400:] not in a["summary"]


def test_poll_url_construction():
    url = ipaws_watch.build_poll_url()
    assert url.startswith("https://www.fema.gov/api/open/v1/IpawsArchivedAlerts?")
    assert "$orderby=sent%20desc" in url  # %20, not a literal space:
    # urllib rejects spaces in URLs, and the space must be encoded
    assert "$top=100" in url
    assert "$select" not in url  # OpenFEMA 400s on $select of `info`


# ------------------------------------------------------------------ stateful

def test_cancel_consumed_not_alerted(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    rec = _record(identifier="CXL-001", msgType="Cancel")
    out = ipaws_watch.process_records([rec], now_s=NOW, seen=set())
    assert out == [{"incident_key": "ipaws-CXL-001", "status": "cancelled"}]
    assert news_ingest.latest_alerts() == []


def test_dedupe_same_record_twice(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    seen: set = set()
    rec = _record()
    first = ipaws_watch.process_records([rec], now_s=NOW, seen=seen)
    assert first == [{"incident_key": "ipaws-NWS-PHI-20261115-001", "status": "new"}]
    second = ipaws_watch.process_records([rec], now_s=NOW, seen=seen)
    assert second == []


def test_update_supersedes_alert(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    seen: set = set()
    alert = _record()
    update = _record(
        msgType="Update",
        sent=_iso(NOW - 300),
        info=[
            _info(
                description=(
                    "Flash flooding is now occurring across Cape May County. "
                    "Avoid Route 47."
                )
            )
        ],
    )
    first = ipaws_watch.process_records([alert], now_s=NOW, seen=seen)
    assert first[0]["status"] == "new"
    second = ipaws_watch.process_records([update], now_s=NOW, seen=seen)
    assert second == [
        {"incident_key": "ipaws-NWS-PHI-20261115-001", "status": "updated"}
    ]
    stored = news_ingest.get_alert("ipaws-NWS-PHI-20261115-001")
    assert stored is not None
    assert "Route 47" in (stored.get("report_md") or "")


def test_batch_alert_and_update_keeps_newest(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    alert = _record()
    update = _record(
        msgType="Update",
        sent=_iso(NOW - 300),
        info=[_info(description="Updated: flooding now occurring in Cape May County.")],
    )
    out = ipaws_watch.process_records(
        [alert, update], now_s=NOW, seen=set()
    )
    assert len(out) == 1 and out[0]["status"] == "new"
    stored = news_ingest.get_alert("ipaws-NWS-PHI-20261115-001")
    assert stored is not None
    assert "Updated: flooding now occurring" in (stored.get("report_md") or "")
