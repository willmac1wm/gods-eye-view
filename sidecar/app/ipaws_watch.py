"""ipaws_watch.py — FEMA IPAWS alert watcher for Cape Dispatch.

Built 2026-11-15. No key, no account, no paid service, no scraping.

The sensor is the public FEMA OpenFEMA API, dataset IpawsArchivedAlerts
(verified live 2026-11-15 from this VM):

  * GET https://www.fema.gov/api/open/v1/IpawsArchivedAlerts
        ?$orderby=sent desc&$top=100
    — archived IPAWS alerts (WEA / EAS / CMAS) as CAP JSON. No key,
    plain HTTPS GET, OData query params.
  * One poll per 5-minute cycle, fixed User-Agent; on any failure the
    fetcher logs and skips the cycle — it never retries in a burst.
    NOTE — DELAYED ARCHIVE: FEMA publishes this dataset with a
    24-hour delay by design, so alerts surface here ~a day late.
    This watcher is a backfill layer ("did we miss an IPAWS alert"),
    not a real-time alerter. See WINDOW_S in the code.
  * NOTE: $select does NOT work on the nested `info` field (OpenFEMA
    returns HTTP 400 when `info` is in $select — verified 2026-11-15),
    so each poll fetches full records, including the large
    `originalMessage` blob. It is never parsed or stored; only the
    JSON fields are used.

Records carry: identifier, sender, senderName, sent, status (Actual /
Test / Exercise / Draft / System), msgType (Alert / Update / Cancel /
Ack / Error), scope (Public / Restricted / Private), and info[] with
event, category, severity (Extreme / Severe / Moderate / Minor /
Unknown), urgency, certainty, effective, onset, expires, description,
responseType, and area[] with areaDesc, geocode[] (SAME codes, e.g.
"018003" for Allen County IN), and circle[] (type Circle, radius in
km, coordinates [[lon, lat]]) or polygon geometry.

Locality (Cape May County, NJ) — one function, `is_local`:
  * SAME geocode 034009 = Cape May County (verified: Cape May County
    SKYWARN lists "Cape May County SAMES CODE is: 034009"; Census
    FIPS for the county is 34009).
  * SAME geocode 034000 = New Jersey statewide: local ONLY when the
    event is Severe/Extreme AND the description (or areaDesc) names
    Cape May County.
  * areaDesc containing "Cape May".
  * Circle / polygon geometry intersecting the county bounding box
    (Census TIGER: west -75.168462, east -74.46493, north 39.324383,
    south 38.788657 — rounded outward in COUNTY_BBOX).

What alerts (same shape as the other watchers — news_alerts table via
news_ingest.record_alert, 6-hour cooldown, one alert per incident):
  * Extreme + urgency Immediate/Expected = critical.
  * Severe + urgency Immediate/Expected = high.
  * Moderate / Minor / Unknown = normal.
  * Test / Exercise / Draft / System status, non-Public scope, and
    Ack / Error msgTypes never alert. A Cancel consumes its
    identifier (no alert, never re-alerts); an Update for the same
    identifier supersedes the earlier alert (same incident_key
    `ipaws-<identifier>`).

GUARDRAIL — the alert quotes the public alert's own description,
briefly (<= 280 chars). That text IS the public alert, so quoting it
is the point. The raw `originalMessage` blob is never parsed, stored,
or republished.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

log = logging.getLogger("cape_dispatch.ipaws_watch")

IPAWS_BASE = "https://www.fema.gov/api/open/v1/IpawsArchivedAlerts"
POLL_INTERVAL_S = 300  # 5 minutes, same as the news fast refresher
FETCH_TOP = 100
# WARNING — this dataset is a DELAYED ARCHIVE, not a live feed. FEMA
# publishes IpawsArchivedAlerts with a 24-hour delay by design ("The
# most recent record will reflect the alert(s) sent twenty-four (24)
# hours ago" — data.gov catalog; confirmed live 2026-11-16: newest
# record in the top 100 was 24.6h old, the batch spans 4.7 days).
# So the window must span the delay: records only become visible
# ~24h after they were sent, and the watcher catches them on the
# next poll after they appear. Alerts therefore arrive ~a day late —
# this watcher is a backfill / "did we miss an IPAWS alert" layer,
# NOT a real-time alerter. The live IPAWS feed is a separate access
# path (IPAWS public feed) and is not built here.
WINDOW_S = 72 * 3600  # only alert on records sent within the last 72h
WINDOW_GRACE_S = 600  # ...plus a grace window for poll jitter
USER_AGENT = "CapeDispatch/1.0 (ipaws watch)"

# Cape May County, NJ. SAME 034009 verified two ways: the Cape May
# County SKYWARN group lists "Cape May County SAMES CODE is: 034009",
# and Census FIPS for the county is 34009 (SAME = 0 + state 34 +
# county 009). Statewide is 034000 (BLS: "34000 | New Jersey --
# Statewide").
CAPE_MAY_SAME = "034009"
NJ_STATEWIDE_SAME = "034000"
# County bounding box, from Census TIGER metadata (west -75.168462,
# east -74.46493, north 39.324383, south 38.788657), rounded outward.
# lat_min, lat_max, lon_min, lon_max.
COUNTY_BBOX = (38.78, 39.33, -75.17, -74.46)

LOCAL_AREA_MARKERS = ("CAPE MAY",)
REAL_STATUSES = {"Actual"}
PUBLIC_SCOPE = "Public"
ALERT_MSGTYPES = ("Alert", "Update")

# Severity mapping: (severity, urgency) -> alert severity.
CRITICAL_URGENCIES = {"Immediate", "Expected"}
HIGH_URGENCIES = {"Immediate", "Expected"}

SUMMARY_DESC_MAX = 280
TITLE_MAX = 140


def build_poll_url(top: int = FETCH_TOP) -> str:
    """One poll: the 100 most recent alerts, newest first.

    No $select: OpenFEMA rejects $select on the nested `info` field
    with HTTP 400 (verified 2026-11-15), and `info` is where the
    event, severity, description, and geometry live. Filtering is
    client-side.
    """
    return f"{IPAWS_BASE}?$orderby=sent%20desc&$top={int(top)}"


def record_url(identifier: str) -> str:
    """Link-out to the source record in the OpenFEMA API."""
    return (
        f"{IPAWS_BASE}?$filter=identifier%20eq%20"
        f"%27{quote(str(identifier), safe='')}%27"
    )


def _parse_sent(value: Any) -> float | None:
    """ISO-8601 `sent` -> epoch seconds. None when unparseable."""
    if value is None:
        return None
    try:
        return datetime.fromisoformat(
            str(value).strip().replace("Z", "+00:00")
        ).timestamp()
    except Exception:
        return None


def _info_entry(record: dict[str, Any]) -> dict[str, Any]:
    """The info block to use: en-US first, else the first one."""
    infos = record.get("info")
    if not isinstance(infos, list) or not infos:
        return {}
    for info in infos:
        if isinstance(info, dict) and str(info.get("language") or "") == "en-US":
            return info
    for info in infos:
        if isinstance(info, dict):
            return info
    return {}


def _areas(info: dict[str, Any]) -> list[dict[str, Any]]:
    areas = info.get("area")
    if not isinstance(areas, list):
        return []
    return [a for a in areas if isinstance(a, dict)]


def _geocodes(info: dict[str, Any]) -> list[tuple[str, str]]:
    """(scheme, value) pairs from every area's geocode list."""
    out: list[tuple[str, str]] = []
    for area in _areas(info):
        codes = area.get("geocode")
        if not isinstance(codes, list):
            continue
        for code in codes:
            if not isinstance(code, dict):
                continue
            out.append(
                (str(code.get("name") or "").strip().upper(),
                 str(code.get("value") or "").strip())
            )
    return out


