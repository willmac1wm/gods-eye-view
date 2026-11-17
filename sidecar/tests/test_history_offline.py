"""History / replay reads (D3, app/history.py). No network, fixture DB only.

Covers: the ms-epoch boundary (a seconds-epoch query returns nothing,
never a wrong-century row), the bbox filter, the kind filter, the
limit + window clamps, the empty-window result, the status window, and
that raw_json / description never appear in a response. The fixture DB
is built in tmp_path; the live DB is never touched.
"""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import history  # noqa: E402

# 2026-11-15 12:00 UTC in ms — inside the real store's window.
T0 = 1794772800000
HOUR = 3600 * 1000


def _fixture_db(path):
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE aircraft_history (hex TEXT, kind TEXT, flight TEXT,"
        " lat REAL, lon REAL, alt REAL, speed REAL, track REAL,"
        " vrate REAL, ac_type TEXT, cat TEXT, seen_at INTEGER)"
    )
    con.execute(
        "CREATE INDEX idx_ah_time ON aircraft_history(seen_at)"
    )
    con.execute(
        "CREATE TABLE feed_history (id TEXT, source TEXT, source_label TEXT,"
        " cat TEXT, type TEXT, subtype TEXT, title TEXT, description TEXT,"
        " lat REAL, lng REAL, pub_ms INTEGER, created_at INTEGER,"
        " raw_json TEXT)"
    )
    con.execute("CREATE INDEX idx_feed_hist_pub_ms ON feed_history(pub_ms)")
    # Two aircraft in the county bbox at T0 and T0+30m; one mil; one far away.
    con.execute(
        "INSERT INTO aircraft_history VALUES"
        " ('a1', 'air', 'N123', 39.0, -74.9, 5000, 200, 90, 0, 'B738',"
        " 'A3', ?)",
        (T0,),
    )
    con.execute(
        "INSERT INTO aircraft_history VALUES"
        " ('a2', 'air', 'N456', 39.1, -74.8, 3000, 150, 180, 0, 'C172',"
        " 'A1', ?)",
        (T0 + 30 * 60 * 1000,),
    )
    con.execute(
        "INSERT INTO aircraft_history VALUES"
        " ('m1', 'mil', 'RCH1', 39.05, -74.85, 20000, 400, 270, 0, 'C17',"
        " 'M2', ?)",
        (T0 + 10 * 60 * 1000,),
    )
    con.execute(
        "INSERT INTO aircraft_history VALUES"
        " ('far', 'air', 'N999', 40.5, -73.0, 10000, 300, 0, 0, 'A320',"
        " 'A3', ?)",
        (T0 + 5 * 60 * 1000,),
    )
    # Two feed items; one outside the window.
    con.execute(
        "INSERT INTO feed_history VALUES"
        " ('f1', 'firewire', 'Fire Wire', 'fire', 'DISPATCH', 'FIRE',"
        " 'Structure fire', 'secret description', 39.0, -74.9, ?, 0,"
        " '{\"raw\": true}')",
        (T0 + 2 * 60 * 1000,),
    )
    con.execute(
        "INSERT INTO feed_history VALUES"
        " ('f2', 'nws', 'NWS', 'weather', 'ALERT', 'WARNING',"
        " 'Freeze Warning', 'secret description', 39.0, -74.9, ?, 0,"
        " '{\"raw\": true}')",
        (T0 + 20 * 60 * 1000,),
    )
    con.execute(
        "INSERT INTO feed_history VALUES"
        " ('old', 'firewire', 'Fire Wire', 'fire', 'DISPATCH', 'FIRE',"
        " 'Old call', 'secret description', 39.0, -74.9, ?, 0,"
        " '{\"raw\": true}')",
        (T0 - 2 * HOUR,),
    )
    con.commit()
    return con


def _isolated(monkeypatch, tmp_path):
    db_path = tmp_path / "history.db"
    _fixture_db(db_path)
    monkeypatch.setattr(history, "DB_PATH", db_path)
    return history.open_db()


def test_seconds_epoch_query_returns_nothing_not_wrong_century(
    monkeypatch, tmp_path
):
    con = _isolated(monkeypatch, tmp_path)
    # Seconds epochs: 1970 in ms — the store holds no rows there.
    rows = history.query_aircraft(con, 1794772800, 1794776400)
    assert rows == []
    rows = history.query_feed(con, 1794772800, 1794776400)
    assert rows == []
    # The same instants as ms epochs return the fixture rows.
    rows = history.query_aircraft(con, T0, T0 + 30 * 60 * 1000)
    assert len(rows) == 4


