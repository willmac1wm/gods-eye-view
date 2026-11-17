"""lightning_watch.py — Real-time lightning watcher for Cape Dispatch.

Built 2026-11-15. No Blitzortung station, no Blitzortung websocket,
no scraping. The sensor is NOAA's GOES-19 Geostationary Lightning
Mapper (GLM) L2 files on the public AWS S3 bucket noaa-goes19 — no
key, no AWS account, anonymous HTTPS (verified live 2026-11-15 from
this VM, and again while writing this module):

  * Listing: GET https://noaa-goes19.s3.amazonaws.com/
      ?list-type=2&prefix=GLM-L2-LCFA/<year>/<day-of-year>/<hour>/
      &max-keys=1000 — S3 ListObjectsV2, XML, keys in chronological
      order (the window start is in the filename).
  * File: GET https://noaa-goes19.s3.amazonaws.com/<key> — one
    NetCDF-4 file per 20-second window, ~350 KB, created ~40 s after
    the window ends. Example:
    OR_GLM-L2-LCFA_G19_s20263200100000_e20263200100200_c20263200100215.nc
  * GOES-19 is GOES-East since April 2025. The noaa-goes16 bucket no
    longer gets new data — do NOT use goes16.

File contents (confirmed by reading a real file, not guessed):
flash_lat / flash_lon (float32, degrees), flash_time_offset_of_first_event
(float32 seconds since time_coverage_start), flash_energy (J),
flash_quality_flag, flash_id. A file holds the whole GOES-East disk
(a few hundred flashes per 20 s on a busy day); this watcher keeps
only the flashes near Cape May County.

Two S3 behaviours found live and handled here:
  * A listed key can 404 on GET — a file is occasionally reprocessed
    and re-uploaded under a new creation timestamp (…_c…214.nc became
    …_c…215.nc within minutes). A 404 is logged and skipped, never
    fatal, and the next listing picks up the replacement.
  * A listing with max-keys returns the FIRST keys of the hour, not
    the latest. This watcher pages with start-after=<last seen key>
    and filters by the window-start timestamp in the filename, so a
    5-minute poll only ever downloads ~15 files.

Polling: every 5 minutes, list the current UTC hour (and the previous
hour on rollover), download new files, parse flashes. Fixed
User-Agent; on any failure the fetcher logs and skips the cycle — it
never retries in a burst.

Locality: flashes inside the county box are "county"; flashes in a
10-mile buffer ring around it are "ring" (counted, never alerted).
  * County box: lat 38.90–39.35, lon -75.15–-74.55 (Cape May County,
    NJ: Cape May Point ~38.93N to the Ocean City line ~39.31N,
    Delaware Bay shore ~-75.13 to the Atlantic side ~-74.60).
  * Ring: the box expanded by 10 miles (~0.145 deg lat, ~0.19 deg
    lon at 39N).

What alerts (counts and nearest town only — no raw file contents):
  * First flash inside the county box after >=30 min quiet = high
    ("Lightning detected over Cape May County"). On a cold start
    (empty store) the first county flash seen alerts — the store has
    no baseline yet, and the alert is truthful about current
    lightning. A restart mid-storm does NOT re-alert: the store
    remembers the last county flash.
  * Flash rate >=10/min inside the box over a trailing 5-minute
    window (>=50 flashes) = critical ("Frequent lightning over Cape
    May County").
  * Ring-only flashes never alert, just counted.
  * Cooldown 15 min per alert key, kept in this watcher's own SQLite
    store. Note: news_ingest.record_alert has its own 6-hour window
    per incident_key, so a repeat firing inside 6 h refreshes the
    report ("updated") rather than opening a new row — same as the
    other watchers.

Limits (say them plainly in any report): GLM sees TOTAL lightning
(in-cloud + cloud-to-ground) by optical flash, not just ground
strikes; accuracy is a few km; latency is ~1–2 min from flash to
file. A GLM flash over the county does not mean a strike hit the
ground there.

State: a small SQLite store (lightning_watch.db, LIGHTNING_DB_FILE
override) holds seen files, seen flashes (dedupe key: flash time
rounded to the second + lat/lon rounded to 3 decimals — GLM files
can repeat a flash across windows), and alert state, so a restart
does not re-alert or double-count.

Dependency: netCDF4 (pip install netCDF4) — the production box
needs it too. No pure-Python NetCDF parser was written; that would
be fragile.
"""
from __future__ import annotations

