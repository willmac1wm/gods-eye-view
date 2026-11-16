#!/usr/bin/env python3
"""Cape Dispatch sidecar data migration — full SQLite copy + verification.

Copies ALL tables (schema + rows) from a source Cape Dispatch SQLite
database to a destination database, then verifies the copy:

  * PRAGMA integrity_check on the destination returns "ok"
  * the table list matches the source
  * row count per table matches the source exactly
  * MD5 + byte size of the destination file are recorded

This is Stage 3 of the gods-eye-view sidecar port. William overruled the
audit's move-only-news advice: ALL old data moves, including
aircraft_history and feed_history.

Safety rules (by design, not by convention):

  * The source is NEVER written to. The script copies the source file
    (plus any -wal / -shm siblings, so uncheckpointed WAL data is kept)
    into a temporary directory and reads only that copy. No -wal / -shm
    file is ever created next to the original.
  * The script NEVER prints, logs, or exports row contents. Only table
    names and row counts are reported. The `members` table (password
    hashes) is copied verbatim by the SQLite backup API — hashes stay
    hashes, and no credential or hash value ever appears in output.
  * The destination DB file is never committed to git (it is ~185 MB).
    It ships by running this script on Legion at cutover-prep time.

Idempotency: if the destination file already exists, the script REFUSES
to run and exits non-zero, unless --force is given, in which case the
existing destination is deleted first and re-created from scratch.
Re-running with --force against the same source is therefore safe and
produces an identical result.

Usage (workspace test):
    python3 migrate.py --source ~/workspace/gods-eye-port/backup-2026-11-15/cape_dispatch.db \
                       --dest   ~/workspace/gods-eye-port/data-migration/test-dest/cape_dispatch.db

Usage (Legion, cutover-prep time — run from an elevated prompt):
    C:\\cape-dispatch\\.venv\\Scripts\\python.exe C:\\gods-eye-view\\sidecar\\migrate.py ^
        --source C:\\cape-dispatch\\cape_dispatch.db ^
        --dest   C:\\Users\\willm\\gods-eye-view\\sidecar\\data\\cape_dispatch.db

    (Paths assume the sidecar repo layout from the sibling Stage 2 build:
    the sidecar reads its DB at sidecar/data/cape_dispatch.db inside the
    gods-eye-view repo. Adjust --dest if the sibling placed it elsewhere.)

    Take a fresh backup of the live DB BEFORE running this on Legion, and
    stop the CapeDispatch service first if the live DB is being written
    while the copy runs, so the copy is a consistent snapshot.

Dry run (prints the plan + source table counts, writes nothing):
    python3 migrate.py --source <path> --dest <path> --dry-run

Exit codes: 0 = success (verified), 1 = verification failure,
2 = usage / pre-flight error (missing source, source == dest,
dest exists without --force, ...).
"""

import argparse
import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile

EXPECTED_TABLES = {
    "aircraft_history",
    "audit_log",
    "auth_events",
    "events",
    "feed_history",
    "fx_situations",
    "media_items",
    "members",
    "news_alerts",
    "news_items",
    "reports",
}


def fail(message, code=2):
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(code)


