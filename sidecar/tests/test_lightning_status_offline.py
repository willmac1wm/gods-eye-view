"""Lightning status reads (D4, app/lightning_watch.lightning_status).

No network, no GLM parsing, fixture DB only. Covers: county flash
counts in the trailing 30/60 minutes, the last county flash time, the
empty-DB result, and the missing-DB error. The status path never
imports netCDF4.
"""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import lightning_watch  # noqa: E402

NOW = 1794772800.0  # 2026-11-15 12:00 UTC, seconds epoch


def _fixture_db(path):
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE lightning_flashes (flash_key TEXT PRIMARY KEY,"
        " time_s REAL, lat REAL, lon REAL, zone TEXT, seen_at REAL)"
    )
    con.execute(
        "CREATE TABLE lightning_alert_state (incident_key TEXT PRIMARY KEY,"
        " last_alert_s REAL, last_county_s REAL)"
    )
    # 3 county flashes in the last 30 min, 2 more in the 30-60 min band,
    # 1 ring flash (not counted), 1 old county flash.
    for i, (offset, zone) in enumerate(
        [
            (60, "county"),
            (600, "county"),
            (1700, "county"),
            (2000, "county"),
            (3500, "county"),
            (300, "ring"),
            (7200, "county"),
        ]
    ):
        con.execute(
            "INSERT INTO lightning_flashes VALUES (?, ?, 39.0, -74.9, ?, ?)",
            (f"f{i}", NOW - offset, zone, NOW - offset),
        )
    con.commit()
    con.close()


def test_counts_and_last_flash(monkeypatch, tmp_path):
    db_path = tmp_path / "lightning.db"
    _fixture_db(db_path)
    monkeypatch.setattr(lightning_watch, "DB_PATH", db_path)
    status = lightning_watch.lightning_status(now_s=NOW)
    assert status["flashes30m"] == 3
    assert status["flashes60m"] == 5
    assert status["lastFlashMs"] == int((NOW - 60) * 1000)
    assert status["checkedAtMs"] == int(NOW * 1000)


def test_empty_db_reports_zeros(monkeypatch, tmp_path):
    db_path = tmp_path / "empty.db"
    con = sqlite3.connect(db_path)
    con.execute(
        "CREATE TABLE lightning_flashes (flash_key TEXT PRIMARY KEY,"
        " time_s REAL, lat REAL, lon REAL, zone TEXT, seen_at REAL)"
    )
    con.commit()
    con.close()
    monkeypatch.setattr(lightning_watch, "DB_PATH", db_path)
    status = lightning_watch.lightning_status(now_s=NOW)
    assert status["flashes30m"] == 0
    assert status["flashes60m"] == 0
    assert status["lastFlashMs"] is None


def test_missing_tables_report_zeros(monkeypatch, tmp_path):
    db_path = tmp_path / "bare.db"
    sqlite3.connect(db_path).close()
    monkeypatch.setattr(lightning_watch, "DB_PATH", db_path)
    status = lightning_watch.lightning_status(now_s=NOW)
    assert status["flashes30m"] == 0
    assert status["lastFlashMs"] is None


def test_missing_db_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(lightning_watch, "DB_PATH", tmp_path / "nope.db")
    try:
        lightning_watch.lightning_status(now_s=NOW)
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("missing lightning DB did not raise")