import logging
import math
import os
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("cape_dispatch.lightning_watch")

S3_BASE = "https://noaa-goes19.s3.amazonaws.com"
S3_BUCKET = "noaa-goes19"
POLL_INTERVAL_S = 300  # 5 minutes, same as the news fast refresher
USER_AGENT = "CapeDispatch/1.0 (lightning watch)"

# Cape May County, NJ (see module docstring for the bounds).
COUNTY_BBOX = (38.90, 39.35, -75.15, -74.55)  # lat_min, lat_max, lon_min, lon_max
BUFFER_MILES = 10.0
QUIET_S = 1800          # >=30 min with no county flash = a new storm
RATE_WINDOW_S = 300     # trailing window for the flash-rate rule
RATE_MIN_PER_MIN = 10   # >=10 flashes/min in the box = critical
ALERT_COOLDOWN_S = 900  # 15 min per alert key
LOOKBACK_S = 600        # files fetched per poll cover the last 10 min
MAX_FILES_PER_POLL = 200

DB_PATH = Path(os.environ.get("LIGHTNING_DB_FILE", "lightning_watch.db"))

# Nearest-town lookup (name, lat, lon). Coordinates are approximate
# (town centres, ~1 mi) — used only to name the nearest town and a
# rough distance in an alert, never as a precise location.
TOWNS: list[tuple[str, float, float]] = [
    ("Cape May", 38.94, -74.91),
    ("Cape May Point", 38.93, -74.97),
    ("West Cape May", 38.94, -74.94),
    ("Wildwood", 38.99, -74.81),
    ("North Wildwood", 39.00, -74.80),
    ("Wildwood Crest", 38.98, -74.83),
    ("Stone Harbor", 39.05, -74.76),
    ("Avalon", 39.09, -74.73),
    ("Sea Isle City", 39.15, -74.70),
    ("Ocean City", 39.28, -74.58),
    ("Cape May Court House", 39.08, -74.82),
    ("Rio Grande", 39.02, -74.88),
    ("Villas", 38.98, -74.94),
    ("Erma", 38.99, -74.89),
    ("Town Bank", 38.97, -74.93),
    ("Dennisville", 39.03, -74.83),
    ("Woodbine", 39.24, -74.81),
    ("Middle Township", 39.10, -74.80),
]


def _ring_bbox() -> tuple[float, float, float, float]:
    """County box expanded by BUFFER_MILES on every side."""
    lat_min, lat_max, lon_min, lon_max = COUNTY_BBOX
    dlat = BUFFER_MILES / 69.0
    mid_lat = (lat_min + lat_max) / 2.0
    dlon = BUFFER_MILES / (69.172 * math.cos(math.radians(mid_lat)))
    return (lat_min - dlat, lat_max + dlat, lon_min - dlon, lon_max + dlon)


RING_BBOX = _ring_bbox()

