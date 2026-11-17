"""History / replay reads (D3) over the sidecar's own stored tables.

Read-only, always: every query opens the DB with SQLite URI ``mode=ro``
and the row dicts never carry ``raw_json`` or ``description`` — the replay
shows positions and published titles only, never raw ACARS/dispatch text.

Tables (verified against the 2026-11-15 backup, read-only):
  aircraft_history: hex, kind, flight, lat, lon, alt, speed, track,
    vrate, ac_type, cat, seen_at — seen_at is a MILLISECOND epoch.
    kind is 'air' | 'mil' | 'emg' (no 'ship' rows until the AIS key lands
    and the recorder runs). Indexed on (hex, seen_at) and (seen_at).
  feed_history: id, source, source_label, cat, type, subtype, title,
    description, lat, lng, pub_ms, created_at, raw_json — time is pub_ms
    (ms epoch). Indexed on pub_ms, source, cat.

A seconds-epoch query (e.g. from=1794800000) is a 1970 window in ms, so
it returns nothing — never a wrong-century row. That is pinned by test.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.getenv("NEWS_DB_FILE", "sidecar/data/cape_dispatch.db"))

#: Hard cap: at most this many rows per call; the UI pages in windows.
HISTORY_MAX_LIMIT = 500
#: Hard cap: at most this wide a window per call (the UI pages).
HISTORY_MAX_WINDOW_MS = 24 * 3600 * 1000
#: Default window when the caller gives no bounds: the last hour.
HISTORY_DEFAULT_WINDOW_MS = 3600 * 1000
#: County default bbox (south, west, north, east) for the replay layer.
HISTORY_COUNTY_BBOX = (38.90, -75.15, 39.35, -74.55)
#: Accepted kind filters for /api/history/aircraft.
AIRCRAFT_KINDS = frozenset({"air", "mil", "emg", "ship"})

_AIRCRAFT_COLUMNS = "hex, kind, flight, lat, lon, alt, speed, track, seen_at"
_FEED_COLUMNS = "id, source, source_label, cat, type, title, lat, lng, pub_ms"


def open_db() -> sqlite3.Connection:
    """Open the sidecar DB read-only. Raises FileNotFoundError if missing."""
    path = Path(DB_PATH)
    if not path.exists():
        raise FileNotFoundError(f"history db not found: {path}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def parse_ms(value) -> int | None:
    """Parse a millisecond epoch from a query value. None if absent/invalid."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return int(text)
        except ValueError:
            try:
                as_float = float(text)
            except ValueError:
                return None
            return int(as_float) if as_float.is_integer() else None
    return None


def resolve_window(from_raw, until_raw, now_ms: int) -> tuple[int, int]:
    """Resolve (from_ms, until_ms) for one replay call.

    Defaults: until=now, from=until-1h. from>until is an error. A window
    wider than 24 h is clamped to the latest 24 h (the UI pages).
    """
    until_ms = parse_ms(until_raw)
    if until_ms is None:
        until_ms = now_ms
    from_ms = parse_ms(from_raw)
    if from_ms is None:
        from_ms = until_ms - HISTORY_DEFAULT_WINDOW_MS
    if from_ms > until_ms:
        raise ValueError("invalid_window")
    if until_ms - from_ms > HISTORY_MAX_WINDOW_MS:
        from_ms = until_ms - HISTORY_MAX_WINDOW_MS
    return from_ms, until_ms


def clamp_limit(raw, default: int = HISTORY_MAX_LIMIT) -> int:
    """Clamp a limit query value into [1, HISTORY_MAX_LIMIT]."""
    try:
        limit = int(raw) if raw is not None else default
    except (TypeError, ValueError):
        return default
    if limit < 1:
        return 1
    if limit > HISTORY_MAX_LIMIT:
        return HISTORY_MAX_LIMIT
    return limit