def _bbox_intersects(a: tuple[float, float, float, float],
                     b: tuple[float, float, float, float]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1] and a[2] <= b[3] and b[2] <= a[3]


def _point_in_bbox(lat: float, lon: float,
                   bbox: tuple[float, float, float, float]) -> bool:
    return bbox[0] <= lat <= bbox[1] and bbox[2] <= lon <= bbox[3]


def _geometry_bboxes(info: dict[str, Any]) -> list[tuple[float, float, float, float]]:
    """Bounding boxes for every circle / polygon in the record.

    Circle: coordinates [[lon, lat]], radius in km. Polygon: a list
    of [lon, lat] rings (GeoJSON-ish) or a flat "lat,lon lat,lon ..."
    string. Shapes we cannot parse are ignored, never raised.
    """
    out: list[tuple[float, float, float, float]] = []
    for area in _areas(info):
        for circle in area.get("circle") or []:
            try:
                if not isinstance(circle, dict):
                    continue
                coords = circle.get("coordinates") or []
                lon, lat = float(coords[0][0]), float(coords[0][1])
                radius_km = float(circle.get("radius") or 0)
                d_lat = radius_km / 111.0
                d_lon = radius_km / max(111.0 * math.cos(math.radians(lat)), 1.0)
                out.append((lat - d_lat, lat + d_lat, lon - d_lon, lon + d_lon))
            except Exception:
                continue
        for poly in area.get("polygon") or []:
            try:
                points: list[tuple[float, float]] = []
                if isinstance(poly, dict):
                    rings = poly.get("coordinates") or []
                    raw = rings[0] if rings and isinstance(rings[0], list) else rings
                    for pt in raw:
                        points.append((float(pt[1]), float(pt[0])))
                elif isinstance(poly, str):
                    for pair in poly.split():
                        lat_s, lon_s = pair.split(",")
                        points.append((float(lat_s), float(lon_s)))
                elif isinstance(poly, list):
                    for pt in poly:
                        points.append((float(pt[1]), float(pt[0])))
                if points:
                    lats = [p[0] for p in points]
                    lons = [p[1] for p in points]
                    out.append((min(lats), max(lats), min(lons), max(lons)))
            except Exception:
                continue
    return out


