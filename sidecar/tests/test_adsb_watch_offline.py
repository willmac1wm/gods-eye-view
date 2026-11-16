"""Squawk + callsign watcher (app/adsb_watch.py). No network.

Covers: emergency squawks (any aircraft), VIP callsigns, watchlisted
aircraft by hex/registration, military B742 type, routine military
traffic does NOT alert, and the squawk persistence rule (one poll is
a watch, not an alert).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import adsb_watch


def _obs(**kw):
    base = {
        "hex": "ae1234",
        "flight": "RCH451 ",
        "r": "07-0874",
        "t": "C17",
        "squawk": "1200",
        "emergency": "none",
        "alt_baro": 35000,
        "lat": 39.0,
        "lon": -74.5,
    }
    base.update(kw)
    return base


def test_routine_military_does_not_alert():
    assert adsb_watch.match_aircraft(_obs()) == []
    assert adsb_watch.detect_aircraft([_obs()]) == []


def test_squawk_7700_matches_any_aircraft():
    hits = adsb_watch.match_aircraft(_obs(squawk="7700"))
    assert len(hits) == 1
    assert hits[0]["kind"] == "squawk" and hits[0]["match"] == "7700"
    anomalies = adsb_watch.detect_aircraft([_obs(squawk="7700")])
    assert len(anomalies) == 1
    assert anomalies[0]["severity"] == "critical"
    assert anomalies[0]["incident_key"].startswith("squawk-7700-")


def test_squawk_7500_and_7600_match():
    assert adsb_watch.match_aircraft(_obs(squawk="7500"))[0]["match"] == "7500"
    assert adsb_watch.match_aircraft(_obs(squawk="7600"))[0]["match"] == "7600"
    assert adsb_watch.match_aircraft(_obs(squawk="1200")) == []


def test_squawk_needs_two_polls_to_alert(monkeypatch, tmp_path):
    from app import news_ingest

    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")
    p = adsb_watch.SquawkPersistence()
    obs = [_obs(squawk="7700")]
    first = adsb_watch.process_observations(obs, now_s=1000, persistence=p)
    assert first == []  # first sighting: watch, not alert
    second = adsb_watch.process_observations(obs, now_s=1060, persistence=p)
    assert len(second) == 1
    assert second[0]["status"] == "new"
    assert second[0]["incident_key"].startswith("squawk-7700-")
    third = adsb_watch.process_observations(obs, now_s=1120, persistence=p)
    assert third[0]["status"] == "updated"  # same incident, cooldown


def test_air_force_one_callsign_matches():
    hits = adsb_watch.match_aircraft(_obs(flight="AIRFORCEONE", hex="adfdf8"))
    kinds = {h["kind"] for h in hits}
    assert "callsign" in kinds and "aircraft" in kinds


def test_one_aircraft_one_vip_alert_not_two():
    anomalies = adsb_watch.detect_aircraft(
        [_obs(flight="AIRFORCEONE", hex="adfdf8", r="82-8000", t="B742", _mil=True)]
    )
    assert len(anomalies) == 1
    assert anomalies[0]["title"] == "Air Force One airborne"
    assert "VC-25A" in anomalies[0]["summary"]


def test_squawk_and_vip_on_same_aircraft_are_separate():
    anomalies = adsb_watch.detect_aircraft(
        [_obs(flight="AIRFORCEONE", hex="adfdf8", squawk="7700", _mil=True)]
    )
    assert len(anomalies) == 2
    assert {a["severity"] for a in anomalies} == {"critical", "high"}


def test_sam_callsign_matches_but_routine_sam_number_does_not_overmatch():
    assert any(
        h["kind"] == "callsign" for h in adsb_watch.match_aircraft(_obs(flight="SAM28000"))
    )
    # SAM is a prefix + number; a flight literally called SAM with no
    # number, or a callsign merely containing SAM, must not match.
    assert adsb_watch.match_aircraft(_obs(flight="SAM")) == []
    assert adsb_watch.match_aircraft(_obs(flight="SAMSUNG1")) == []


def test_e4b_by_hex_and_by_tail():
    assert any(
        h["label"].startswith("E-4B")
        for h in adsb_watch.match_aircraft(_obs(hex="adfeb6", flight="GORDO14"))
    )
    assert any(
        h["label"].startswith("E-4B")
        for h in adsb_watch.match_aircraft(_obs(hex="ae9999", r="75-0125"))
    )


def test_japan_pair_by_tail_and_callsign():
    hits = adsb_watch.match_aircraft(_obs(hex="ae1111", r="80-1111", flight="JF001"))
    assert any(h["kind"] == "callsign" for h in hits)
    assert any(h["kind"] == "aircraft" for h in hits)


def test_military_b742_type_matches_only_in_mil():
    assert any(
        h["kind"] == "type"
        for h in adsb_watch.match_aircraft(_obs(t="B742", _mil=True))
    )
    assert not any(
        h["kind"] == "type"
        for h in adsb_watch.match_aircraft(_obs(t="B742"))
    )


def test_civilian_vip_reg_matches():
    hits = adsb_watch.match_aircraft(_obs(hex="ae7777", r="4X-ISR", flight="ISR1"))
    assert any("Wing of Zion" in h["label"] for h in hits)