def parse_bbox(raw) -> tuple[float, float, float, float] | None:
    """Parse a bbox query value "south,west,north,east". None if absent.

    Raises ValueError("invalid_bbox") on malformed or out-of-range input.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    parts = str(raw).split(",")
    if len(parts) != 4:
        raise ValueError("invalid_bbox")
    try:
        south, west, north, east = (float(p) for p in parts)
    except ValueError:
        raise ValueError("invalid_bbox") from None
    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise ValueError("invalid_bbox")
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise ValueError("invalid_bbox")
    if south > north or west > east:
        raise ValueError("invalid_bbox")
    return south, west, north, east


def query_aircraft(
    con: sqlite3.Connection,
    from_ms: int,
    until_ms: int,
    bbox: tuple[float, float, float, float] | None = None,
    kind: str | None = None,
    limit: int = HISTORY_MAX_LIMIT,
) -> list[dict]:
    """Stored aircraft/ship positions in [from_ms, until_ms], oldest first.

    kind filters the stored kind column ('air' | 'mil' | 'emg' | 'ship');
    anything else raises ValueError. Rows carry positions only.
    """
    if kind is not None and kind not in AIRCRAFT_KINDS:
        raise ValueError("invalid_kind")
    sql = (
        f"SELECT {_AIRCRAFT_COLUMNS} FROM aircraft_history "
        "WHERE seen_at >= ? AND seen_at <= ?"
    )
    params: list = [from_ms, until_ms]
    if kind is not None:
        sql += " AND kind = ?"
        params.append(kind)
    if bbox is not None:
        south, west, north, east = bbox
        sql += " AND lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?"
        params.extend([south, north, west, east])
    sql += " ORDER BY seen_at ASC LIMIT ?"
    params.append(limit)
    rows = con.execute(sql, params).fetchall()
    return [
        {
            "hex": r["hex"],
            "kind": r["kind"],
            "flight": r["flight"],
            "lat": r["lat"],
            "lon": r["lon"],
            "alt": r["alt"],
            "speed": r["speed"],
            "track": r["track"],
            "seen_at": r["seen_at"],
        }
        for r in rows
    ]


def query_feed(
    con: sqlite3.Connection,
    from_ms: int,
    until_ms: int,
    source: str | None = None,
    limit: int = HISTORY_MAX_LIMIT,
) -> list[dict]:
    """Stored feed items in [from_ms, until_ms], oldest first.

    Titles only — description and raw_json never leave the store.
    """
    sql = (
        f"SELECT {_FEED_COLUMNS} FROM feed_history "
        "WHERE pub_ms >= ? AND pub_ms <= ?"
    )
    params: list = [from_ms, until_ms]
    if source:
        sql += " AND source = ?"
        params.append(source)
    sql += " ORDER BY pub_ms ASC LIMIT ?"
    params.append(limit)
    rows = con.execute(sql, params).fetchall()
    return [
        {
            "id": r["id"],
            "source": r["source"],
            "source_label": r["source_label"],
            "cat": r["cat"],
            "type": r["type"],
            "title": r["title"],
            "lat": r["lat"],
            "lng": r["lng"],
            "pub_ms": r["pub_ms"],
        }
        for r in rows
    ]


def history_status(con: sqlite3.Connection) -> dict:
    """Row counts + the honest stored window across both tables.

    Tables missing (empty DB) report zero rows and null bounds — the UI
    shows that window, never an invented one.
    """
    status = {
        "aircraftRows": 0,
        "feedRows": 0,
        "oldestMs": None,
        "newestMs": None,
    }
    try:
        row = con.execute(
            "SELECT COUNT(*), MIN(seen_at), MAX(seen_at) FROM aircraft_history"
        ).fetchone()
        status["aircraftRows"] = row[0]
        bounds = [row[1], row[2]]
    except sqlite3.OperationalError:
        bounds = [None, None]
    try:
        row = con.execute(
            "SELECT COUNT(*), MIN(pub_ms), MAX(pub_ms) FROM feed_history"
        ).fetchone()
        status["feedRows"] = row[0]
        bounds.extend([row[1], row[2]])
    except sqlite3.OperationalError:
        pass
    present = [b for b in bounds if b is not None]
    if present:
        status["oldestMs"] = min(present)
        status["newestMs"] = max(present)
    return status
