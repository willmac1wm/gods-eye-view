"""Offline tests for sidecar/merge_migrate.py (no network, temp DBs only)."""
import hashlib
import sqlite3

import merge_migrate

SCHEMA = """
CREATE TABLE aircraft_history (
    hex TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'air', flight TEXT,
    seen_at INTEGER NOT NULL);
CREATE TABLE news_items (id TEXT PRIMARY KEY, title TEXT, url TEXT UNIQUE);
CREATE TABLE news_alerts (incident_key TEXT PRIMARY KEY, title TEXT);
"""
DEST_ONLY = """
CREATE TABLE news_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE);
"""


def _make(path, extra_schema="", rows=()):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA + extra_schema)
    for sql, params in rows:
        conn.execute(sql, params)
    conn.commit()
    conn.close()
    return str(path)


def _all(path, sql):
    conn = sqlite3.connect(path)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


def _md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


AC = "INSERT INTO aircraft_history (hex, kind, flight, seen_at) VALUES (?,?,?,?)"
NI = "INSERT INTO news_items (id, title, url) VALUES (?,?,?)"
NA = "INSERT INTO news_alerts (incident_key, title) VALUES (?,?)"
NP = "INSERT INTO news_posts (slug) VALUES (?)"


def _pair(tmp_path, src_rows, dst_rows):
    source = _make(tmp_path / "old.db", rows=src_rows)
    dest = _make(tmp_path / "sidecar.db", DEST_ONLY, rows=dst_rows)
    return source, dest


def test_inserts_missing_and_keeps_destination_data(tmp_path):
    source, dest = _pair(
        tmp_path,
        [(AC, ("a1", "air", "UAL1", 100)), (AC, ("a1", "air", "UAL1", 200)),
         (NI, ("n1", "shared", "http://x/1")), (NI, ("n2", "old only", "http://x/2")),
         (NA, ("k1", "shared alert"))],
        [(AC, ("a1", "air", "UAL1", 100)),
         (NI, ("n1", "shared", "http://x/1")), (NI, ("n9", "sidecar only", "http://x/9")),
         (NA, ("k1", "shared alert")), (NA, ("k9", "sidecar only alert")),
         (NP, ("post-one",))],
    )
    code, report = merge_migrate.run_merge(source, dest)
    assert code == 0
    assert report["tables"]["aircraft_history"]["inserted"] == 1
    assert report["tables"]["news_items"]["inserted"] == 1
    assert report["tables"]["news_alerts"]["inserted"] == 0
    assert _all(dest, "SELECT seen_at FROM aircraft_history ORDER BY 1") == [(100,), (200,)]
    assert _all(dest, "SELECT id FROM news_items ORDER BY 1") == [("n1",), ("n2",), ("n9",)]
    assert _all(dest, "SELECT incident_key FROM news_alerts ORDER BY 1") == [("k1",), ("k9",)]
    assert _all(dest, "SELECT slug FROM news_posts") == [("post-one",)]
    assert report["dest_only"] == {"news_posts": 1}


def test_second_run_inserts_nothing(tmp_path):
    source, dest = _pair(tmp_path, [(NI, ("n2", "old", "http://x/2")),
                                    (AC, ("a1", "air", None, 5))], [])
    assert merge_migrate.run_merge(source, dest)[0] == 0
    code, report = merge_migrate.run_merge(source, dest)
    assert code == 0
    assert sum(r["inserted"] for r in report["tables"].values()) == 0


def test_destination_row_wins_and_difference_is_reported(tmp_path):
    source, dest = _pair(tmp_path, [(NA, ("k1", "old wording"))],
                         [(NA, ("k1", "sidecar wording"))])
    code, report = merge_migrate.run_merge(source, dest)
    assert code == 0
    assert report["tables"]["news_alerts"]["differing"] == 1
    assert report["tables"]["news_alerts"]["inserted"] == 0
    assert _all(dest, "SELECT title FROM news_alerts") == [("sidecar wording",)]


def test_unique_conflict_on_other_column_is_skipped(tmp_path):
    source, dest = _pair(tmp_path, [(NI, ("old-id", "t", "http://x/same"))],
                         [(NI, ("new-id", "t", "http://x/same"))])
    code, report = merge_migrate.run_merge(source, dest)
    assert code == 0
    assert report["tables"]["news_items"]["skipped"] == 1
    assert _all(dest, "SELECT id FROM news_items") == [("new-id",)]


def test_duplicate_keyless_source_rows_are_all_kept(tmp_path):
    source, dest = _pair(tmp_path, [(AC, ("a1", "air", "X", 7)),
                                    (AC, ("a1", "air", "X", 7))], [])
    code, report = merge_migrate.run_merge(source, dest)
    assert code == 0
    assert report["tables"]["aircraft_history"]["inserted"] == 2


def test_dry_run_writes_nothing(tmp_path):
    source, dest = _pair(tmp_path, [(NI, ("n2", "old", "http://x/2"))], [])
    before = _md5(dest)
    code, report = merge_migrate.run_merge(source, dest, dry_run=True)
    assert code == 0
    assert report["tables"]["news_items"]["inserted"] == 1
    assert report["backup"] is None
    assert _all(dest, "SELECT COUNT(*) FROM news_items") == [(0,)]
    assert _md5(dest) == before
    assert [p.name for p in tmp_path.iterdir() if ".pre-merge-" in p.name] == []


def test_real_run_backs_up_destination_and_leaves_source_untouched(tmp_path):
    source, dest = _pair(tmp_path, [(NI, ("n2", "old", "http://x/2"))],
                         [(NA, ("k9", "sidecar only"))])
    source_before = _md5(source)
    code, report = merge_migrate.run_merge(source, dest)
    assert code == 0
    assert _md5(source) == source_before
    assert sorted(p.name for p in tmp_path.iterdir() if p.name.startswith("old.db")) == ["old.db"]
    assert _all(report["backup"], "SELECT COUNT(*) FROM news_items") == [(0,)]
    assert _all(report["backup"], "SELECT incident_key FROM news_alerts") == [("k9",)]


def _exit_code(fn):
    try:
        fn()
    except SystemExit as exc:
        return exc.code
    return None


def test_missing_destination_is_a_usage_error(tmp_path):
    source = _make(tmp_path / "old.db")
    assert _exit_code(lambda: merge_migrate.run_merge(source, str(tmp_path / "nope.db"))) == 2


def test_source_only_table_is_a_hard_error(tmp_path):
    source = _make(tmp_path / "old.db", "CREATE TABLE surprise (id INTEGER PRIMARY KEY);")
    dest = _make(tmp_path / "sidecar.db")
    assert _exit_code(lambda: merge_migrate.run_merge(source, dest, dry_run=True)) == 2


def test_column_mismatch_is_a_hard_error(tmp_path):
    source = _make(tmp_path / "old.db")
    dest = _make(tmp_path / "sidecar.db")
    conn = sqlite3.connect(dest)
    conn.execute("ALTER TABLE news_alerts ADD COLUMN extra TEXT")
    conn.commit()
    conn.close()
    assert _exit_code(lambda: merge_migrate.run_merge(source, dest, dry_run=True)) == 2
