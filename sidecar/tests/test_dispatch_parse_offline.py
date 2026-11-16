"""Fire Wire dispatch parser (app/dispatch_parse.py). No network.

The 8 sample dispatches from the Fire Wire group ingest spec
(2026-11-14) plus status updates, free-text non-matches, and the
alert bridge. The spec's pasted regex matched only 4/8 of these;
this parser matches 8/8.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import dispatch_parse as dp

SAMPLES = [
    # (text, units, town, location, call_type)
    (
        "ST 15 MARMORA Roosevelt in front of the CVS..MVC (2 vehicles in roadway)",
        ["15"], "Marmora", "Roosevelt in front of the CVS", "mvc",
    ),
    ("Sq3 West WW 745 W Poplar..MVC", ["3"], "West Wildwood", "745 W Poplar", "mvc"),
    (
        "ST 70 71 CMCH 146 Springers Mill..single MC crash",
        ["70", "71"], "Cape May Court House", "146 Springers Mill", "motorcycle_crash",
    ),
    (
        "ST 17 18 22 Sq11 S SEAVILLE..20 Siskin Ln..structure",
        ["17", "18", "22", "11"], "South Seaville", "20 Siskin Ln", "structure_fire",
    ),
    ("Sq3 L2 WW 4200 block of Pacific..MVC", ["3", "2"], "Wildwood", "4200 block of Pacific", "mvc"),
    (
        "ST 20 19 15 CORBIN CITY 650 Rt 50..structure",
        ["20", "19", "15"], "Corbin City", "650 Rt 50", "structure_fire",
    ),
    ("ST 51 CM Rosemans/Lafayette..MVC", ["51"], "Cape May", "Rosemans/Lafayette", "mvc"),
    (
        "ST 19 20 15 SEAVILLE iao Rt 9/Crestview Dr..MVC w/possible entrapment",
        ["19", "20", "15"], "Seaville", "Rt 9/Crestview Dr", "mvc",
    ),
]


def test_all_eight_samples_parse():
    for text, numbers, town, location, call_type in SAMPLES:
        p = dp.parse_dispatch(text)
        assert p is not None, text
        assert [u["number"] for u in p["units"]] == numbers, text
        assert p["town"] == town, text
        assert p["location"] == location, text
        assert p["call_type"] == call_type, text


def test_bare_numbers_inherit_station_prefix():
    p = dp.parse_dispatch("ST 70 71 CMCH 146 Springers Mill..single MC crash")
    assert [u["type"] for u in p["units"]] == ["station", "station"]
    p = dp.parse_dispatch("ST 17 18 22 Sq11 S SEAVILLE..20 Siskin Ln..structure")
    assert [u["type"] for u in p["units"]] == ["station", "station", "station", "squad"]


def test_intersection_and_iao():
    p = dp.parse_dispatch("ST 51 CM Rosemans/Lafayette..MVC")
    assert p["intersection"] is True
    p = dp.parse_dispatch("ST 19 20 15 SEAVILLE iao Rt 9/Crestview Dr..MVC w/possible entrapment")
    assert p["location"] == "Rt 9/Crestview Dr"
    assert "possible_entrapment" in p["qualifiers"]
    assert p["severity"] == "high"


def test_structure_fire_is_high_and_corbin_city_is_out_of_county():
    p = dp.parse_dispatch("ST 20 19 15 CORBIN CITY 650 Rt 50..structure")
    assert p["severity"] == "high"
    assert p["mutual_aid_out_of_county"] is True
    p2 = dp.parse_dispatch("ST 15 MARMORA Roosevelt in front of the CVS..MVC (2 vehicles in roadway)")
    assert p2["mutual_aid_out_of_county"] is False
    assert "multiple_vehicles" in p2["qualifiers"]


def test_free_text_and_fundraisers_do_not_parse():
    assert dp.parse_dispatch("Woman hit on bike on 47 right by the old tattoo") is None
    assert dp.parse_dispatch("Fire company pancake breakfast Saturday!") is None
    assert dp.parse_dispatch("On November 7th Engine 13 extinguished a dumpster fire") is None
    assert dp.parse_dispatch("") is None


def test_status_updates_are_not_new_incidents():
    s = dp.parse_status("51 clear")
    assert s is not None and s["status_signal"] == "units_clear"
    assert s["location"] is None
    s = dp.parse_status("Update: Road is now back open")
    assert s is not None and s["status_signal"] == "road_reopened"
    s = dp.parse_status("Helo on standby")
    assert s is not None and s["status_signal"] == "escalated"
    assert dp.parse_status("So many accidents") is None
    # parse() routes status updates through the same entry point
    assert dp.parse("51 clear")["is_status_update"] is True
    assert dp.parse("ST 51 CM Rosemans/Lafayette..MVC")["is_status_update"] is False


def test_dispatch_to_anomaly(monkeypatch, tmp_path):
    from app import news_ingest

    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")
    p = dp.parse_dispatch(
        "ST 19 20 15 SEAVILLE iao Rt 9/Crestview Dr..MVC w/possible entrapment"
    )
    anomaly = dp.dispatch_to_anomaly(p)
    assert anomaly["severity"] == "high"
    assert anomaly["incident_key"].startswith("dispatch-seaville-")
    status = news_ingest.record_alert(anomaly, now_s=1794704000)
    assert status == "new"
    alerts = news_ingest.latest_alerts()
    assert len(alerts) == 1
    assert "Call 911" in alerts[0]["summary"]
    # a status update never becomes an alert
    assert dp.dispatch_to_anomaly(dp.parse("51 clear")) is None
