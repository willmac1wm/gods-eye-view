"""AI situation layer (D1, app/ai_situation.py). Offline: fixture DB in
tmp_path, Gemini stubbed — no network, no key.

Pins: tables + seed facts (verified thresholds only — no invented roads);
fetchers with a stub transport (success + failure skips the row, never a
faked row); snapshot cycle + 90-day retention; retrieval never returns
raw_json/dispatch text; no-record → "I don't have a record of that"; no
key → "writer not configured" with the records still browsable; a model
citation to an unknown record id is dropped; forecaster rules fire
without the model and dedupe; a draft that drops the confidence is
rejected in favour of the rules-only text; outcome checker marks
confirmed/wrong from fixture follow-ups and leaves the uncheckable
mil-surge prediction open.
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import ai_situation as AI  # noqa: E402
from app import news_ingest  # noqa: E402

# The clock is real-time-relative: the retrieval / forecaster windows
# are measured against time.time(), so a hardcoded epoch would age out
# of the 24 h window (the D5 lesson).
NOW_MS = int(time.time() * 1000)
NOW_S = NOW_MS // 1000
HOUR = 3600 * 1000


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _gemini_stub(text):
    def transport(url, payload, headers, timeout):
        return _Resp(
            {"candidates": [{"content": {"parts": [{"text": text}]}}]}
        )

    return transport


def _db(monkeypatch, tmp_path):
    db_path = tmp_path / "news.db"
    monkeypatch.setattr(news_ingest, "DB_PATH", db_path)
    con = sqlite3.connect(db_path)
    con.execute(
        "CREATE TABLE news_items (id TEXT PRIMARY KEY, source_id TEXT, "
        "source_name TEXT, kind TEXT, title TEXT, url TEXT UNIQUE, "
        "summary TEXT, publisher TEXT, published TEXT, pub_ms INTEGER)"
    )
    con.execute(
        "CREATE TABLE news_alerts (incident_key TEXT PRIMARY KEY, rule_id TEXT, "
        "severity TEXT, title TEXT, summary TEXT, status TEXT, first_seen INTEGER, "
        "last_seen INTEGER, alerted_at INTEGER, source_count INTEGER, "
        "sources_json TEXT, urls_json TEXT, report_md TEXT)"
    )
    con.execute(
        "CREATE TABLE feed_history (id INTEGER PRIMARY KEY, source TEXT, "
        "source_label TEXT, cat TEXT, type TEXT, subtype TEXT, title TEXT, "
        "description TEXT, lat REAL, lng REAL, pub_ms INTEGER, created_at TEXT, "
        "raw_json TEXT)"
    )
    con.execute(
        "CREATE TABLE aircraft_history (hex TEXT, kind TEXT, flight TEXT, "
        "lat REAL, lon REAL, alt REAL, speed REAL, track REAL, vrate REAL, "
        "ac_type TEXT, cat TEXT, seen_at INTEGER)"
    )
    con.commit()
    con.close()
    AI.init_ai_db(db_path)
    return db_path


def _alert(db_path, key, title, severity="high", last_seen=None):
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO news_alerts (incident_key, rule_id, severity, title, "
        "summary, status, first_seen, last_seen, alerted_at, source_count, "
        "sources_json, urls_json, report_md) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            key,
            "nws",
            severity,
            title,
            "summary",
            "active",
            NOW_S - 3600,
            last_seen or NOW_S,
            NOW_S,
            1,
            '["nws_mt_holly_alerts"]',
            "[]",
            "",
        ),
    )
    con.commit()
    con.close()


def _item(db_path, item_id, title, summary, pub_ms=None, source="Cape May Herald"):
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO news_items (id, source_id, source_name, kind, title, "
        "url, summary, publisher, published, pub_ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            item_id,
            "herald",
            source,
            "news",
            title,
            f"https://example.test/{item_id}",
            summary,
            source,
            "2026-11-15",
            pub_ms or NOW_MS,
        ),
    )
    con.commit()
    con.close()


def _snapshot(db_path, layer_id, state, captured_at):
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO layer_state_snapshots (layer_id, captured_at, state_json, source) "
        "VALUES (?,?,?,?)",
        (layer_id, captured_at, json.dumps(state), "test"),
    )
    con.commit()
    con.close()


# ---------------------------------------------------------------- tables

def test_tables_and_seed_facts_verified_thresholds_only(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    facts = AI.get_facts(db_path)
    assert facts["nws_minor_flood_ft"] == 6.2
    assert facts["mdapi_minor_flood_ft"] == 6.70
    # First-flood roads are NOT seeded — they need human confirmation.
    assert "first_flood_roads" not in facts
    # init is idempotent: a second call does not duplicate the seeds.
    AI.init_ai_db(db_path)
    assert len(AI.get_facts(db_path)) == 3


# ---------------------------------------------------------------- fetchers

def _stub_fetch(mapping):
    def fetch(url):
        for needle, payload in mapping.items():
            if needle in url:
                return payload
        raise RuntimeError(f"unexpected url {url}")

    return fetch


def test_fetchers_with_stub_transport(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    tides = AI.fetch_tides(
        _stub_fetch(
            {
                "8536110": {"data": [{"t": "2026-11-17 21:54", "v": "3.258"}]},
                "8534720": {"data": [{"t": "2026-11-17 21:54", "v": "2.910"}]},
            }
        )
    )
    assert tides == (
        "tides",
        {
            "stations": {
                "8536110": {"ft": 3.258, "at": "2026-11-17 21:54"},
                "8534720": {"ft": 2.91, "at": "2026-11-17 21:54"},
            },
            "cape_may_ft": 3.258,
        },
    )
    gauges = AI.fetch_gauges(
        _stub_fetch(
            {
                "waterservices": {
                    "value": {
                        "timeSeries": [
                            {
                                "sourceInfo": {"siteCode": [{"value": "01411000"}]},
                                "values": [
                                    {"value": [{"value": "4.12", "dateTime": "2026-11-17T21:00:00"}]}
                                ],
                            }
                        ]
                    }
                }
            }
        )
    )
    assert gauges == ("gauges", {"sites": {"01411000": {"ft": 4.12, "at": "2026-11-17T21:00:00"}}})
    outages = AI.fetch_outages(
        _stub_fetch(
            {
                "massoutage": {
                    "data": {
                        "fips": "34009",
                        "customers_out": 2,
                        "customers_tracked": 113764,
                        "incident_count": 2,
                        "as_of": "2026-11-17T21:55:23Z",
                    }
                }
            }
        )
    )
    assert outages[1]["customers_out"] == 2
    kp = AI.fetch_space_weather(
        _stub_fetch(
            {
                "swpc": [
                    {"time_tag": "2026-11-17T21:56:00", "kp_index": 1, "estimated_kp": 0.67}
                ]
            }
        )
    )
    assert kp == ("space-weather", {"kp": 1, "estimated_kp": 0.67, "at": "2026-11-17T21:56:00"})


def test_failed_fetch_skips_the_row_never_fakes_one(monkeypatch, tmp_path):
    def failing(url):
        raise RuntimeError("boom")

    assert AI.fetch_tides(failing) is None
    assert AI.fetch_gauges(failing) is None
    assert AI.fetch_outages(failing) is None
    assert AI.fetch_space_weather(failing) is None


# ---------------------------------------------------------------- snapshot

def test_snapshot_cycle_writes_rows_and_rolls_off_90_days(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    fetch = _stub_fetch(
        {
            "8536110": {"data": [{"t": "2026-11-17 21:54", "v": "3.258"}]},
            "8534720": {"data": [{"t": "2026-11-17 21:54", "v": "2.910"}]},
            "waterservices": {"value": {"timeSeries": []}},
            "massoutage": {"data": {"customers_out": 2, "customers_tracked": 113764}},
            "swpc": [{"time_tag": "2026-11-17T21:56:00", "kp_index": 1, "estimated_kp": 0.67}],
        }
    )
    # A stale row (100 days old) must be rolled off by the cycle.
    _snapshot(db_path, "tides", {"cape_may_ft": 1.0}, NOW_MS - 100 * 24 * HOUR)
    result = AI.snapshot_cycle(db_path, fetch_json=fetch, now_ms=NOW_MS)
    assert "tides" in result["written"]
    assert "outages" in result["written"]
    assert "space-weather" in result["written"]
    # gauges returned no sites → skipped, honestly.
    assert "gauges" in result["failed"]
    con = sqlite3.connect(db_path)
    rows = con.execute(
        "SELECT COUNT(*) FROM layer_state_snapshots WHERE captured_at < ?",
        (NOW_MS - 90 * 24 * HOUR,),
    ).fetchone()[0]
    con.close()
    assert rows == 0
    snaps = AI.latest_snapshots(db_path)
    assert snaps["tides"]["state"]["cape_may_ft"] == 3.258


def test_sidecar_counts_from_fixture_db(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _alert(db_path, "a1", "Freeze Warning", severity="high")
    _alert(db_path, "a2", "Coastal Flood Advisory", severity="low")
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO aircraft_history (hex, kind, flight, seen_at) VALUES ('a', 'mil', 'COBRA', ?)",
        (NOW_MS - 1000,),
    )
    con.execute(
        "INSERT INTO aircraft_history (hex, kind, flight, seen_at) VALUES ('b', 'air', 'FFT1', ?)",
        (NOW_MS - 1000,),
    )
    con.execute(
        "INSERT INTO feed_history (source, title, pub_ms) VALUES ('firewire', 'Engine 1 dispatched', ?)",
        (NOW_MS - 1000,),
    )
    con.commit()
    con.close()
    counts = dict(AI.fetch_sidecar_counts(db_path))
    assert counts["alerts"]["total"] == 2
    assert counts["alerts"]["by_severity"]["high"] == 1
    assert counts["aircraft"]["mil"] == 1
    assert counts["aircraft"]["air"] == 1
    assert counts["feed"]["by_source"]["firewire"] == 1


# ---------------------------------------------------------------- retrieval

def test_retrieve_matches_keywords_and_never_returns_raw_json(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _item(
        db_path,
        "i1",
        "Flooding closes Ocean Avenue",
        "Water over the road near the beachfront.",
    )
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO feed_history (source, title, description, raw_json, pub_ms) "
        "VALUES ('firewire', 'Flooding on Ocean Avenue', 'SECRET DISPATCH TEXT', "
        "'{\"secret\": \"acars free text\"}', ?)",
        (NOW_MS,),
    )
    con.commit()
    con.close()
    records = AI.retrieve("flooding on Ocean Avenue", db_path)
    assert any(r["record_id"] == "news_item:i1" for r in records)
    assert any(r["record_id"].startswith("feed:") for r in records)
    # The raw text is never in a retrieval result.
    blob = json.dumps(records)
    assert "SECRET DISPATCH TEXT" not in blob
    assert "acars free text" not in blob
    assert "raw_json" not in blob


def test_retrieve_empty_without_keywords_or_records(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    assert AI.retrieve("the and of", db_path) == []
    assert AI.retrieve("flooding", db_path) == []


def test_retrieve_pulls_snapshot_only_on_topic(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _snapshot(db_path, "tides", {"cape_may_ft": 5.8}, NOW_MS)
    tide_records = AI.retrieve("what is the tide doing", db_path)
    assert any(r["record_id"] == "snapshot:tides" for r in tide_records)
    outage_records = AI.retrieve("are there outages", db_path)
    assert not any(r["record_id"] == "snapshot:tides" for r in outage_records)


# ---------------------------------------------------------------- Q&A

def test_qa_no_record_says_so_and_offers_stored_topics(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _alert(db_path, "a1", "Freeze Warning for Cape May County")
    answer = AI.answer_question("is there flooding", db_path)
    assert answer["answer"] == "I don't have a record of that"
    assert answer["citations"] == []
    assert answer["confidence"] is None
    assert answer["unofficial"] is True
    assert answer["emergencyNote"] == "Call 911 for emergencies"
    assert answer["closest_topics"][0]["title"] == "Freeze Warning for Cape May County"


def test_qa_no_key_returns_writer_not_configured_with_records(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _item(db_path, "i1", "Flooding closes Ocean Avenue", "Water over the road.")
    answer = AI.answer_question("flooding", db_path)
    assert answer["answer"] == "writer not configured"
    assert answer["citations"][0]["record_id"] == "news_item:i1"


def test_qa_stubbed_model_answer_citations_checked(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _item(db_path, "i1", "Flooding closes Ocean Avenue", "Water over the road.")
    stub = _gemini_stub(
        json.dumps(
            {
                "answer": "Ocean Avenue is closed by flooding [1].",
                "citations": [
                    {"record_id": "news_item:i1", "claim": "Ocean Avenue is closed"},
                    {"record_id": "news_item:made-up", "claim": "invented"},
                ],
                "confidence": 0.8,
            }
        )
    )
    answer = AI.answer_question(
        "flooding", db_path, api_key="test-key", transport=stub
    )
    assert answer["answer"] == "Ocean Avenue is closed by flooding [1]."
    assert answer["confidence"] == 0.8
    # The citation to a record the model was never given is dropped.
    assert [c["record_id"] for c in answer["citations"]] == ["news_item:i1"]


def test_qa_model_no_record_is_honoured(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _item(db_path, "i1", "Flooding closes Ocean Avenue", "Water over the road.")
    stub = _gemini_stub(
        json.dumps(
            {
                "answer": "I don't have a record of that",
                "citations": [],
                "confidence": None,
            }
        )
    )
    answer = AI.answer_question(
        "flooding near the airport", db_path, api_key="test-key", transport=stub
    )
    assert answer["answer"] == "I don't have a record of that"


# ---------------------------------------------------------------- forecaster

def _flood_setup(monkeypatch, tmp_path, tide_now=5.8, tide_prev=5.4):
    db_path = _db(monkeypatch, tmp_path)
    _alert(db_path, "nws-coastal-1", "Coastal Flood Warning")
    _snapshot(db_path, "tides", {"cape_may_ft": tide_prev}, NOW_MS - HOUR)
    _snapshot(db_path, "tides", {"cape_may_ft": tide_now}, NOW_MS)
    return db_path


def test_forecaster_flood_fires_without_model_and_dedupes(monkeypatch, tmp_path):
    db_path = _flood_setup(monkeypatch, tmp_path)
    stored = AI.run_forecaster(db_path, now_ms=NOW_MS)
    assert len(stored) == 1
    pred = stored[0]
    assert pred["rule_id"] == "flood-noreaster"
    assert pred["confidence"] == 0.7
    assert "news_alert:nws-coastal-1" in pred["source_record_ids"]
    assert pred["outcome"] == "open"
    # A second run while the first prediction is open stores nothing.
    assert AI.run_forecaster(db_path, now_ms=NOW_MS + 60 * 1000) == []


def test_forecaster_draft_without_confidence_is_rejected(monkeypatch, tmp_path):
    db_path = _flood_setup(monkeypatch, tmp_path)
    # The stub drafts a version that drops the confidence number.
    stub = _gemini_stub(json.dumps({"text": "Water is coming, be careful."}))
    stored = AI.run_forecaster(
        db_path, api_key="test-key", transport=stub, now_ms=NOW_MS
    )
    assert len(stored) == 1
    assert "5.80 ft" in stored[0]["text"]  # rules-only text stands


def test_forecaster_draft_with_confidence_is_used(monkeypatch, tmp_path):
    db_path = _flood_setup(monkeypatch, tmp_path)
    stub = _gemini_stub(
        json.dumps(
            {
                "text": "Water may cover the usual first-flood roads by the next "
                "high tide. Confidence 0.70."
            }
        )
    )
    stored = AI.run_forecaster(
        db_path, api_key="test-key", transport=stub, now_ms=NOW_MS
    )
    assert "Water may cover" in stored[0]["text"]


def test_forecaster_outage_and_mil_surge(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _alert(db_path, "nws-storm-1", "Severe Thunderstorm Warning")
    _snapshot(db_path, "lightning", {"flashes30m": 1, "flashes60m": 3}, NOW_MS)
    _snapshot(db_path, "outages", {"customers_out": 0}, NOW_MS)
    _snapshot(db_path, "aircraft", {"mil": 9}, NOW_MS)
    for i in range(30):
        _snapshot(db_path, "aircraft", {"mil": 2}, NOW_MS - (i + 1) * 3600 * 1000)
    stored = AI.run_forecaster(db_path, now_ms=NOW_MS)
    rule_ids = {p["rule_id"] for p in stored}
    assert rule_ids == {"outage-thunderstorm", "mil-surge-pattern"}
    mil = next(p for p in stored if p["rule_id"] == "mil-surge-pattern")
    assert "pattern note, not a prediction of intent" in mil["text"]


# ---------------------------------------------------------------- outcomes

def test_outcome_checker_confirms_flood_from_tide_max(monkeypatch, tmp_path):
    db_path = _flood_setup(monkeypatch, tmp_path)
    AI.run_forecaster(db_path, now_ms=NOW_MS)
    # The tide reaches the threshold inside the prediction window.
    _snapshot(db_path, "tides", {"cape_may_ft": 6.3}, NOW_MS + 3 * HOUR)
    result = AI.check_outcomes(db_path, now_ms=NOW_MS + 7 * HOUR)
    assert result == {"checked": 1, "confirmed": 1, "wrong": 0, "still_open": 0}
    assert AI.accuracy_counts(db_path) == {"open": 0, "confirmed": 1, "wrong": 0}


def test_outcome_checker_marks_flood_wrong_when_tide_never_came_close(monkeypatch, tmp_path):
    db_path = _flood_setup(monkeypatch, tmp_path)
    AI.run_forecaster(db_path, now_ms=NOW_MS)
    _snapshot(db_path, "tides", {"cape_may_ft": 5.0}, NOW_MS + 3 * HOUR)
    result = AI.check_outcomes(db_path, now_ms=NOW_MS + 7 * HOUR)
    assert result["wrong"] == 1
    assert AI.accuracy_counts(db_path)["wrong"] == 1


def test_outcome_checker_leaves_mil_surge_open_uncheckable(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _snapshot(db_path, "aircraft", {"mil": 9}, NOW_MS)
    for i in range(30):
        _snapshot(db_path, "aircraft", {"mil": 2}, NOW_MS - (i + 1) * 3600 * 1000)
    AI.run_forecaster(db_path, now_ms=NOW_MS)
    result = AI.check_outcomes(db_path, now_ms=NOW_MS + 7 * HOUR)
    assert result["still_open"] == 1
    preds = AI.list_predictions(db_path)
    assert preds[0]["outcome"] == "open"
    assert preds[0]["checked_against"] == "outcome uncheckable — still open"


def test_outcome_checker_confirms_outage_on_clear_rise(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _alert(db_path, "nws-storm-1", "Severe Thunderstorm Warning")
    _snapshot(db_path, "lightning", {"flashes30m": 1, "flashes60m": 3}, NOW_MS)
    _snapshot(db_path, "outages", {"customers_out": 0}, NOW_MS - HOUR)
    _snapshot(db_path, "outages", {"customers_out": 0}, NOW_MS)
    AI.run_forecaster(db_path, now_ms=NOW_MS)
    _snapshot(db_path, "outages", {"customers_out": 120}, NOW_MS + HOUR)
    result = AI.check_outcomes(db_path, now_ms=NOW_MS + 3 * HOUR)
    assert result["confirmed"] == 1


def test_brief_prompt_carries_trend_lines_when_present(monkeypatch, tmp_path):
    from datetime import date

    from app import daily_brief

    day = date(2026, 11, 17)
    prompt = daily_brief.build_brief_prompt(
        [], [], brief_date=day, trend_lines=["Tide at Cape May: 3.50 ft MLLW."]
    )
    assert "Tide at Cape May: 3.50 ft MLLW." in prompt
    assert daily_brief.build_brief_prompt([], [], brief_date=day).find("Trends") == -1


# ---------------------------------------------------------------- trends

def test_trend_lines_omit_missing_series(monkeypatch, tmp_path):
    db_path = _db(monkeypatch, tmp_path)
    _alert(db_path, "a1", "Freeze Warning", last_seen=NOW_S - 100)
    _snapshot(db_path, "tides", {"cape_may_ft": 3.0}, NOW_MS - 24 * HOUR)
    _snapshot(db_path, "tides", {"cape_may_ft": 3.5}, NOW_MS)
    _snapshot(db_path, "space-weather", {"kp": 2}, NOW_MS)
    lines = AI.trend_lines(db_path, now_ms=NOW_MS)
    assert any("Tide at Cape May: 3.50 ft" in line for line in lines)
    assert any("Kp 2" in line for line in lines)
    # No outages series stored → no outages line, never faked.
    assert not any("Outages:" in line for line in lines)
    assert any("Alerts:" in line for line in lines)
