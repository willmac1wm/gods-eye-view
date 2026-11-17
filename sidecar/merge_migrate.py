#!/usr/bin/env python3
"""Cape Dispatch sidecar data MERGE — add missing old-site rows to a live sidecar DB.

migrate.py is a wipe-and-reload: it refuses to run when the destination
exists, and with --force it deletes the destination first. That is right for
the first copy and wrong ever after, because the sidecar now owns data the
old site never had (its own news_alerts rows, news_posts, news_post_sources).

This script is the safe second pass. For every table that exists in BOTH
databases it inserts the source rows the destination does not have yet, and
nothing else:

  * Destination rows are NEVER updated and NEVER deleted. When the same key
    exists on both sides with different content, the destination row wins
    and the table is reported with a "differing" count.
  * Tables that exist only in the destination (news_posts,
    news_post_sources, ...) are not touched; their row counts are verified
    unchanged.
  * A table that exists only in the source, or whose columns differ between
    the two databases, is a hard error - a human has to look at that.

Row identity:
  * tables with a PRIMARY KEY  -> the primary key
  * tables without one         -> NATURAL_KEYS below (aircraft_history has no
                                  primary key; a sighting is hex+kind+seen_at)
A source row whose key is free but which collides with another UNIQUE
constraint in the destination (e.g. news_items.url) is skipped and counted
under "skipped", not treated as an error.

Safety rules (same spirit as migrate.py):
  * The source is NEVER written to. It is opened read-only and snapshotted
    into a temp directory with the SQLite backup API; only that snapshot is
    read.
  * Before a real run the destination is backed up next to itself as
    <dest>.pre-merge-<UTC timestamp>.bak (SQLite backup API).
  * The whole merge is ONE transaction. It is verified before commit
    (integrity_check, per-table arithmetic, destination-only tables
    unchanged, nothing left missing); any failure rolls everything back.
  * --dry-run does the full merge and verification, prints the same report,
    then rolls back. No backup file is written.
  * Row contents are never printed - table names and counts only.

Idempotent: a second run against the same source inserts 0 rows.

While the merge transaction is open the destination is write-locked. On the
real databases that is seconds, but stop the sidecar first if you can, and
run this only after the old site has stopped writing, or the gap reopens.

Usage (Legion, at cutover):
    python sidecar\\merge_migrate.py ^
        --source C:\\cape-dispatch\\cape_dispatch.db ^
        --dest   C:\\Users\\willm\\gods-eye-view-prod\\sidecar\\data\\cape_dispatch.db ^
        --dry-run
    (then the same command without --dry-run)

Exit codes: 0 = merged (or dry run) and verified, 1 = verification failed
(rolled back), 2 = usage / pre-flight error.
"""

import argparse
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Row identity for tables that have no PRIMARY KEY.
NATURAL_KEYS = {
    "aircraft_history": ("hex", "kind", "seen_at"),
}


def fail(message, code=2):
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(code)


def q(name):
    return '"' + name.replace('"', '""') + '"'


def open_read_only(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)


def backup_copy(src_path, dst_path):
    """Consistent copy of src_path (WAL included) without writing to it."""
    src = open_read_only(src_path)
    dst = sqlite3.connect(dst_path)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