def md5_of(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def table_counts(conn):
    """Return {table: row_count} for every user table, sorted by name.

    Row counts only — row contents are never read or printed.
    """
    tables = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    return {
        table: conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        for table in tables
    }


def copy_source_to_temp(source_path):
    """Copy source DB (+ -wal / -shm siblings, if any) to a temp dir.

    Returns (temp_dir, temp_db_path). The caller must delete temp_dir.
    Reading the copy — never the original — is what guarantees the
    source is untouched (no -wal / -shm side effects on the original).
    """
    temp_dir = tempfile.mkdtemp(prefix="cape-dispatch-migrate-")
    temp_db = os.path.join(temp_dir, os.path.basename(source_path))
    shutil.copyfile(source_path, temp_db)
    for suffix in ("-wal", "-shm"):
        sibling = source_path + suffix
        if os.path.exists(sibling):
            shutil.copyfile(sibling, temp_db + suffix)
    return temp_dir, temp_db


def open_read_only(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def main():
    parser = argparse.ArgumentParser(
        description="Migrate the Cape Dispatch SQLite DB to the sidecar DB "
                    "(full copy of all tables, then verify)."
    )
    parser.add_argument("--source", required=True,
                        help="Path to the source cape_dispatch.db")
    parser.add_argument("--dest", required=True,
                        help="Path to write the destination cape_dispatch.db")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the plan and source table counts; "
                             "write nothing.")
    parser.add_argument("--force", action="store_true",
                        help="If the destination already exists, delete it "
                             "and re-create it. Without --force, an existing "
                             "destination is a hard error.")
    args = parser.parse_args()

    source = os.path.abspath(args.source)
    dest = os.path.abspath(args.dest)

    # ---- pre-flight -------------------------------------------------
    if not os.path.isfile(source):
        fail(f"source not found: {source}")
    if source == dest:
        fail("source and destination are the same file — refusing to run")
    if os.path.exists(dest) and not args.force:
        fail(
            f"destination already exists: {dest}\n"
            "       Re-run with --force to delete it and re-create it, "
            "or pick a different --dest."
        )
    if os.path.exists(dest) and args.force:
        print(f"NOTE: --force given; existing destination will be replaced: {dest}")

    source_size = os.path.getsize(source)
    source_md5 = md5_of(source)
    print(f"Source:      {source}")
    print(f"Source size: {source_size:,} bytes, MD5 {source_md5}")
    print(f"Destination: {dest}")

    # ---- read source counts from a temp copy (source never touched) --
    temp_dir, temp_db = copy_source_to_temp(source)
    try:
        src_conn = open_read_only(temp_db)
        try:
            src_counts = table_counts(src_conn)
        finally:
            src_conn.close()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    missing = EXPECTED_TABLES - set(src_counts)
    extra = set(src_counts) - EXPECTED_TABLES
    if missing:
        fail(f"source is missing expected table(s): {sorted(missing)}")
    if extra:
        print(f"WARNING: source has unexpected extra table(s), "
              f"they will be copied too: {sorted(extra)}")

    print(f"Source tables: {len(src_counts)}, "
          f"total rows: {sum(src_counts.values()):,}")
    for table in sorted(src_counts):
        print(f"  {table:<18} {src_counts[table]:>10,}")

    if args.dry_run:
        print("DRY RUN — no files written. Re-run without --dry-run "
              "to perform the migration.")
        return 0

    # ---- copy --------------------------------------------------------
    if os.path.exists(dest):
        os.remove(dest)
    dest_dir = os.path.dirname(dest)
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)

    temp_dir, temp_db = copy_source_to_temp(source)
    try:
        src_conn = open_read_only(temp_db)
        dst_conn = sqlite3.connect(dest)
        try:
            # SQLite backup API: page-for-page copy, schema + all rows,
            # including members (hashes copied verbatim, never read out).
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
            src_conn.close()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    # ---- verify ------------------------------------------------------
    dest_size = os.path.getsize(dest)
    dest_md5 = md5_of(dest)

    dst_conn = open_read_only(dest)
    try:
        integrity = dst_conn.execute("PRAGMA integrity_check").fetchone()[0]
        dst_counts = table_counts(dst_conn)
    finally:
        dst_conn.close()

    print(f"Destination size: {dest_size:,} bytes, MD5 {dest_md5}")
    print(f"Dest integrity_check: {integrity}")

    errors = []
    if integrity != "ok":
        errors.append(f"integrity_check returned {integrity!r}, expected 'ok'")
    if set(dst_counts) != set(src_counts):
        errors.append(
            f"table list mismatch — source-only: "
            f"{sorted(set(src_counts) - set(dst_counts))}, "
            f"dest-only: {sorted(set(dst_counts) - set(src_counts))}"
        )
    for table in sorted(src_counts):
        s, d = src_counts[table], dst_counts.get(table)
        status = "OK" if s == d else "MISMATCH"
        print(f"  {table:<18} source {s:>10,}  dest {str(d):>10}  {status}")
        if s != d:
            errors.append(f"row count mismatch on {table}: "
                          f"source {s}, dest {d}")

    if errors:
        print("VERIFICATION FAILED:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print("VERIFIED: integrity ok, all table counts match, "
          f"dest MD5 {dest_md5}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