def _names_cape_may(info: dict[str, Any]) -> bool:
    """Description or areaDesc names Cape May County."""
    texts = [str(info.get("description") or "")]
    texts += [str(a.get("areaDesc") or "") for a in _areas(info)]
    return any("cape may" in t.lower() for t in texts)


def is_local(record: dict[str, Any]) -> bool:
    """Cape May County, NJ — by SAME code, areaDesc, or geometry.
    Never raises."""
    try:
        info = _info_entry(record)
        if not info:
            return False
        severity = str(info.get("severity") or "").strip()
        for scheme, value in _geocodes(info):
            if scheme == "SAME" and value == CAPE_MAY_SAME:
                return True
            if (
                scheme == "SAME"
                and value == NJ_STATEWIDE_SAME
                and severity in ("Extreme", "Severe")
                and _names_cape_may(info)
            ):
                return True
        for area in _areas(info):
            desc = str(area.get("areaDesc") or "").upper()
            if any(m in desc for m in LOCAL_AREA_MARKERS):
                return True
        for bbox in _geometry_bboxes(info):
            if _bbox_intersects(bbox, COUNTY_BBOX):
                return True
        return False
    except Exception:
        return False


def _is_test_like(record: dict[str, Any], info: dict[str, Any]) -> bool:
    """Test / exercise / draft traffic, or an empty test record."""
    status = str(record.get("status") or "").strip()
    if status and status not in REAL_STATUSES:
        return True
    event = str(info.get("event") or "").lower()
    if "test" in event or "exercise" in event:
        return True
    description = str(info.get("description") or "").strip()
    if not description and "test" in event:
        return True
    return False


def severity_for(record: dict[str, Any], info: dict[str, Any] | None = None) -> str:
    """CAP severity/urgency -> alert severity (critical/high/normal)."""
    info = info if info is not None else _info_entry(record)
    severity = str(info.get("severity") or "").strip()
    urgency = str(info.get("urgency") or "").strip()
    if severity == "Extreme":
        return "critical" if urgency in CRITICAL_URGENCIES else "high"
    if severity == "Severe":
        return "high" if urgency in HIGH_URGENCIES else "normal"
    return "normal"


# ── Detection (pure; no network, no DB) ─────────────────────────────────────