# Filename window-start: OR_GLM-L2-LCFA_G19_s20263200100000_e..._c....nc
# s = YYYY + day-of-year (3) + HHMMSS + tenths of a second.
_FILE_START_RE = re.compile(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d?_")


def _now_iso(now_s: float | None = None) -> str:
    return datetime.fromtimestamp(
        now_s if now_s is not None else time.time(), tz=timezone.utc
    ).isoformat()


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 3958.8  # Earth radius in miles
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _compass(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    """Compass direction from (lat1, lon1) to (lat2, lon2)."""
    dlat = lat2 - lat1
    dlon = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2.0))
    angle = (math.degrees(math.atan2(dlon, dlat)) + 360.0) % 360.0
    dirs = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return dirs[int((angle + 22.5) // 45.0) % 8]


def nearest_town(lat: float, lon: float) -> tuple[str, float, str]:
    """(town name, distance in miles, direction from the town)."""
    best: tuple[str, float, str] | None = None
    for name, tlat, tlon in TOWNS:
        d = _haversine_miles(tlat, tlon, lat, lon)
        if best is None or d < best[1]:
            best = (name, d, _compass(tlat, tlon, lat, lon))
    assert best is not None
    return best


# ── S3 listing (pure) ───────────────────────────────────────────────────────

def s3_prefix_for(dt: datetime) -> str:
    """GLM-L2-LCFA/<year>/<day-of-year>/<hour>/ for a UTC datetime."""
    return f"GLM-L2-LCFA/{dt:%Y}/{dt:%j}/{dt:%H}/"


def listing_url(prefix: str, start_after: str | None = None,
                max_keys: int = 1000) -> str:
    """S3 ListObjectsV2 URL for one hour prefix."""
    from urllib.parse import quote, urlencode

    params = {"list-type": "2", "prefix": prefix, "max-keys": str(max_keys)}
    if start_after:
        params["start-after"] = start_after
    return f"{S3_BASE}/?{urlencode(params, quote_via=quote)}"


def parse_listing(xml_text: str) -> list[dict[str, Any]]:
    """Parse an S3 ListBucketResult into [{key, size}] in listed order.
    Namespace-agnostic. Never raises."""
    out: list[dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return out
    for child in root:
        if not child.tag.endswith("Contents"):
            continue
        key = size = None
        for el in child:
            if el.tag.endswith("Key"):
                key = el.text
            elif el.tag.endswith("Size"):
                try:
                    size = int(el.text or 0)
                except (TypeError, ValueError):
                    size = 0
        if key:
            out.append({"key": key, "size": size or 0})
    return out


def filename_start_s(key: str) -> float | None:
    """Window-start epoch seconds from a GLM filename, or None."""
    m = _FILE_START_RE.search(key or "")
    if not m:
        return None
    try:
        year, doy, hh, mm, ss = (int(g) for g in m.groups())
        dt = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(
            days=doy - 1, hours=hh, minutes=mm, seconds=ss
        )
        return dt.timestamp()
    except (ValueError, OverflowError):
        return None


def new_file_keys(listed: list[dict[str, Any]], last_seen_key: str | None,
                  now_s: float) -> list[str]:
    """Keys to download from one hour listing: after the last seen key,
    with a window start inside [now - LOOKBACK_S, now + 60]. In listed
    (chronological) order. Pure."""
    out: list[str] = []
    for entry in listed:
        key = str(entry.get("key") or "")
        if not key:
            continue
        if last_seen_key is not None and key <= last_seen_key:
            continue
        start = filename_start_s(key)
        if start is None:
            continue
        if start < now_s - LOOKBACK_S or start > now_s + 60:
            continue
        out.append(key)
    return out


# ── GLM file parsing (pure; no network) ─────────────────────────────────────

def parse_glm_bytes(data: bytes) -> list[dict[str, Any]]:
    """Parse one GLM-L2-LCFA NetCDF file (bytes) into flash dicts:
    {time_s (epoch float), lat, lon, energy_j, quality}. Skips masked /
    invalid entries. Raises ValueError on a file that is not a readable
    GLM product (the caller treats that as a bad file, not a crash)."""
    import netCDF4

    try:
        ds = netCDF4.Dataset("in-memory.nc", memory=bytes(data))
    except Exception as exc:
        raise ValueError(f"not a readable NetCDF file: {exc}") from exc
    try:
        for var in ("flash_lat", "flash_lon", "flash_time_offset_of_first_event"):
            if var not in ds.variables:
                raise ValueError(f"GLM file missing variable {var}")
        # Window start: time_coverage_start attr, else product_time
        # (seconds since 2000-01-01 12:00:00).
        base_s: float | None = None
        tcs = getattr(ds, "time_coverage_start", None)
        if tcs:
            try:
                base_s = datetime.fromisoformat(
                    str(tcs).replace("Z", "+00:00")
                ).timestamp()
            except ValueError:
                base_s = None
        if base_s is None:
            try:
                pt = ds.variables["product_time"][:]
                base_s = float(pt) + 946728000.0  # 2000-01-01T12:00Z epoch
            except Exception as exc:
                raise ValueError("GLM file has no usable time base") from exc
        lats = ds.variables["flash_lat"][:]
        lons = ds.variables["flash_lon"][:]
        offs = ds.variables["flash_time_offset_of_first_event"][:]
        energies = ds.variables["flash_energy"][:] \
            if "flash_energy" in ds.variables else None
        quals = ds.variables["flash_quality_flag"][:] \
            if "flash_quality_flag" in ds.variables else None
        out: list[dict[str, Any]] = []
        for i in range(len(lats)):
            try:
                lat = float(lats[i])
                lon = float(lons[i])
                off = float(offs[i])
            except (TypeError, ValueError):
                continue
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue
            if not math.isfinite(lat) or not math.isfinite(lon) or not math.isfinite(off):
                continue
            energy = None
            if energies is not None:
                try:
                    energy = float(energies[i])
                    if not math.isfinite(energy):
                        energy = None
                except (TypeError, ValueError):
                    energy = None
            quality = None
            if quals is not None:
                try:
                    quality = int(quals[i])
                except (TypeError, ValueError):
                    quality = None
            out.append({
                "time_s": base_s + off,
                "lat": lat,
                "lon": lon,
                "energy_j": energy,
                "quality": quality,
            })
        return out
    finally:
        ds.close()


def flash_key(flash: dict[str, Any]) -> tuple[int, float, float]:
    """Dedupe key: flash time to the second + lat/lon to 3 decimals
    (~110 m). The same flash can appear in two adjacent 20-s files."""
    return (
        int(round(float(flash["time_s"]))),
        round(float(flash["lat"]), 3),
        round(float(flash["lon"]), 3),
    )


def classify_flash(lat: float, lon: float) -> str:
    """'county' | 'ring' | 'outside' for one flash position."""
    lo_lat, hi_lat, lo_lon, hi_lon = COUNTY_BBOX
    if lo_lat <= lat <= hi_lat and lo_lon <= lon <= hi_lon:
        return "county"
    r_lo_lat, r_hi_lat, r_lo_lon, r_hi_lon = RING_BBOX
    if r_lo_lat <= lat <= r_hi_lat and r_lo_lon <= lon <= r_hi_lon:
        return "ring"
    return "outside"


# ── SQLite store (seen files / flashes / alert state) ───────────────────────

class LightningStore:
    """Small SQLite store so a restart neither re-alerts nor
    double-counts. One file, three tables; created on first use."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else DB_PATH
        self._init()

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.db_path, timeout=10)
        con.execute("PRAGMA journal_mode=WAL")
        return con

    def _init(self) -> None:
        con = self._connect()
        try:
            con.execute(
                """CREATE TABLE IF NOT EXISTS lightning_seen_files (
                       key TEXT PRIMARY KEY, seen_at REAL)"""
            )
            con.execute(
                """CREATE TABLE IF NOT EXISTS lightning_flashes (
                       flash_key TEXT PRIMARY KEY, time_s REAL,
                       lat REAL, lon REAL, zone TEXT, seen_at REAL)"""
            )
            con.execute(
                """CREATE TABLE IF NOT EXISTS lightning_alert_state (
                       incident_key TEXT PRIMARY KEY, last_alert_s REAL,
                       last_county_s REAL)"""
            )
            con.commit()
        finally:
            con.close()

    def last_seen_key(self) -> str | None:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT key FROM lightning_seen_files ORDER BY key DESC LIMIT 1"
            ).fetchone()
            return str(row[0]) if row else None
        finally:
            con.close()

    def is_file_seen(self, key: str) -> bool:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT 1 FROM lightning_seen_files WHERE key = ?", (key,)
            ).fetchone()
            return row is not None
        finally:
            con.close()

    def mark_file_seen(self, key: str, now_s: float) -> None:
        con = self._connect()
        try:
            con.execute(
                "INSERT OR IGNORE INTO lightning_seen_files (key, seen_at)"
                " VALUES (?, ?)", (key, now_s),
            )
            con.commit()
        finally:
            con.close()

    def is_flash_seen(self, key: tuple[int, float, float]) -> bool:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT 1 FROM lightning_flashes WHERE flash_key = ?",
                (repr(key),),
            ).fetchone()
            return row is not None
        finally:
            con.close()

    def record_flashes(
        self, flashes: list[dict[str, Any]], now_s: float
    ) -> list[dict[str, Any]]:
        """Insert flashes not already seen; returns the new ones (each
        tagged with its zone). Never raises."""
        new: list[dict[str, Any]] = []
        con = self._connect()
        try:
            for flash in flashes:
                try:
                    zone = classify_flash(float(flash["lat"]), float(flash["lon"]))
                except (TypeError, ValueError, KeyError):
                    continue
                if zone == "outside":
                    continue
                key = flash_key(flash)
                row = con.execute(
                    "SELECT 1 FROM lightning_flashes WHERE flash_key = ?",
                    (repr(key),),
                ).fetchone()
                if row:
                    continue
                con.execute(
                    "INSERT INTO lightning_flashes"
                    " (flash_key, time_s, lat, lon, zone, seen_at)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (repr(key), float(flash["time_s"]), float(flash["lat"]),
                     float(flash["lon"]), zone, now_s),
                )
                new.append({**flash, "zone": zone})
            con.commit()
        except Exception as exc:
            log.warning("lightning_watch store error: %s", exc)
        finally:
            con.close()
        return new

    def county_times_since(self, since_s: float) -> list[float]:
        """Epoch times of county flashes at/after since_s."""
        con = self._connect()
        try:
            rows = con.execute(
                "SELECT time_s FROM lightning_flashes"
                " WHERE zone = 'county' AND time_s >= ? ORDER BY time_s",
                (since_s,),
            ).fetchall()
            return [float(r[0]) for r in rows]
        finally:
            con.close()


    def last_county_s(self) -> float | None:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT MAX(time_s) FROM lightning_flashes WHERE zone = 'county'"
            ).fetchone()
            return float(row[0]) if row and row[0] is not None else None
        finally:
            con.close()

    def get_last_alert_s(self, incident_key: str) -> float | None:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT last_alert_s FROM lightning_alert_state WHERE incident_key = ?",
                (incident_key,),
            ).fetchone()
            return float(row[0]) if row and row[0] is not None else None
        finally:
            con.close()

    def set_last_alert_s(self, incident_key: str, now_s: float) -> None:
        con = self._connect()
        try:
            con.execute(
                "INSERT INTO lightning_alert_state (incident_key, last_alert_s)"
                " VALUES (?, ?) ON CONFLICT(incident_key) DO UPDATE SET"
                " last_alert_s = excluded.last_alert_s",
                (incident_key, now_s),
            )
            con.commit()
        finally:
            con.close()

    def prune(self, now_s: float, keep_s: float = 3600.0) -> None:
        """Drop stored flashes older than keep_s (default 1 h) and seen
        files older than a day; the store is a rolling window, not an
        archive."""
        con = self._connect()
        try:
            con.execute(
                "DELETE FROM lightning_flashes WHERE time_s < ?",
                (now_s - keep_s,),
            )
            con.execute(
                "DELETE FROM lightning_seen_files WHERE seen_at < ?",
                (now_s - 86400.0,),
            )
            con.commit()
        except Exception as exc:
            log.warning("lightning_watch prune error: %s", exc)
        finally:
            con.close()


def lightning_status(now_s: float | None = None) -> dict:
    """D4: read-only county lightning summary for the risk score.

    Counts county flashes in the trailing 30/60 minutes plus the last
    county flash time. Opens the watcher DB read-only; raises
    FileNotFoundError when the watcher has never run (no DB file yet).
    Never imports netCDF4 — the status path needs no GLM parsing.
    """
    path = Path(DB_PATH)
    if not path.exists():
        raise FileNotFoundError(f"lightning db not found: {path}")
    now = float(now_s) if now_s is not None else time.time()
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
    try:
        try:
            rows30 = con.execute(
                "SELECT COUNT(*) FROM lightning_flashes"
                " WHERE zone = 'county' AND time_s >= ?",
                (now - 1800,),
            ).fetchone()
            rows60 = con.execute(
                "SELECT COUNT(*) FROM lightning_flashes"
                " WHERE zone = 'county' AND time_s >= ?",
                (now - 3600,),
            ).fetchone()
            last = con.execute(
                "SELECT MAX(time_s) FROM lightning_flashes"
                " WHERE zone = 'county'"
            ).fetchone()
        except sqlite3.OperationalError:
            return {
                "flashes30m": 0,
                "flashes60m": 0,
                "lastFlashMs": None,
                "checkedAtMs": int(now * 1000),
            }
        last_ms = int(last[0] * 1000) if last and last[0] is not None else None
        return {
            "flashes30m": int(rows30[0]) if rows30 else 0,
            "flashes60m": int(rows60[0]) if rows60 else 0,
            "lastFlashMs": last_ms,
            "checkedAtMs": int(now * 1000),
        }
    finally:
        con.close()


# ── Alerting (store side-effect + news_ingest) ─────────────────────────────

def _anomaly(incident_key: str, rule_id: str, severity: str, title: str,
             summary: str, now_s: float) -> dict[str, Any]:
    url = listing_url(s3_prefix_for(datetime.now(timezone.utc)))
    item = {
        "id": f"lightning-{incident_key}-{int(now_s)}",
        "source_id": "lightning_watch",
        "source_name": "Lightning (GOES-19 GLM)",
        "kind": "official",
        "title": title,
        "url": url,
        "summary": summary,
        "publisher": "Lightning (GOES-19 GLM)",
        "published": _now_iso(now_s),
        "pub_ms": int(now_s * 1000),
    }
    return {
        "rule_id": rule_id,
        "severity": severity,
        "incident_key": incident_key,
        "title": title,
        "summary": summary,
        "items": [item],
        "source_ids": ["lightning_watch"],
        "urls": [url],
    }


def _nearest_summary(flashes: list[dict[str, Any]]) -> str:
    """'nearest 4 mi NE of Cape May Court House' for the closest flash
    to a named town. Counts and towns only — no raw data."""
    if not flashes:
        return ""
    best: tuple[float, str, str] | None = None
    for flash in flashes:
        try:
            name, dist, direction = nearest_town(
                float(flash["lat"]), float(flash["lon"])
            )
        except (TypeError, ValueError, KeyError):
            continue
        if best is None or dist < best[0]:
            best = (dist, name, direction)
    if best is None:
        return ""
    return f"nearest {best[0]:.0f} mi {best[2]} of {best[1]}"


def process_flashes(
    flashes: list[dict[str, Any]],
    store: LightningStore,
    now_s: float | None = None,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Classify + dedupe + store flashes, evaluate the alert rules,
    record alerts via news_ingest. Returns ([{incident_key, status}],
    summary). Never raises, never fetches network."""
    from app import news_ingest

    now_s = now_s if now_s is not None else time.time()
    recorded: list[dict[str, str]] = []
    try:
        last_county_before = store.last_county_s()
        new = store.record_flashes(flashes, now_s)
        new_county = [f for f in new if f.get("zone") == "county"]
        new_ring = [f for f in new if f.get("zone") == "ring"]
        county_last5 = store.county_times_since(now_s - RATE_WINDOW_S)
        rate_per_min = len(county_last5) / (RATE_WINDOW_S / 60.0)
        summary = {
            "flashes_in_box": len(new_county),
            "flashes_in_ring": len(new_ring),
            "flashes_in_box_last_5min": len(county_last5),
            "max_rate_per_min": round(rate_per_min, 1),
            "nearest": _nearest_summary(new_county),
        }

        def _fire(incident_key: str, rule_id: str, severity: str,
                  title: str, summary_text: str) -> None:
            last_alert = store.get_last_alert_s(incident_key)
            if last_alert is not None and now_s - last_alert < ALERT_COOLDOWN_S:
                return
            status = news_ingest.record_alert(
                _anomaly(incident_key, rule_id, severity, title,
                         summary_text, now_s),
                now_s=int(now_s),
            )
            if status:
                store.set_last_alert_s(incident_key, now_s)
                recorded.append({"incident_key": incident_key, "status": status})

        # First flash after >=30 min quiet (or on a cold start, the
        # first county flash ever seen — see the module docstring).
        if new_county and (
            last_county_before is None
            or now_s - last_county_before >= QUIET_S
        ):
            nearest = _nearest_summary(new_county)
            _fire(
                "lightning-county", "lightning_county", "high",
                "Lightning detected over Cape May County",
                f"First lightning over Cape May County in at least 30 "
                f"minutes: {len(new_county)} flash"
                f"{'es' if len(new_county) != 1 else ''} in the last "
                f"poll{f', {nearest}' if nearest else ''}. GOES-19 GLM "
                f"sees total lightning (in-cloud and cloud-to-ground) "
                f"— not every flash reaches the ground.",
            )
        # Sustained high rate over the trailing 5 minutes.
        if len(county_last5) >= RATE_MIN_PER_MIN * (RATE_WINDOW_S / 60.0):
            nearest = _nearest_summary(new_county) or _nearest_summary(
                [{"lat": 39.08, "lon": -74.82}]
            )
            _fire(
                "lightning-rate", "lightning_rate", "critical",
                "Frequent lightning over Cape May County",
                f"{len(county_last5)} flashes over Cape May County in "
                f"the last 5 minutes ({rate_per_min:.0f}/min)"
                f"{f', {nearest}' if nearest else ''}. GOES-19 GLM "
                f"sees total lightning — take shelter from lightning "
                f"until 30 minutes after the last flash.",
            )
        return recorded, summary
    except Exception as exc:
        log.warning("lightning_watch process_flashes error: %s", exc)
        return recorded, {
            "flashes_in_box": 0, "flashes_in_ring": 0,
            "flashes_in_box_last_5min": 0, "max_rate_per_min": 0.0,
            "nearest": "",
        }


# ── Fetching (network; isolated, never raises) ──────────────────────────────

async def _fetch_text(client: Any, url: str) -> str | None:
    try:
        r = await client.get(url, timeout=25)
        r.raise_for_status()
        return r.text
    except Exception as exc:
        log.warning("lightning_watch listing fetch failed %s: %s", url, exc)
        return None


async def _fetch_file(client: Any, key: str) -> bytes | None:
    """Download one GLM file. A 404 means S3 reprocessed the file
    under a new creation timestamp — log and skip, never fatal."""
    try:
        r = await client.get(f"{S3_BASE}/{key}", timeout=60)
        if r.status_code == 404:
            log.info("lightning_watch file gone (reprocessed): %s", key)
            return None
        r.raise_for_status()
        return bytes(r.content)
    except Exception as exc:
        log.warning("lightning_watch file fetch failed %s: %s", key, exc)
        return None


def _hour_prefixes(now_s: float) -> list[str]:
    """Current UTC hour prefix, plus the previous hour (rollover)."""
    now = datetime.fromtimestamp(now_s, tz=timezone.utc)
    prev = now - timedelta(hours=1)
    prefixes = [s3_prefix_for(now)]
    if s3_prefix_for(prev) != prefixes[0]:
        prefixes.append(s3_prefix_for(prev))
    return prefixes


async def fetch_new_files(
    client: Any, store: LightningStore, now_s: float | None = None
) -> list[tuple[str, bytes]]:
    """One poll's downloads: new keys from the current (and previous)
    hour listings, in chronological order. Never raises."""
    now_s = now_s if now_s is not None else time.time()
    out: list[tuple[str, bytes]] = []
    try:
        last_seen = store.last_seen_key()
        keys: list[str] = []
        for prefix in _hour_prefixes(now_s):
            xml = await _fetch_text(client, listing_url(prefix))
            if xml is None:
                continue
            keys.extend(new_file_keys(parse_listing(xml), last_seen, now_s))
        keys = sorted(set(keys))[:MAX_FILES_PER_POLL]
        for key in keys:
            data = await _fetch_file(client, key)
            if data is not None:
                out.append((key, data))
    except Exception as exc:
        log.warning("lightning_watch fetch_new_files error: %s", exc)
    return out


async def poll(
    store: LightningStore | None = None,
    now_s: float | None = None,
) -> dict[str, Any]:
    """One poll cycle: list, download new files, parse, process.
    Returns {alerts, summary, files}. Never raises."""
    import httpx

    now_s = now_s if now_s is not None else time.time()
    store = store if store is not None else LightningStore()
    summary: dict[str, Any] = {
        "flashes_in_box": 0, "flashes_in_ring": 0,
        "flashes_in_box_last_5min": 0, "max_rate_per_min": 0.0,
        "nearest": "",
    }
    alerts: list[dict[str, str]] = []
    files = 0
    try:
        async with httpx.AsyncClient(
            timeout=60,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            downloaded = await fetch_new_files(client, store, now_s)
        all_flashes: list[dict[str, Any]] = []
        for key, data in downloaded:
            try:
                all_flashes.extend(parse_glm_bytes(data))
            except ValueError as exc:
                log.warning("lightning_watch bad file %s: %s", key, exc)
            store.mark_file_seen(key, now_s)
            files += 1
        if all_flashes:
            alerts, summary = process_flashes(all_flashes, store, now_s)
        store.prune(now_s)
    except Exception as exc:
        log.warning("lightning_watch poll error: %s", exc)
    return {"alerts": alerts, "summary": summary, "files": files}


async def refresh_lightning_watch() -> list[dict[str, str]]:
    """One poll cycle, alerts only. Returns alerts recorded. Never
    raises. Start from main.py alongside the news refresher, on the
    same 5-minute fast cycle."""
    result = await poll()
    return result.get("alerts") or []


async def _background_refresher() -> None:
    """Background task, started from main.py. Polls every POLL_INTERVAL_S."""
    import asyncio

    while True:
        try:
            await refresh_lightning_watch()
        except Exception as exc:
            log.warning("lightning_watch refresh cycle error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    import asyncio

    async def _loop() -> None:
        while True:
            result = await poll()
            log.info("lightning_watch poll: %s", result.get("summary"))
            await asyncio.sleep(POLL_INTERVAL_S)

    logging.basicConfig(level=logging.INFO)
    asyncio.run(_loop())
