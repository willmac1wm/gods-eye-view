"""acars_watch.py — ACARS incident watcher for Cape Dispatch.

Built 2026-11-15, the second ACARS source plumbed in after the
FlightDeck / ACARS research. No SDR, no key, no paid service, no
scraping of FlightDeck (closed app, no public API — do not scrape it).

The sensor is the public airframes.io REST API (free, anonymous on
public endpoints — verified live 2026-11-15 ~09:10 EST from this VM):

  * GET https://api.airframes.io/v1/messages?text=<kw>&timeframe=last-hour&limit=100
    — ACARS / VDL2 / HFDL messages as they arrive from the global
    feeder network. 635+ active feeders, 2M+ messages/day.
  * The endpoint takes a case-insensitive substring `text` filter, a
    `timeframe` (last-hour etc.), `since`, `labels`, `station_ids`,
    `icao`, and `before_id` for paging. Auth is optional on public
    endpoints; anonymous requests work, a key only raises rate limits.
  * Feeder access is free: run a receiver that feeds airframes.io for
    7+ days and the API account is free (60 req/min). A paid tier with
    no feeder requirement is "in development" — not needed here.

Local coverage already exists without our own receiver: the live
check saw a VDL2 feeder in Philadelphia ("PhillyRox-VDLM", nearest
airport KPHL) and a VDL2 station near Trenton ("RK-KBOS_TRENTON-VDL2"),
plus HFDL/VDL stations at KIAD/KDCA. A message heard by a Philly /
Trenton / ACY feeder, or from an aircraft over South Jersey / Philly
airspace, is local airspace.

Polling: one query per incident keyword per 5-minute cycle (11
keywords, timeframe=last-hour, limit=100). Anonymous, fixed
User-Agent; on any failure the fetcher logs and skips the cycle — it
never retries in a burst.

What alerts (category only — see the guardrail below):
  * MAYDAY / PAN PAN / EMERGENCY / engine failure / smoke / fire on
    board / depressurisation -> critical
  * Diversion, medical, minimum fuel, bird strike -> high
  * Ground stop -> critical if the text says nationwide / national /
    all airports (same event the news auto-catch tracks), high if it
    is a local (ACY / PHL / EWR) ground stop.
  * Scope (William, 2026-11-15): EMERGENCIES ARE NATIONWIDE. The
    seven critical categories — mayday, pan-pan, emergency, engine
    failure, smoke on board, fire on board, depressurisation — alert
    wherever the aircraft is, same as the squawk / VIP watch. A
    diversion over California is still not Cape Dispatch's business:
    diversion, medical, minimum fuel, and bird strike stay local-only
    (message mentions ACY / PHL / EWR / KWWD / KACY / Atlantic City /
    Cape May / Philadelphia / Newark, or a flight to/from one of
    those airports, or a station nearest one of them, or a position
    over local airspace, lat 38.3-40.6, lon -75.8--73.3).

GUARDRAIL — the raw message text is NEVER put in an alert title,
summary, or report. ACARS free text can hold medical details,
passenger specifics (e.g. a deportee on board), and crew names.
The alert says the category, the flight, the tail, the position,
and the time, and links out to the original message on
airframes.io for a human to read. The category is the news; the
raw text is not ours to republish.

Second source, same matcher: when a local ACARS Hub is running
(sdr-enthusiasts/docker-acarshub — see ACARS-OPEN-SOURCE.md), its
live JSON stream (TCP 15550) can be fed into match_acars_message
after normalising acarsdec JSON (text / label / tail / flight) to
this module's message shape. No local receiver exists yet, so the
airframes.io poller is the live path and the Hub is the later one.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("cape_dispatch.acars_watch")

AIRFRAMES_BASE = "https://api.airframes.io/v1"
POLL_INTERVAL_S = 300  # 5 minutes, same as the news fast refresher

# Server-side substring queries (case-insensitive ILIKE on message text).
KEYWORDS = (
    "DIVERT",
    "EMERGENCY",
    "MAYDAY",
    "PAN PAN",
    "MEDICAL",
    "ENGINE FAIL",
    "GROUND STOP",
    "MINIMUM FUEL",
    "SMOKE",
    "DEPRESSUR",
    "BIRD STRIKE",
)

# Local airports / place names (upper, matched against message text).
LOCAL_TEXT_MARKERS = (
    "ACY", "PHL", "EWR", "KWWD", "KACY",
    "ATLANTIC CITY", "CAPE MAY", "PHILADELPHIA", "NEWARK",
)
LOCAL_AIRPORTS = {"ACY", "PHL", "EWR", "KACY", "KWWD"}
LOCAL_STATION_AIRPORTS = {"KACY", "KPHL", "KEWR", "KWWD"}
# South Jersey / Philly / NYC-approach airspace.
LOCAL_BBOX = (38.3, 40.6, -75.8, -73.3)  # lat_min, lat_max, lon_min, lon_max

# (regex, category, severity) — checked in order, first match wins.
CATEGORIES: list[tuple[str, str, str]] = [
    (r"\bMAYDAY\b", "mayday", "critical"),
    (r"\bPAN[\s-]?PAN\b", "pan-pan", "critical"),
    (r"\bEMERGENCY\b", "emergency", "critical"),
    (r"ENGINE\s+FAIL", "engine failure", "critical"),
    (r"\bSMOKE\b", "smoke on board", "critical"),
    (r"FIRE\s+ON\s+BOARD", "fire on board", "critical"),
    (r"DEPRESSUR", "depressurisation", "critical"),
    (r"\bDIVERT", "diversion", "high"),
    (r"\bMEDICAL\b", "medical", "high"),
    (r"MINIMUM\s+FUEL", "minimum fuel", "high"),
    (r"GROUND\s+STOP", "ground stop", "high"),
    (r"BIRD\s+STRIKE", "bird strike", "high"),
]

# Critical emergency categories alert NATIONWIDE (William, 2026-11-15):
# mayday, pan-pan, emergency, engine failure, smoke/fire on board,
# depressurisation. Diversion, medical, minimum fuel, bird strike stay
# local-only; ground stop is nationwide only when the text says so.
NATIONWIDE_CATEGORIES = {
    "mayday",
    "pan-pan",
    "emergency",
    "engine failure",
    "smoke on board",
    "fire on board",
    "depressurisation",
}

# Routine-context exclusions (all seen live 2026-11-15 — without them
# the nationwide switch false-alerts): a dangerous-goods form, a
# dispatcher warning one flight about ANOTHER aircraft's emergency,
# takeoff performance data ("ENGINE FAILURE ACCEL HT"), and
# smoke-detector maintenance chatter are not emergencies.
EMERGENCY_EXCLUSIONS = (
    "DANGEROUS GOODS",
    "EMERGENCY AIRCRAFT",
    "EMERGENCY EQUIPMENT",
    "EMERGENCY EXIT",
    "EMERGENCY LOCATOR",
)
ENGINE_FAILURE_EXCLUSIONS = (
    "ACCEL HT",  # takeoff performance data, not an actual failure
    "FAIL TO START",
    "FAILED TO START",
)
SMOKE_EXCLUSIONS = (
    "SMOKE DET",  # smoke-detector fault / maintenance chatter
    "SMOKE DETECTOR",
)

CATEGORY_LABEL = {    "mayday": "Mayday call",
    "pan-pan": "Pan-pan call",
    "emergency": "Emergency declared",
    "engine failure": "Engine failure",
    "smoke on board": "Smoke on board",
    "fire on board": "Fire on board",
    "depressurisation": "Depressurisation",
    "diversion": "Diversion",
    "medical": "Medical issue on board",
    "minimum fuel": "Minimum fuel",
    "ground stop": "Ground stop",
    "bird strike": "Bird strike",
}


def _now_iso(now_s: float | None = None) -> str:
    return datetime.fromtimestamp(
        now_s if now_s is not None else time.time(), tz=timezone.utc
    ).isoformat()


def _flight_str(msg: dict[str, Any]) -> str:
    fl = msg.get("flight")
    if isinstance(fl, dict):
        return str(fl.get("flight") or fl.get("flightIcao") or "").strip()
    return str(fl or msg.get("flightNumber") or "").strip()


def _tail_str(msg: dict[str, Any]) -> str:
    af = msg.get("airframe")
    if isinstance(af, dict):
        return str(af.get("tail") or "").strip()
    return str(msg.get("tail") or "").strip()


def _station(msg: dict[str, Any]) -> dict[str, Any]:
    st = msg.get("station")
    return st if isinstance(st, dict) else {}


def _is_local(msg: dict[str, Any], text_upper: str) -> bool:
    """Local airspace / local airports / local feeder. Never raises."""
    try:
        if any(m in text_upper for m in LOCAL_TEXT_MARKERS):
            return True
        fl = msg.get("flight")
        if isinstance(fl, dict):
            for key in ("departingAirport", "destinationAirport"):
                if str(fl.get(key) or "").strip().upper() in LOCAL_AIRPORTS:
                    return True
        for key in ("departingAirport", "destinationAirport"):
            if str(msg.get(key) or "").strip().upper() in LOCAL_AIRPORTS:
                return True
        st = _station(msg)
        if str(st.get("nearestAirportIcao") or "").strip().upper() in LOCAL_STATION_AIRPORTS:
            return True
        lat, lon = msg.get("latitude"), msg.get("longitude")
        if lat is None or lon is None:
            fl_lat = fl.get("latitude") if isinstance(fl, dict) else None
            fl_lon = fl.get("longitude") if isinstance(fl, dict) else None
            lat, lon = fl_lat, fl_lon
        if lat is not None and lon is not None:
            lat_f, lon_f = float(lat), float(lon)
            lo_lat, hi_lat, lo_lon, hi_lon = LOCAL_BBOX
            if lo_lat <= lat_f <= hi_lat and lo_lon <= lon_f <= hi_lon:
                return True
        return False
    except Exception:
        return False


def _is_national_ground_stop(text_upper: str) -> bool:
    return "GROUND STOP" in text_upper and any(
        w in text_upper for w in ("NATIONWIDE", "NATIONAL", "ALL AIRPORTS", "U.S. AIRPORTS", "US AIRPORTS")
    )


# ── Detection (pure; no network, no DB) ─────────────────────────────────────

def match_acars_message(msg: dict[str, Any]) -> dict[str, Any] | None:
    """Match one ACARS message against the incident categories.

    Returns an anomaly dict (rule_id, severity, incident_key, title,
    summary, items, source_ids, urls) or None. The summary never
    contains the raw message text. Never raises.
    """
    try:
        text = str(msg.get("text") or "")
        if not text.strip():
            return None
        # ACARS text uses CR/LF line breaks, so a phrase can be split
        # across lines ("EMERGENCY\rAIRCRAFT"). Collapse all whitespace
        # before any phrase matching — categories and exclusions alike.
        text_upper = " ".join(text.upper().split())
        category = severity = None
        for pattern, cat, sev in CATEGORIES:
            if re.search(pattern, text_upper):
                category, severity = cat, sev
                break
        if category is None:
            return None
        # Negation guard: routine status reports say "NO SMOKE ON".
        # A warning that says "SMOKE LAVATORY SMOKE" still alerts.
        if category == "smoke on board" and "NO SMOKE" in text_upper:
            return None
        # Routine-context exclusions: cargo paperwork, chatter about
        # another aircraft's emergency, performance data, and
        # detector-maintenance messages are not emergencies.
        if category == "emergency" and any(
            x in text_upper for x in EMERGENCY_EXCLUSIONS
        ):
            return None
        if category == "engine failure" and any(
            x in text_upper for x in ENGINE_FAILURE_EXCLUSIONS
        ):
            return None
        if category == "smoke on board" and any(
            x in text_upper for x in SMOKE_EXCLUSIONS
        ):
            return None
        national = category == "ground stop" and _is_national_ground_stop(text_upper)
        if category == "ground stop" and national:
            severity = "critical"
        nationwide_emergency = category in NATIONWIDE_CATEGORIES
        if not national and not nationwide_emergency and not _is_local(msg, text_upper):
            return None
        flight = _flight_str(msg)
        tail = _tail_str(msg)
        who = flight or tail or str(msg.get("id") or "unknown aircraft")
        label = CATEGORY_LABEL[category]
        if category == "ground stop":
            # One incident for the stop, national or local: every
            # message about it merges into the same alert (same as the
            # news auto-catch's faa-ground-stop key).
            incident_key = "acars-ground-stop"
            title = (
                "ACARS: nationwide ground stop mentioned"
                if national
                else f"ACARS: ground stop — {who}"
            )
        else:
            slug = re.sub(r"[^a-z0-9]+", "-", who.lower()).strip("-") or "unknown"
            incident_key = f"acars-{category.replace(' ', '-')}-{slug}"
            title = f"ACARS: {label.lower()} — {who}"
        lat = msg.get("latitude")
        lon = msg.get("longitude")
        if lat is None or lon is None:
            fl = msg.get("flight")
            if isinstance(fl, dict):
                lat, lon = fl.get("latitude"), fl.get("longitude")
        station = _station(msg).get("ident") or "unknown station"
        summary = (
            f"{label} reported by ACARS message from {who}"
            f"{f' ({tail})' if tail and tail != who else ''}. "
            f"Heard by {station}"
            + (f" at {lat}, {lon}" if lat is not None and lon is not None else "")
            + ". ACARS data can be delayed or missing — this is what "
            "was broadcast, not a confirmed incident."
        )
        msg_id = msg.get("id")
        url = f"{AIRFRAMES_BASE}/messages/{msg_id}" if msg_id is not None else AIRFRAMES_BASE
        created = msg.get("createdAt") or msg.get("timestamp")
        try:
            pub_ms = int(
                datetime.fromisoformat(str(created).replace("Z", "+00:00")).timestamp() * 1000
            )
        except Exception:
            pub_ms = int(time.time() * 1000)
        item = {
            "id": f"acars-{msg_id}",
            "source_id": "acars_watch",
            "source_name": "ACARS (airframes.io)",
            "kind": "official",
            "title": title,
            "url": url,
            "summary": summary,
            "publisher": "ACARS (airframes.io)",
            "published": str(created or ""),
            "pub_ms": pub_ms,
        }
        return {
            "rule_id": f"acars_{category.replace(' ', '_')}",
            "severity": severity,
            "incident_key": incident_key,
            "title": title,
            "summary": summary,
            "items": [item],
            "source_ids": ["acars_watch"],
            "urls": [url],
            "_msg_id": msg_id,
        }
    except Exception:
        return None


def detect_messages(
    messages: list[dict[str, Any]], now_s: float | None = None
) -> list[dict[str, Any]]:
    """Pure: match a batch of messages, one anomaly per message.
    Never raises."""
    now_s = now_s if now_s is not None else time.time()
    out: list[dict[str, Any]] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        anomaly = match_acars_message(msg)
        if anomaly is not None:
            out.append(anomaly)
    return out


# ── Alerting (stateful across polls, DB side-effect) ────────────────────────

_seen_msg_ids: set[Any] = set()


def process_messages(
    messages: list[dict[str, Any]],
    now_s: float | None = None,
    seen: set[Any] | None = None,
) -> list[dict[str, str]]:
    """Detect and record alerts via news_ingest. Returns
    [{incident_key, status}] for alerts recorded ('new' or 'updated').
    The same message id is never processed twice. Never raises, never
    fetches network."""
    from app import news_ingest

    now_s = now_s if now_s is not None else time.time()
    seen = seen if seen is not None else _seen_msg_ids
    out: list[dict[str, str]] = []
    for anomaly in detect_messages(messages, now_s=now_s):
        msg_id = anomaly.get("_msg_id")
        if msg_id in seen:
            continue
        seen.add(msg_id)
        if len(seen) > 5000:
            seen.clear()
            seen.add(msg_id)
        status = news_ingest.record_alert(anomaly, now_s=int(now_s))
        if status:
            out.append({"incident_key": anomaly["incident_key"], "status": status})
    return out


# ── Fetching (network; isolated, never raises) ──────────────────────────────

async def _fetch_keyword(client: Any, keyword: str) -> list[dict[str, Any]]:
    from urllib.parse import quote

    url = (
        f"{AIRFRAMES_BASE}/messages"
        f"?text={quote(keyword)}&timeframe=last-hour&limit=100"
    )
    try:
        r = await client.get(url, timeout=25)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else []
    except Exception as exc:
        log.warning("acars_watch fetch failed %s: %s", keyword, exc)
        return []


async def fetch_messages() -> list[dict[str, Any]]:
    """One poll: one query per incident keyword, deduped by message id.
    Returns raw messages. Never raises."""
    import httpx

    out: list[dict[str, Any]] = []
    seen: set[Any] = set()
    try:
        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": "CapeDispatch/1.0 (acars watch)"},
        ) as client:
            for keyword in KEYWORDS:
                for msg in await _fetch_keyword(client, keyword):
                    if not isinstance(msg, dict):
                        continue
                    mid = msg.get("id")
                    if mid in seen:
                        continue
                    seen.add(mid)
                    out.append(msg)
    except Exception as exc:
        log.warning("acars_watch fetch_messages error: %s", exc)
    return out


async def refresh_acars_watch() -> list[dict[str, str]]:
    """One poll cycle: fetch, detect, alert. Returns alerts recorded.
    Never raises. Start from main.py alongside the news refresher, on
    the same 5-minute fast cycle."""
    messages = await fetch_messages()
    if not messages:
        return []
    return process_messages(messages)


async def _background_refresher() -> None:
    """Background task, started from main.py. Polls every POLL_INTERVAL_S."""
    import asyncio

    while True:
        try:
            await refresh_acars_watch()
        except Exception as exc:
            log.warning("acars_watch refresh cycle error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL_S)