def match_ipaws_record(record: dict[str, Any]) -> dict[str, Any] | None:
    """Match one IPAWS record against the local-alert rules.

    Returns an anomaly dict (rule_id, severity, incident_key, title,
    summary, items, source_ids, urls) or None. The summary quotes the
    public alert's own description, briefly (<= 280 chars) — that
    text IS the public alert. The raw originalMessage blob is never
    used. Never raises.
    """
    try:
        if not isinstance(record, dict):
            return None
        identifier = str(record.get("identifier") or "").strip()
        if not identifier:
            return None
        msg_type = str(record.get("msgType") or "").strip()
        if msg_type not in ALERT_MSGTYPES:
            return None  # Cancel / Ack / Error handled by the caller
        if str(record.get("scope") or "").strip() != PUBLIC_SCOPE:
            return None
        info = _info_entry(record)
        if not info:
            return None
        if _is_test_like(record, info):
            return None
        if not is_local(record):
            return None
        event = str(info.get("event") or "Emergency alert").strip()
        sender_name = (
            str(record.get("senderName") or record.get("sender") or "FEMA IPAWS").strip()
        )
        areas = _areas(info)
        area_desc = str(areas[0].get("areaDesc") or "").strip() if areas else ""
        title = f"IPAWS: {event}"
        if area_desc:
            title += f" — {area_desc}"
        if len(title) > TITLE_MAX:
            title = title[: TITLE_MAX - 1].rstrip() + "…"
        description = " ".join(str(info.get("description") or "").split())
        if len(description) > SUMMARY_DESC_MAX:
            description = description[: SUMMARY_DESC_MAX - 1].rstrip() + "…"
        summary = f"{event} ({sender_name})"
        if description:
            summary += f": {description}"
        expires = str(info.get("expires") or "").strip()
        if expires:
            summary += f" Expires {expires}."
        severity = severity_for(record, info)
        sent = record.get("sent")
        try:
            pub_ms = int(
                datetime.fromisoformat(str(sent).replace("Z", "+00:00")).timestamp() * 1000
            )
        except Exception:
            pub_ms = int(time.time() * 1000)
        url = record_url(identifier)
        item = {
            "id": f"ipaws-{identifier}",
            "source_id": "ipaws_watch",
            "source_name": "FEMA IPAWS",
            "kind": "official",
            "title": title,
            "url": url,
            "summary": summary,
            "publisher": sender_name,
            "published": str(sent or ""),
            "pub_ms": pub_ms,
        }
        return {
            "rule_id": "ipaws_alert",
            "severity": severity,
            "incident_key": f"ipaws-{identifier}",
            "title": title,
            "summary": summary,
            "items": [item],
            "source_ids": ["ipaws_watch"],
            "urls": [url],
            "_identifier": identifier,
        }
    except Exception:
        return None


def _newest_by_identifier(
    records: list[dict[str, Any]], now_s: float | None = None
) -> dict[str, dict[str, Any]]:
    """Newest record per identifier, within the time window.

    If a batch holds both an Alert and an Update for one identifier,
    the newest version wins. Records older than the window are
    dropped. Never raises.
    """
    now_s = now_s if now_s is not None else time.time()
    cutoff = now_s - WINDOW_S - WINDOW_GRACE_S
    newest: dict[str, dict[str, Any]] = {}
    for record in records or []:
        if not isinstance(record, dict):
            continue
        identifier = str(record.get("identifier") or "").strip()
        if not identifier:
            continue
        sent_s = _parse_sent(record.get("sent"))
        if sent_s is not None and sent_s < cutoff:
            continue
        prev = newest.get(identifier)
        if prev is None:
            newest[identifier] = record
            continue
        prev_sent = _parse_sent(prev.get("sent")) or 0
        cur_sent = sent_s or 0
        if cur_sent > prev_sent or (
            cur_sent == prev_sent
            and str(record.get("msgType") or "") == "Update"
        ):
            newest[identifier] = record
    return newest


