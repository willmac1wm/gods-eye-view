"""IPAWS alert reads (D9, app/news_ingest.latest_source_alerts). No network,
fixture DB only.

Covers: only alerts whose sources include ipaws_watch are returned, newest
first; the match is exact (a source id that merely contains the substring
does not match); rows are slim (no report_md); the limit is honored; an
empty store returns []. The fixture DB is built in tmp_path; the live DB
is never touched.
"""
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import news_ingest  # noqa: E402

# 2026-11-15 12:00 UTC in seconds — inside the real store's window.
T0 = 1794772800


def _fixture_db(path):
    con = sqlite3.connect(path)
    con.execute(
        """CREATE TABLE news_alerts (
               incident_key TEXT PRIMARY KEY, rule_id TEXT, severity TEXT,
               title TEXT, summary TEXT, status TEXT, first_seen INTEGER,
               last_seen INTEGER, alerted_at INTEGER, source_count INTEGER,
               sources_json TEXT, urls_json TEXT, report_md TEXT)"""
    )
    rows = [
        # Newest IPAWS alert (ipaws_watch first in the sources list).
        ("ipaws-2", "ipaws", "high", "Flash Flood Warning",
         "IPAWS flash flood warning", "active", T0 - 3600, T0, T0,
         1, json.dumps(["ipaws_watch"]), json.dumps([]), "# report 2"),
        # An NWS alert — must not appear.
        ("nws-1", "nws", "high", "Freeze Warning",
         "NWS freeze warning", "active", T0 - 7200, T0 - 3600, T0 - 3600,
         1, json.dumps(["nws_mt_holly_alerts"]), json.dumps([]), "# report nws"),
        # Older IPAWS alert (ipaws_watch second in the sources list).
        ("ipaws-1", "ipaws", "critical", "Tornado Warning",
         "IPAWS tornado warning", "active", T0 - 86400, T0 - 86400, T0 - 86400,
         2, json.dumps(["county_alerts", "ipaws_watch"]), json.dumps([]), "# report 1"),
        # A source id that merely CONTAINS the substring — must not match.
        ("fake-1", "other", "low", "Not IPAWS",
         "A different watcher", "active", T0 - 100, T0 - 100, T0 - 100,
         1, json.dumps(["ipaws_watch_archive"]), json.dumps([]), "# report fake"),
    ]
    con.executemany("INSERT INTO news_alerts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.commit()
    return con


def _isolated(monkeypatch, tmp_path):
    db_path = tmp_path / "news.db"
    con = _fixture_db(db_path)
    monkeypatch.setattr(news_ingest, "DB_PATH", db_path)
    return con


def test_only_ipaws_alerts_returned_newest_first(monkeypatch, tmp_path):
    _isolated(monkeypatch, tmp_path)
    alerts = news_ingest.latest_source_alerts("ipaws_watch")
    assert [a["incident_key"] for a in alerts] == ["ipaws-2", "ipaws-1"]
    assert alerts[0]["title"] == "Flash Flood Warning"
    assert alerts[0]["severity"] == "high"
    assert alerts[0]["sources"] == ["ipaws_watch"]
    assert alerts[1]["sources"] == ["county_alerts", "ipaws_watch"]


def test_rows_are_slim_no_report_md(monkeypatch, tmp_path):
    _isolated(monkeypatch, tmp_path)
    alerts = news_ingest.latest_source_alerts("ipaws_watch")
    assert all("report_md" not in a for a in alerts)
    assert all("report_md" not in a for a in alerts)


def test_limit_is_honored(monkeypatch, tmp_path):
    _isolated(monkeypatch, tmp_path)
    alerts = news_ingest.latest_source_alerts("ipaws_watch", limit=1)
    assert len(alerts) == 1
    assert alerts[0]["incident_key"] == "ipaws-2"


def test_unknown_source_returns_empty(monkeypatch, tmp_path):
    _isolated(monkeypatch, tmp_path)
    assert news_ingest.latest_source_alerts("no-such-watcher") == []


def test_empty_store_returns_empty(monkeypatch, tmp_path):
    db_path = tmp_path / "news.db"
    con = sqlite3.connect(db_path)
    con.execute(
        """CREATE TABLE news_alerts (
               incident_key TEXT PRIMARY KEY, rule_id TEXT, severity TEXT,
               title TEXT, summary TEXT, status TEXT, first_seen INTEGER,
               last_seen INTEGER, alerted_at INTEGER, source_count INTEGER,
               sources_json TEXT, urls_json TEXT, report_md TEXT)"""
    )
    con.commit()
    con.close()
    monkeypatch.setattr(news_ingest, "DB_PATH", db_path)
    assert news_ingest.latest_source_alerts("ipaws_watch") == []