def user_tables(conn, schema):
    return [
        row[0]
        for row in conn.execute(
            f"SELECT name FROM {schema}.sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def table_columns(conn, schema, table):
    """Return (column names, primary-key column names in key order)."""
    info = conn.execute(f"PRAGMA {schema}.table_info({q(table)})").fetchall()
    cols = [row[1] for row in info]
    pk = [row[1] for row in sorted(info, key=lambda r: r[5]) if row[5]]
    return cols, pk


def count(conn, schema, table):
    return conn.execute(f"SELECT COUNT(*) FROM {schema}.{q(table)}").fetchone()[0]


def plan_tables(conn):
    """Pre-flight: work out the key for every shared table, or fail."""
    src_tables = set(user_tables(conn, "src"))
    dst_tables = set(user_tables(conn, "main"))
    source_only = sorted(src_tables - dst_tables)
    if source_only:
        fail(f"table(s) exist in the source but not the destination: {source_only}")
    plan = {}
    for table in sorted(src_tables):
        src_cols, _ = table_columns(conn, "src", table)
        dst_cols, pk = table_columns(conn, "main", table)
        if sorted(src_cols) != sorted(dst_cols):
            fail(f"column mismatch on {table}: source {src_cols}, dest {dst_cols}")
        key = pk or list(NATURAL_KEYS.get(table, ()))
        if not key:
            fail(f"{table} has no primary key and no entry in NATURAL_KEYS")
        if not set(key) <= set(dst_cols):
            fail(f"key {key} for {table} is not a subset of its columns")
        plan[table] = {"cols": dst_cols, "key": key, "has_pk": bool(pk)}
    return plan, sorted(dst_tables - src_tables)


def merge_table(conn, table, cols, key, has_pk):
    t = q(table)
    match = " AND ".join(f"d.{q(k)} IS s.{q(k)}" for k in key)
    missing_where = f"NOT EXISTS (SELECT 1 FROM main.{t} d WHERE {match})"
    missing_sql = f"SELECT COUNT(*) FROM src.{t} s WHERE {missing_where}"

    before = count(conn, "main", table)
    source = count(conn, "src", table)
    candidates = conn.execute(missing_sql).fetchone()[0]

    differing = None
    rest = [c for c in cols if c not in key]
    if has_pk and rest:
        same = " AND ".join(f"d.{q(c)} IS s.{q(c)}" for c in rest)
        differing = conn.execute(
            f"SELECT COUNT(*) FROM src.{t} s JOIN main.{t} d ON {match} "
            f"WHERE NOT ({same})"
        ).fetchone()[0]

    col_list = ", ".join(q(c) for c in cols)
    inserted = conn.execute(
        f"INSERT OR IGNORE INTO main.{t} ({col_list}) "
        f"SELECT {col_list} FROM src.{t} s WHERE {missing_where}"
    ).rowcount

    return {
        "before": before,
        "source": source,
        "inserted": inserted,
        "skipped": candidates - inserted,
        "differing": differing,
        "after": count(conn, "main", table),
        "still_missing": conn.execute(missing_sql).fetchone()[0],
    }


def run_merge(source, dest, dry_run=False):
    """Merge source into dest. Returns (exit_code, report)."""
    source = os.path.abspath(source)
    dest = os.path.abspath(dest)
    if not os.path.isfile(source):
        fail(f"source not found: {source}")
    if not os.path.isfile(dest):
        fail(f"destination not found: {dest}\n"
             "       merge_migrate.py only merges into an existing sidecar DB; "
             "use migrate.py for the first copy.")
    if source == dest:
        fail("source and destination are the same file - refusing to run")

    print(f"Source:      {source}")
    print(f"Destination: {dest}")
    print(f"Mode:        {'DRY RUN (rolled back)' if dry_run else 'MERGE'}")

    report = {"tables": {}, "dest_only": {}, "backup": None, "errors": []}
    temp_dir = tempfile.mkdtemp(prefix="cape-dispatch-merge-")
    conn = None
    try:
        snapshot = os.path.join(temp_dir, "source-snapshot.db")
        backup_copy(source, snapshot)

        if not dry_run:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            report["backup"] = f"{dest}.pre-merge-{stamp}.bak"
            backup_copy(dest, report["backup"])
            print(f"Backup:      {report['backup']}")

        conn = sqlite3.connect(dest, timeout=30, isolation_level=None)
        conn.execute("ATTACH DATABASE ? AS src", (snapshot,))
        plan, dest_only = plan_tables(conn)

        conn.execute("BEGIN IMMEDIATE")
        try:
            dest_only_before = {t: count(conn, "main", t) for t in dest_only}
            for table, spec in plan.items():
                report["tables"][table] = merge_table(conn, table, **spec)

            errors = report["errors"]
            for table, r in report["tables"].items():
                if r["after"] != r["before"] + r["inserted"]:
                    errors.append(f"{table}: {r['before']} + {r['inserted']} "
                                  f"inserted != {r['after']} after")
                if r["still_missing"] != r["skipped"]:
                    errors.append(f"{table}: {r['still_missing']} source rows "
                                  f"still missing, expected {r['skipped']} skipped")
            for table, n in dest_only_before.items():
                after = count(conn, "main", table)
                report["dest_only"][table] = after
                if after != n:
                    errors.append(f"destination-only table {table} changed: "
                                  f"{n} -> {after}")
            integrity = conn.execute("PRAGMA main.integrity_check").fetchone()[0]
            if integrity != "ok":
                errors.append(f"integrity_check returned {integrity!r}")

            if errors or dry_run:
                conn.execute("ROLLBACK")
            else:
                conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    finally:
        if conn is not None:
            conn.close()
        shutil.rmtree(temp_dir, ignore_errors=True)

    print(f"  {'table':<18} {'dest before':>11} {'source':>9} {'inserted':>9} "
          f"{'skipped':>8} {'differing':>9} {'dest after':>11}")
    for table, r in report["tables"].items():
        differing = "-" if r["differing"] is None else f"{r['differing']:,}"
        print(f"  {table:<18} {r['before']:>11,} {r['source']:>9,} "
              f"{r['inserted']:>9,} {r['skipped']:>8,} {differing:>9} "
              f"{r['after']:>11,}")
    for table, n in report["dest_only"].items():
        print(f"  {table:<18} {n:>11,}  destination-only, untouched")

    if report["errors"]:
        print("VERIFICATION FAILED - rolled back, destination unchanged:",
              file=sys.stderr)
        for error in report["errors"]:
            print(f"  - {error}", file=sys.stderr)
        return 1, report
    total = sum(r["inserted"] for r in report["tables"].values())
    if dry_run:
        print(f"DRY RUN - {total:,} rows would be inserted. Nothing was written.")
    else:
        print(f"VERIFIED and committed: {total:,} rows inserted, integrity ok.")
    return 0, report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Merge missing rows from the old Cape Dispatch DB into an "
                    "existing sidecar DB. Never updates or deletes destination rows."
    )
    parser.add_argument("--source", required=True,
                        help="Path to the old site's cape_dispatch.db (read-only)")
    parser.add_argument("--dest", required=True,
                        help="Path to the existing sidecar cape_dispatch.db")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run the full merge and verification, then roll back.")
    args = parser.parse_args(argv)
    code, _ = run_merge(args.source, args.dest, dry_run=args.dry_run)
    return code


if __name__ == "__main__":
    sys.exit(main())