def detect_records(
    records: list[dict[str, Any]], now_s: float | None = None
) -> list[dict[str, Any]]:
    """Pure: match a batch of records, one anomaly per identifier.

    Only records sent within the window (72h + grace — see WINDOW_S:
    the archive is delayed ~24h by design) are considered.
    If a batch holds both an Alert and an Update for one identifier,
    the newest version wins. Never raises.
    """
    out: list[dict[str, Any]] = []
    for record in _newest_by_identifier(records, now_s=now_s).values():
        anomaly = match_ipaws_record(record)
        if anomaly is not None:
            out.append(anomaly)
    return out


# ── Alerting (stateful across polls, DB side-effect) ────────────────────────

_seen_keys: set[tuple[str, float | None]] = set()


def _seen_key(record: dict[str, Any]) -> tuple[str, float | None]:
    """Dedupe key: identifier + sent. An Update for the same
    identifier has a later `sent`, so it still processes and
    supersedes the earlier alert (same incident_key); the same
    record polled twice does not."""
    return (
        str(record.get("identifier") or "").strip(),
        _parse_sent(record.get("sent")),
    )


def process_records(
    records: list[dict[str, Any]],
    now_s: float | None = None,
    seen: set[tuple[str, float | None]] | None = None,
) -> list[dict[str, str]]:
    """Detect and record alerts via news_ingest. Returns
    [{incident_key, status}] for alerts recorded ('new' or
    'updated') and for Cancels consumed ('cancelled'). A Cancel
    never creates an alert: its identifier is consumed so it can
    never alert later. Never raises, never fetches network."""
    from app import news_ingest

    now_s = now_s if now_s is not None else time.time()
    seen = seen if seen is not None else _seen_keys
    out: list[dict[str, str]] = []
    # Cancels first: consume the identifier, no alert.
    for record in records or []:
        if not isinstance(record, dict):
            continue
        if str(record.get("msgType") or "").strip() != "Cancel":
            continue
        key = _seen_key(record)
        if key in seen:
            continue
        seen.add(key)
        identifier = str(record.get("identifier") or "").strip()
        if identifier:
            out.append(
                {"incident_key": f"ipaws-{identifier}", "status": "cancelled"}
            )
    newest = _newest_by_identifier(records, now_s=now_s)
    for anomaly in detect_records(records, now_s=now_s):
        identifier = anomaly.get("_identifier")
        record = newest.get(str(identifier) or "")
        key = _seen_key(record) if record is not None else (str(identifier), None)
        if key in seen:
            continue
        seen.add(key)
        if len(seen) > 5000:
            seen.clear()
            seen.add(key)
        status = news_ingest.record_alert(anomaly, now_s=int(now_s))
        if status:
            out.append({"incident_key": anomaly["incident_key"], "status": status})
    return out


# ── Fetching (network; isolated, never raises) ──────────────────────────────

async def fetch_records() -> list[dict[str, Any]]:
    """One poll: the 100 most recent IPAWS alerts. Returns raw
    records. Never raises."""
    import httpx

    try:
        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            r = await client.get(build_poll_url(), timeout=25)
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        log.warning("ipaws_watch fetch failed: %s", exc)
        return []
    if not isinstance(data, dict):
        return []
    records = data.get("IpawsArchivedAlerts")
    return [r for r in records if isinstance(r, dict)] if isinstance(records, list) else []


async def poll(now_s: float | None = None) -> list[dict[str, str]]:
    """One poll cycle: fetch, detect, alert. Returns alerts recorded
    ('new' / 'updated') and Cancels consumed ('cancelled'). Never
    raises. Start from main.py alongside the news refresher and the
    other watchers, on the same 5-minute fast cycle."""
    records = await fetch_records()
    if not records:
        return []
    return process_records(records, now_s=now_s)


async def _background_refresher() -> None:
    """Background task, started from main.py. Polls every POLL_INTERVAL_S."""
    while True:
        try:
            await poll()
        except Exception as exc:
            log.warning("ipaws_watch refresh cycle error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    import sys

    async def _run_once() -> None:
        results = await poll()
        for row in results:
            print(f"{row['status']}: {row['incident_key']}")
        if not results:
            print("no IPAWS alerts this cycle")

    async def _run_loop() -> None:
        await _background_refresher()

    if "--once" in sys.argv[1:]:
        asyncio.run(_run_once())
    else:
        asyncio.run(_run_loop())