def test_bbox_filter_keeps_only_county_rows(monkeypatch, tmp_path):
    con = _isolated(monkeypatch, tmp_path)
    rows = history.query_aircraft(
        con, T0, T0 + HOUR, bbox=history.HISTORY_COUNTY_BBOX
    )
    assert {r["hex"] for r in rows} == {"a1", "a2", "m1"}


def test_invalid_bbox_is_rejected(monkeypatch, tmp_path):
    _isolated(monkeypatch, tmp_path)
    for bad in ["39.0", "39.0,-74.9", "a,b,c,d", "40,0,39,0", "91,0,92,0"]:
        try:
            history.parse_bbox(bad)
        except ValueError as exc:
            assert str(exc) == "invalid_bbox"
        else:
            raise AssertionError(f"bbox {bad!r} was accepted")
    assert history.parse_bbox(None) is None
    assert history.parse_bbox("") is None


def test_kind_filter_and_invalid_kind(monkeypatch, tmp_path):
    con = _isolated(monkeypatch, tmp_path)
    rows = history.query_aircraft(con, T0, T0 + HOUR, kind="air")
    assert {r["hex"] for r in rows} == {"a1", "a2", "far"}
    rows = history.query_aircraft(con, T0, T0 + HOUR, kind="mil")
    assert [r["hex"] for r in rows] == ["m1"]
    rows = history.query_aircraft(con, T0, T0 + HOUR, kind="ship")
    assert rows == []
    try:
        history.query_aircraft(con, T0, T0 + HOUR, kind="balloon")
    except ValueError as exc:
        assert str(exc) == "invalid_kind"
    else:
        raise AssertionError("invalid kind was accepted")


def test_limit_clamps_to_500(monkeypatch, tmp_path):
    _isolated(monkeypatch, tmp_path)
    assert history.clamp_limit("999") == 500
    assert history.clamp_limit(0) == 1
    assert history.clamp_limit("abc") == 500
    assert history.clamp_limit(None) == 500
    assert history.clamp_limit(25) == 25


def test_window_clamps_to_24h_and_rejects_reversed(monkeypatch, tmp_path):
    _isolated(monkeypatch, tmp_path)
    start, end = history.resolve_window(
        T0 - 48 * HOUR, T0, now_ms=T0 + HOUR
    )
    assert end - start == 24 * HOUR
    assert end == T0
    try:
        history.resolve_window(T0 + HOUR, T0, now_ms=T0)
    except ValueError as exc:
        assert str(exc) == "invalid_window"
    else:
        raise AssertionError("reversed window was accepted")
    # Defaults: until=now, from=until-1h.
    start, end = history.resolve_window(None, None, now_ms=T0)
    assert (start, end) == (T0 - HOUR, T0)


def test_feed_source_filter_and_no_raw_payload(monkeypatch, tmp_path):
    con = _isolated(monkeypatch, tmp_path)
    rows = history.query_feed(con, T0, T0 + HOUR)
    assert [r["id"] for r in rows] == ["f1", "f2"]
    for row in rows:
        assert "raw_json" not in row
        assert "description" not in row
    rows = history.query_feed(con, T0, T0 + HOUR, source="nws")
    assert [r["id"] for r in rows] == ["f2"]


def test_empty_window_is_empty_not_an_error(monkeypatch, tmp_path):
    con = _isolated(monkeypatch, tmp_path)
    assert history.query_aircraft(con, T0 + 5 * HOUR, T0 + 6 * HOUR) == []
    assert history.query_feed(con, T0 + 5 * HOUR, T0 + 6 * HOUR) == []


def test_status_reports_the_honest_window(monkeypatch, tmp_path):
    con = _isolated(monkeypatch, tmp_path)
    status = history.history_status(con)
    assert status["aircraftRows"] == 4
    assert status["feedRows"] == 3
    assert status["oldestMs"] == T0 - 2 * HOUR
    assert status["newestMs"] == T0 + 30 * 60 * 1000


def test_status_on_empty_db_reports_zeros(monkeypatch, tmp_path):
    db_path = tmp_path / "empty.db"
    sqlite3.connect(db_path).close()
    monkeypatch.setattr(history, "DB_PATH", db_path)
    con = history.open_db()
    status = history.history_status(con)
    assert status == {
        "aircraftRows": 0,
        "feedRows": 0,
        "oldestMs": None,
        "newestMs": None,
    }


def test_open_db_is_read_only(monkeypatch, tmp_path):
    con = _isolated(monkeypatch, tmp_path)
    try:
        con.execute("INSERT INTO feed_history (id) VALUES ('x')")
    except sqlite3.OperationalError as exc:
        assert "readonly" in str(exc).lower()
    else:
        raise AssertionError("read-only DB accepted a write")


def test_open_db_missing_file_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(history, "DB_PATH", tmp_path / "nope.db")
    try:
        history.open_db()
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("missing DB did not raise")
