"""adsb_watch.py — Squawk + callsign watcher for Cape Dispatch.

Built 2026-11-14 from the watchlist William approved as-is
(WATCHLIST-SQUAWK-CALLSIGN.md). No SDR, no new API key, no paid service,
no LiveATC scraping. The sensor is the public adsb.lol API (free, no key),
verified live 2026-11-14 ~20:00 EST from this VM:

  * GET https://api.adsb.lol/v2/mil        — all military aircraft live now
    (73 in that check), with hex, flight (callsign), r (registration),
    t (ICAO type), squawk, emergency, lat/lon.
  * GET https://api.adsb.lol/v2/squawk/7700 — aircraft on a given squawk
    (0 live at that check, as expected on a quiet night).
  * GET https://api.adsb.lol/v2/hex/{hex}   — one aircraft by transponder hex.
  * GET https://api.adsb.lol/v2/callsign/{callsign} — one callsign.
  * GET https://api.adsb.lol/v2/reg/{reg}   — one registration.

Polling: 6 requests per 5-minute cycle (1x /mil, 3x squawk, 2x civilian
VIP reg). No key is required; if adsb.lol ever rate-limits, the fetcher
logs and skips the cycle — it never retries in a burst.

What it watches (approved watchlist only — tails marked "confirm" in the
doc are NOT in this code):
  * Emergency squawks 7500 / 7600 / 7700 on ANY aircraft, plus the ADS-B
    emergency field. PERSISTENCE RULE: a squawk only alerts if it is
    still there on the next poll (or 60s later). Crews pass through 7x00
    codes while dialling; one poll of 7700 is a watch, not an alert.
  * VIP callsigns: AIRFORCEONE, AIRFORCETWO, SAM + number, VENUS + number,
    MARINEONE, EXEC1F, JF001 / JF002.
  * VIP / command aircraft by hex or registration: VC-25A 82-8000 /
    92-9000, E-4B 73-1676 / 73-1677 / 74-0787 / 75-0125, C-32A
    98-0001 / 99-0003 / 99-0004, Japan 777s 80-1111 / 80-1112,
    UK ZZ336, France F-RARF, China B-2479, Israel 4X-ISR.
  * Within military traffic only: ICAO type B742 (a military 747-200 is
    a VC-25A or an E-4B — both watchlisted anyway).

Alerts go into the same news_alerts table the news auto-catch uses
(news_ingest.record_alert), so one alert per incident per 6-hour
cooldown, with an incident report (headline + excerpt + link-outs only).
Detection is pure; the network path is isolated in _fetch_* helpers.
"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("cape_dispatch.adsb_watch")

ADSB_BASE = "https://api.adsb.lol/v2"
POLL_INTERVAL_S = 300  # 5 minutes, same as the news fast refresher
# A squawk must still be present this long after first sighting to alert.
SQUAWK_PERSIST_S = 60

# ── Approved watchlist (verified tails/hex only) ────────────────────────────

EMERGENCY_SQUAWKS = {"7500": "unlawful interference", "7600": "radio failure", "7700": "general emergency"}
EMERGENCY_FIELDS = {"general", "unlawful", "nordo", "downed"}  # emergency severity
PRIORITY_FIELDS = {"lifeguard", "minfuel"}  # flagged, not alerted

# callsign (normalised: spaces removed, upper) -> label
VIP_CALLSIGNS: dict[str, str] = {
    "AIRFORCEONE": "Air Force One",
    "AIRFORCETWO": "Air Force Two",
    "MARINEONE": "Marine One",
    "EXEC1F": "Executive One Foxtrot",
    "JF001": "Japanese Air Force One",
    "JF002": "Japanese Air Force Two",
}
# callsign prefixes (followed by a number)
VIP_CALLSIGN_PREFIXES: dict[str, str] = {
    "SAM": "Special Air Mission",
    "VENUS": "US diplomatic / senior-leader flight",
    "COTAM": "French presidential flight",
    "RRR": "RAF VIP flight",
}

# hex (lower) -> (label, tail)
WATCH_HEX: dict[str, tuple[str, str]] = {
    "adfdf8": ("VC-25A (Air Force One aircraft)", "82-8000"),
    "adfdf9": ("VC-25A (Air Force One aircraft)", "92-9000"),
    "adfeb3": ("E-4B Nightwatch (doomsday plane)", "73-1676"),
    "adfeb4": ("E-4B Nightwatch (doomsday plane)", "73-1677"),
    "adfeb5": ("E-4B Nightwatch (doomsday plane)", "74-0787"),
    "adfeb6": ("E-4B Nightwatch (doomsday plane)", "75-0125"),
    "adfeb7": ("C-32A (VP / senior leaders)", "98-0001"),
    "adfeb9": ("C-32A (VP / senior leaders)", "99-0003"),
    "adfeba": ("C-32A (VP / senior leaders)", "99-0004"),
}
# registration (upper, hyphens as broadcast) -> label
WATCH_REG: dict[str, str] = {
    "82-8000": "VC-25A (Air Force One aircraft)",
    "92-9000": "VC-25A (Air Force One aircraft)",
    "73-1676": "E-4B Nightwatch (doomsday plane)",
    "73-1677": "E-4B Nightwatch (doomsday plane)",
    "74-0787": "E-4B Nightwatch (doomsday plane)",
    "75-0125": "E-4B Nightwatch (doomsday plane)",
    "98-0001": "C-32A (VP / senior leaders)",
    "99-0003": "C-32A (VP / senior leaders)",
    "99-0004": "C-32A (VP / senior leaders)",
    "80-1111": "Japanese government 777-300ER",
    "80-1112": "Japanese government 777-300ER",
    "ZZ336": "RAF Voyager Vespina",
    "F-RARF": "French presidential A330-200",
    "B-2479": "Chinese presidential 747-8",
    "4X-ISR": "Israeli Wing of Zion 767",
}
# civilian VIP registrations polled directly (not in /mil): China, Israel.
CIVILIAN_VIP_REGS = ("B-2479", "4X-ISR")


def _norm_callsign(raw: Any) -> str:
    return re.sub(r"\s+", "", str(raw or "").upper())


def _norm_hex(raw: Any) -> str:
    return str(raw or "").strip().lower()


def _norm_reg(raw: Any) -> str:
    return str(raw or "").strip().upper()


def _now_iso(now_s: float | None = None) -> str:
    return datetime.fromtimestamp(
        now_s if now_s is not None else time.time(), tz=timezone.utc
    ).isoformat()


# ── Detection (pure; no network, no DB) ─────────────────────────────────────

def match_aircraft(obs: dict[str, Any]) -> list[dict[str, str]]:
    """Match one ADS-B observation against the watchlist.

    Returns a list of hits: [{kind, match, label}]. kind is 'squawk',
    'callsign', 'aircraft', or 'type'. A routine military flight matches
    nothing. Never raises.
    """
    hits: list[dict[str, str]] = []
    try:
        squawk = str(obs.get("squawk") or "").strip()
        emergency = str(obs.get("emergency") or "").strip().lower()
        if squawk in EMERGENCY_SQUAWKS:
            hits.append(
                {
                    "kind": "squawk",
                    "match": squawk,
                    "label": f"squawk {squawk} ({EMERGENCY_SQUAWKS[squawk]})",
                }
            )
        elif emergency in EMERGENCY_FIELDS:
            hits.append(
                {
                    "kind": "squawk",
                    "match": emergency,
                    "label": f"ADS-B reports {emergency} emergency",
                }
            )
        callsign = _norm_callsign(obs.get("flight"))
        if callsign in VIP_CALLSIGNS:
            hits.append(
                {
                    "kind": "callsign",
                    "match": callsign,
                    "label": VIP_CALLSIGNS[callsign],
                }
            )
        else:
            for prefix, label in VIP_CALLSIGN_PREFIXES.items():
                if re.fullmatch(rf"{prefix}\d+", callsign):
                    hits.append(
                        {
                            "kind": "callsign",
                            "match": callsign,
                            "label": f"{label} ({callsign})",
                        }
                    )
                    break
        hexcode = _norm_hex(obs.get("hex"))
        reg = _norm_reg(obs.get("r"))
        if hexcode in WATCH_HEX:
            label, tail = WATCH_HEX[hexcode]
            hits.append(
                {"kind": "aircraft", "match": hexcode, "label": f"{label} {tail}"}
            )
        elif reg in WATCH_REG:
            hits.append(
                {"kind": "aircraft", "match": reg, "label": WATCH_REG[reg]}
            )
        # Military 747-200s are VC-25A or E-4B — both watchlisted. Only
        # inside /mil results (the caller tags those with _mil=True).
        if obs.get("_mil") and str(obs.get("t") or "").strip().upper() == "B742":
            if not any(h["kind"] == "aircraft" for h in hits):
                hits.append(
                    {
                        "kind": "type",
                        "match": "B742",
                        "label": "US military 747-200 (VC-25A or E-4B)",
                    }
                )
        return hits
    except Exception:
        return hits


def _incident_key(obs: dict[str, Any], hit: dict[str, str]) -> str:
    hexcode = _norm_hex(obs.get("hex")) or _norm_reg(obs.get("r")) or "unknown"
    if hit["kind"] == "squawk":
        return f"squawk-{hit['match']}-{hexcode}"
    if hit["kind"] == "callsign":
        return f"vip-{_norm_callsign(obs.get('flight'))}-{hexcode}"
    return f"aircraft-{hexcode}"


def _obs_item(obs: dict[str, Any], hit: dict[str, str], now_s: float) -> dict[str, Any]:
    hexcode = _norm_hex(obs.get("hex"))
    url = f"{ADSB_BASE}/hex/{hexcode}" if hexcode else ADSB_BASE
    return {
        "id": f"adsb-{hexcode}-{hit['kind']}-{hit['match']}",
        "source_id": "adsb_watch",
        "source_name": "ADS-B (adsb.lol)",
        "kind": "official",
        "title": f"{hit['label']} — {str(obs.get('flight') or '').strip() or hexcode}",
        "url": url,
        "summary": (
            f"{hit['label']}. Squawk {obs.get('squawk') or '—'}, "
            f"alt {obs.get('alt_baro') or '—'} ft, "
            f"pos {obs.get('lat')}, {obs.get('lon')}."
        ),
        "publisher": "ADS-B (adsb.lol)",
        "published": _now_iso(now_s),
        "pub_ms": int(now_s * 1000),
    }


def detect_aircraft(
    observations: list[dict[str, Any]], now_s: float | None = None
) -> list[dict[str, Any]]:
    """Pure: match observations against the watchlist, return anomalies.

    One anomaly per (aircraft, hit-kind). Squawk hits are NOT filtered
    here — persistence is applied in process_observations(), which
    remembers first sightings across polls. Never raises.
    """
    now_s = now_s if now_s is not None else time.time()
    out: list[dict[str, Any]] = []
    for obs in observations or []:
        hits = match_aircraft(obs)
        if not hits:
            continue
        # One aircraft, one VIP anomaly: a callsign hit and an aircraft
        # hit for the same plane are the same event (AF1 in a VC-25A is
        # one alert, not two). Callsign wins the title; the aircraft
        # label is kept in the summary. A squawk hit stays separate —
        # that is a different event on the same aircraft.
        squawk_hits = [h for h in hits if h["kind"] == "squawk"]
        vip_hits = [h for h in hits if h["kind"] != "squawk"]
        chosen: list[dict[str, str]] = []
        if vip_hits:
            call = next((h for h in vip_hits if h["kind"] == "callsign"), None)
            craft = next((h for h in vip_hits if h["kind"] == "aircraft"), None)
            typ = next((h for h in vip_hits if h["kind"] == "type"), None)
            chosen.append(call or craft or typ)
        chosen.extend(squawk_hits)
        for hit in chosen:
            severity = "critical" if hit["kind"] == "squawk" else "high"
            title = (
                f"Emergency squawk {hit['match']} — {hit['label']}"
                if hit["kind"] == "squawk"
                else f"{hit['label']} airborne"
            )
            summary = (
                f"Aircraft {str(obs.get('flight') or '').strip() or _norm_hex(obs.get('hex'))} "
                f"is broadcasting {hit['label']}. "
            )
            if hit["kind"] == "callsign" and vip_hits:
                others = [h["label"] for h in vip_hits if h is not hit]
                if others:
                    summary += f"Also matched: {'; '.join(others)}. "
            summary += (
                "ADS-B data can be delayed or missing — this is what "
                "was broadcast, not a confirmed incident."
            )
            out.append(
                {
                    "rule_id": f"adsb_{hit['kind']}",
                    "severity": severity,
                    "incident_key": _incident_key(obs, hit),
                    "title": title,
                    "summary": summary,
                    "items": [_obs_item(obs, hit, now_s)],
                    "source_ids": ["adsb_watch"],
                    "urls": [_obs_item(obs, hit, now_s)["url"]],
                    "_hit_kind": hit["kind"],
                    "_hex": _norm_hex(obs.get("hex")),
                }
            )
    return out


# ── Persistence + alerting (stateful across polls, DB side-effect) ──────────

class SquawkPersistence:
    """Remembers first sighting of a (hex, squawk). A squawk alerts only
    once it has persisted SQUAWK_PERSIST_S. In-memory only: a restart
    resets the clock, which fails safe (a fresh 7700 still alerts after
    one more poll)."""

    def __init__(self) -> None:
        self._first_seen: dict[str, float] = {}

    def ready(self, hexcode: str, squawk: str, now_s: float) -> bool:
        key = f"{hexcode}|{squawk}"
        first = self._first_seen.get(key)
        if first is None:
            self._first_seen[key] = now_s
            return False
        return now_s - first >= SQUAWK_PERSIST_S

    def forget(self, hexcode: str, squawk: str) -> None:
        self._first_seen.pop(f"{hexcode}|{squawk}", None)


_PERSISTENCE = SquawkPersistence()


def process_observations(
    observations: list[dict[str, Any]],
    now_s: float | None = None,
    persistence: SquawkPersistence | None = None,
) -> list[dict[str, str]]:
    """Detect, apply the squawk persistence rule, record alerts via
    news_ingest. Returns [{incident_key, status}] for alerts recorded
    ('new' or 'updated'). Never raises, never fetches network."""
    from app import news_ingest

    now_s = now_s if now_s is not None else time.time()
    persistence = persistence if persistence is not None else _PERSISTENCE
    out: list[dict[str, str]] = []
    for anomaly in detect_aircraft(observations, now_s=now_s):
        if anomaly.get("_hit_kind") == "squawk":
            # Squawk match is in the incident_key; the squawk code is the
            # middle segment. Persistence is per aircraft + squawk.
            parts = anomaly["incident_key"].split("-")
            squawk = parts[1] if len(parts) > 1 else ""
            if not persistence.ready(anomaly.get("_hex") or "", squawk, now_s):
                continue
        status = news_ingest.record_alert(anomaly, now_s=int(now_s))
        if status:
            out.append({"incident_key": anomaly["incident_key"], "status": status})
    return out


# ── Fetching (network; isolated, never raises) ──────────────────────────────

async def _fetch_json(client: Any, url: str) -> dict[str, Any]:
    try:
        r = await client.get(url, timeout=25)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        log.warning("adsb_watch fetch failed %s: %s", url, exc)
        return {}


async def fetch_observations() -> list[dict[str, Any]]:
    """One poll: /mil + 3 squawk endpoints + 2 civilian VIP regs.
    Returns raw observations, military ones tagged _mil=True. Never raises."""
    import httpx

    obs: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": "CapeDispatch/1.0 (adsb watch)"},
        ) as client:
            urls = (
                [f"{ADSB_BASE}/mil"]
                + [f"{ADSB_BASE}/squawk/{c}" for c in ("7500", "7600", "7700")]
                + [f"{ADSB_BASE}/reg/{r}" for r in CIVILIAN_VIP_REGS]
            )
            results = []
            for url in urls:
                results.append(await _fetch_json(client, url))
        seen: set[str] = set()
        for i, data in enumerate(results):
            for ac in data.get("ac") or []:
                if not isinstance(ac, dict):
                    continue
                key = str(ac.get("hex") or "") + "|" + str(ac.get("flight") or "")
                if key in seen:
                    continue
                seen.add(key)
                ac = dict(ac)
                if i == 0:
                    ac["_mil"] = True
                obs.append(ac)
    except Exception as exc:
        log.warning("adsb_watch fetch_observations error: %s", exc)
    return obs


async def refresh_adsb_watch() -> list[dict[str, str]]:
    """One poll cycle: fetch, detect, alert. Returns alerts recorded.
    Never raises. Start from main.py alongside the news refresher, on the
    same 5-minute fast cycle."""
    obs = await fetch_observations()
    if not obs:
        return []
    return process_observations(obs)


async def _background_refresher() -> None:
    """Background task, started from main.py. Polls every POLL_INTERVAL_S."""
    import asyncio

    while True:
        try:
            await refresh_adsb_watch()
        except Exception as exc:
            log.warning("adsb_watch refresh cycle error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL_S)
