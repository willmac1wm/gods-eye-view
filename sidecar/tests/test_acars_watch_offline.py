"""ACARS incident watcher (app/acars_watch.py). No network.

Covers: incident categories (diversion, mayday, medical, engine
failure, ground stop national vs local), the local-only rule (a
diversion over California does not alert), the nationwide-emergency
rule (mayday / emergency / engine failure / smoke anywhere alerts,
medical and bird strike outside the local area do not), routine
messages do NOT alert (fuel closeout, H1 position reports), messages
with no text do not alert, and the guardrail — raw message text
never appears in an alert title or summary.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import acars_watch


def _msg(**kw):
    base = {
        "id": 8122000001,
        "station": {"ident": "PhillyRox-VDLM", "nearestAirportIcao": "KPHL"},
        "airframe": {"tail": "N37700", "icao": "A4503D"},
        "flight": {
            "flight": "DL2570",
            "departingAirport": "BOS",
            "destinationAirport": "PHL",
            "latitude": 40.23,
            "longitude": -74.42,
        },
        "tail": "N37700",
        "label": "Q0",
        "text": "DIVERTING TO PHL DUE TO MEDICAL",
        "latitude": 40.23,
        "longitude": -74.42,
        "createdAt": "2026-11-15T14:10:57.000Z",
    }
    base.update(kw)
    return base


def test_local_diversion_alerts():
    a = acars_watch.match_acars_message(_msg())
    assert a is not None
    assert a["severity"] == "high"
    assert a["incident_key"].startswith("acars-diversion-")
    assert "DL2570" in a["title"]


def test_mayday_is_critical():
    a = acars_watch.match_acars_message(
        _msg(text="MAYDAY MAYDAY MAYDAY ENGINE FIRE")
    )
    assert a is not None and a["severity"] == "critical"
    assert "mayday" in a["incident_key"]


def test_engine_failure_is_critical():
    a = acars_watch.match_acars_message(
        _msg(text="MH89 ENG FAIL ON RWY. BLACK SMOKE APPEARD AND CLEAR NOW. DLY EXPECT.")
    )
    assert a is not None and a["severity"] == "critical"


def test_national_ground_stop_alerts_anywhere():
    a = acars_watch.match_acars_message(
        _msg(
            text="ALL AIRPORTS ALL AIRCRAFT ARE GROUND STOPPED UNTIL FURTHER NOTICE NATIONWIDE",
            station={"ident": "XX-KORD-VDL2", "nearestAirportIcao": "KORD"},
            flight={"flight": "UA123", "latitude": 41.97, "longitude": -87.90},
            latitude=41.97,
            longitude=-87.90,
        )
    )
    assert a is not None
    assert a["severity"] == "critical"
    assert a["incident_key"] == "acars-ground-stop"


def test_local_ground_stop_alerts_high():
    a = acars_watch.match_acars_message(
        _msg(text="PHL GROUND STOP IN EFFECT EXPECT DELAYS")
    )
    assert a is not None and a["severity"] == "high"
    assert a["incident_key"] == "acars-ground-stop"


def test_nonlocal_diversion_does_not_alert():
    a = acars_watch.match_acars_message(
        _msg(
            text="DIVERTING TO LAX DUE TO WEATHER",
            station={"ident": "XX-KLAX-VDL2", "nearestAirportIcao": "KLAX"},
            flight={"flight": "AA100", "latitude": 34.05, "longitude": -118.25},
            latitude=34.05,
            longitude=-118.25,
        )
    )
    assert a is None


def test_nonlocal_mayday_alerts_nationwide():
    # Emergencies are nationwide (William, 2026-11-15): a mayday over
    # Chicago alerts even though nothing about it is local.
    a = acars_watch.match_acars_message(
        _msg(
            text="MAYDAY MAYDAY MAYDAY ENGINE FIRE",
            station={"ident": "XX-KORD-VDL2", "nearestAirportIcao": "KORD"},
            flight={"flight": "UA456", "latitude": 41.97, "longitude": -87.90},
            latitude=41.97,
            longitude=-87.90,
        )
    )
    assert a is not None and a["severity"] == "critical"
    assert "mayday" in a["incident_key"]


def test_nonlocal_emergency_and_engine_failure_alert_nationwide():
    a = acars_watch.match_acars_message(
        _msg(
            text="DECLARING AN EMERGENCY ENGINE FAILURE RETURNING TO DEN",
            station={"ident": "XX-KDEN-VDL2", "nearestAirportIcao": "KDEN"},
            flight={"flight": "WN789", "latitude": 39.85, "longitude": -104.67},
            latitude=39.85,
            longitude=-104.67,
        )
    )
    assert a is not None and a["severity"] == "critical"
    # Real smoke warning (not a "NO SMOKE" status report) also alerts
    # anywhere.
    b = acars_watch.match_acars_message(
        _msg(
            text="WRN SMOKE CARGO SMOKE",
            station={"ident": "XX-KATL-VDL2", "nearestAirportIcao": "KATL"},
            flight={"flight": "DL321", "latitude": 33.64, "longitude": -84.43},
            latitude=33.64,
            longitude=-84.43,
        )
    )
    assert b is not None and b["severity"] == "critical"


def test_nonlocal_medical_and_bird_strike_stay_local():
    # Diversion, medical, minimum fuel, bird strike are still
    # local-only — a medical over Seattle and a bird strike over
    # Dallas do not alert.
    assert acars_watch.match_acars_message(
        _msg(
            text="MEDICAL ISSUE ON BOARD REQUEST PARAMEDICS ON ARRIVAL SEA",
            station={"ident": "XX-KSEA-VDL2", "nearestAirportIcao": "KSEA"},
            flight={"flight": "AS654", "latitude": 47.45, "longitude": -122.31},
            latitude=47.45,
            longitude=-122.31,
        )
    ) is None
    assert acars_watch.match_acars_message(
        _msg(
            text="BIRD STRIKE ON DEPARTURE RETURNING TO DFW",
            station={"ident": "XX-KDFW-VDL2", "nearestAirportIcao": "KDFW"},
            flight={"flight": "AA987", "latitude": 32.90, "longitude": -97.04},
            latitude=32.90,
            longitude=-97.04,
        )
    ) is None


def test_routine_emergency_lookalikes_do_not_alert():
    # All four shapes were false positives in the live last-hour
    # check on 2026-11-15, the day emergencies went nationwide.
    # Dangerous-goods paperwork (Royal Air Maroc AT969C).
    assert acars_watch.match_acars_message(
        _msg(text="THERE IS NO EVIDENCE THAT ANY DAMAGED OR LEAKING PACKAGES CONTAINING DANGEROUS GOODS HAVE BEEN LOADED")
    ) is None
    # Dispatcher warning one flight about ANOTHER aircraft's
    # emergency return (Delta DL336 at Austin). Note the \r between
    # EMERGENCY and AIRCRAFT in the real message — the matcher
    # collapses whitespace before phrase matching.
    assert acars_watch.match_acars_message(
        _msg(text="HEADS UP AIR RETURN FOR EMERGENCY\rAIRCRAFT IN AUS")
    ) is None
    # Takeoff performance data, not an actual failure (WestJet WS80).
    assert acars_watch.match_acars_message(
        _msg(text="ENGINE FAILURE ACCEL HT 1000FT")
    ) is None
    # Smoke-detector maintenance chatter, not smoke on board.
    assert acars_watch.match_acars_message(
        _msg(text="SMOKE DET FAULT MESSAGE DISAPPEARED DO YOU STILL WANT TO MEL")
    ) is None
    # Real declarations still alert.
    assert acars_watch.match_acars_message(
        _msg(text="DECLARING AN EMERGENCY RETURNING TO DEN")
    ) is not None
    assert acars_watch.match_acars_message(
        _msg(text="WRN SMOKE LAVATORY SMOKE")
    ) is not None


def test_routine_fuel_closeout_does_not_alert():
    # Real message shape seen live 2026-11-15 (DL2570 pre-pushback).
    a = acars_watch.match_acars_message(
        _msg(
            text="42 PRE-PUSHBACK MSG\r\nFLT 2611/15NOV\r\nA/C 3770 BOS-JFK RLS 4\r\n\r\n***FUEL CLOSEOUT PENDING***\r\nDO NOT PUSHBACK WITHOUT\r\nAN EFSR OR PAPER FSR"
        )
    )
    assert a is None


def test_h1_position_report_does_not_alert():
    a = acars_watch.match_acars_message(
        _msg(
            label="H1",
            text="ABS026BA_C ,B7378MAX ,261115,WS102 ,CYVR,CYYC,0685,BCG27-S200-0011\r\nN5028.9,W11543.5,151405,29337,-46.5,239,021,DC,00000,0,",
        )
    )
    assert a is None


def test_message_with_no_text_does_not_alert():
    assert acars_watch.match_acars_message(_msg(text=None)) is None
    assert acars_watch.match_acars_message(_msg(text="")) is None


def test_no_smoke_status_does_not_alert_but_lavatory_smoke_does():
    # Routine status report seen live 2026-11-15: "NO SMOKE ON".
    assert acars_watch.match_acars_message(
        _msg(text="598 STATUS NO SMOKE ON 597 STATUS SEAT BELT ON")
    ) is None
    assert acars_watch.match_acars_message(
        _msg(text="WRN SMOKE LAVATORY SMOKE")
    ) is not None


def test_routine_low_fuel_paperwork_does_not_alert():
    # "LOW FUEL" pulled routine Wizz Air fuel-quantity requests in the
    # live check, so it is not a keyword or a category at all.
    assert "LOW FUEL" not in acars_watch.KEYWORDS
    assert acars_watch.match_acars_message(
        _msg(text="WZZ0167, LYBE-LFOB, 15NOV26, 13:27:00z Dear LFOB GH, we need the below Fuel Qty for the next flight")
    ) is None


def test_raw_text_never_leaks_into_alert():
    # Sensitive free text: a medical message naming a passenger, and
    # the deportee message seen on FlightDeck. Neither may appear.
    a = acars_watch.match_acars_message(
        _msg(text="MEDICAL EMERGENCY ROW 14 PASSENGER JOHN SMITH UNRESPONSIVE DIVERTING TO PHL")
    )
    assert a is not None
    assert "JOHN SMITH" not in a["summary"]
    assert "JOHN SMITH" not in a["title"]
    assert "MEDICAL EMERGENCY ROW 14" not in a["summary"]
    assert a["items"][0]["summary"] == a["summary"]


def test_process_messages_records_once_and_updates(monkeypatch, tmp_path):
    from app import news_ingest

    monkeypatch.setattr(news_ingest, "DB_PATH", tmp_path / "news.db")
    seen: set = set()
    first = acars_watch.process_messages([_msg()], now_s=1000, seen=seen)
    assert len(first) == 1 and first[0]["status"] == "new"
    again = acars_watch.process_messages([_msg()], now_s=1060, seen=seen)
    assert again == []  # same message id: never processed twice
    other = acars_watch.process_messages(
        [_msg(id=8122000002, text="DIVERTING TO EWR MEDICAL")], now_s=1120, seen=seen
    )
    assert len(other) == 1 and other[0]["status"] == "updated"
    alerts = news_ingest.latest_alerts()
    assert len(alerts) == 1
    assert alerts[0]["incident_key"].startswith("acars-diversion-")
