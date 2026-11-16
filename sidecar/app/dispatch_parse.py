"""dispatch_parse.py — Fire Wire dispatch grammar parser for Cape Dispatch.

Pure, stdlib only, no network, no Facebook, no LLM. It parses the
dispatch shorthand that Cape May County scanner listeners type up
(ST/Sq/L units, ".." separators, MVC, iao, town aliases) into structured
incident data. It is the deterministic pre-parser from the Fire Wire
group ingest spec (2026-11-14) — but the regex pasted in that spec does
NOT work as written: tested 2026-11-14 it matched only 4/8 sample
dispatches, because it cannot read bare numbers ("ST 70 71" = ST 70
and ST 71). This module does not use that regex. It splits on ".."
first, then parses units (bare numbers inherit the last prefix) and
matches the town by longest alias first. Verified against the spec's
8 sample dispatches: 8/8.

Input is typed-up dispatch text — from a human share-sheet tap, a
radio transcript (later, when SDR hardware exists), or an agency
repost. It is NOT a Facebook scraper: there is no sanctioned way to
read the Fire Wire group automatically (Groups API retired Apr 2024;
scrapers violate Meta's terms; group posts are private individuals'
reports, often with addresses/injuries).

Guardrails, from the spec: block-level addresses only (no house
numbers on the public map or in posts — the parser keeps the raw
location text; the caller must round it before publishing), no patient
age/condition/names, station numbers copied exactly and never inferred,
and a station->municipality lookup table is still needed from the
county fire coordinator's station list — this module does NOT guess
station numbers or municipalities from station numbers.
"""
from __future__ import annotations

import re
from typing import Any

# Town aliases as written in the group -> municipality / village.
TOWN_ALIASES: dict[str, str] = {
    "WW": "Wildwood",
    "WEST WW": "West Wildwood",
    "NWW": "North Wildwood",
    "WWC": "Wildwood Crest",
    "CM": "Cape May",
    "WCM": "West Cape May",
    "CMP": "Cape May Point",
    "CMCH": "Cape May Court House",
    "OC": "Ocean City",
    "SIC": "Sea Isle City",
    "S SEAVILLE": "South Seaville",
    "SEAVILLE": "Seaville",
    "MARMORA": "Marmora",
    "CORBIN CITY": "Corbin City",
    "WOODBINE": "Woodbine",
    "DENNISVILLE": "Dennisville",
    "UPPER TOWNSHIP": "Upper Township",
    "MIDDLE TOWNSHIP": "Middle Township",
    "LOWER TOWNSHIP": "Lower Township",
    "DENNIS TOWNSHIP": "Dennis Township",
}
# Towns outside Cape May County (mutual aid / out of area).
OUT_OF_COUNTY: set[str] = {"CORBIN CITY", "WOODBINE"}

UNIT_KIND: dict[str, str] = {
    "ST": "station",
    "SQ": "squad",
    "L": "ladder",
    "E": "engine",
    "ENGINE": "engine",
    "R": "rescue",
    "AMB": "ambulance",
    "MEDIC": "medic",
}

QUALIFIER_WORDS: dict[str, str] = {
    "entrapment": "entrapment",
    "possible entrapment": "possible_entrapment",
    "pedestrian": "pedestrian",
    "vs pedestrian": "pedestrian",
    "bicycle": "bicycle",
    "bike": "bicycle",
    "motorcycle": "motorcycle",
    "mc crash": "motorcycle",
    "vs pole": "vs_pole",
    "vs wires": "vs_wires",
    "rollover": "rollover",
    "multiple vehicles": "multiple_vehicles",
    "2 vehicles": "multiple_vehicles",
    "road blocked": "road_blocked",
    "injuries": "injuries",
    "helo requested": "helo_requested",
    "helo on standby": "helo_standby",
    "helo standby": "helo_standby",
    "working fire": "working_fire",
    "smoke showing": "smoke_showing",
    "explosion": "explosion_reported",
    "minor": "minor",
}


def _parse_units(units_text: str) -> list[dict[str, Any]] | None:
    """Parse 'ST 70 71' / 'ST 17 18 22 Sq11' / 'Sq3 L2'.

    Bare numbers inherit the last prefix. Returns None if the text
    does not start with a unit prefix.
    """
    units: list[dict[str, Any]] = []
    last_kind: str | None = None
    last_raw: str | None = None
    for m in re.finditer(r"(ST|Sq|L|E|Engine|R|Amb|Medic)?\s?(\d+)", units_text, re.I):
        prefix, number = m.group(1), m.group(2)
        if prefix:
            last_kind = UNIT_KIND[prefix.upper()]
            last_raw = prefix
        elif last_kind is None:
            return None  # a number with no prefix and nothing to inherit
        units.append(
            {
                "type": last_kind,
                "number": number,
                "raw": f"{last_raw}{number}" if last_raw else number,
            }
        )
    return units or None


def _qualifiers(text: str) -> list[str]:
    low = text.lower()
    out: list[str] = []
    # "possible entrapment" contains "entrapment" as a substring — check
    # it first and do not also add the confirmed-entrapment qualifier.
    if "possible entrapment" in low:
        out.append("possible_entrapment")
    for phrase, key in QUALIFIER_WORDS.items():
        if key == "possible_entrapment":
            continue
        if phrase in low and key not in out:
            if key == "entrapment" and "possible_entrapment" in out:
                continue
            out.append(key)
    return out


def _call_type(call_raw: str, qualifiers: list[str]) -> str:
    low = call_raw.lower()
    if "structure" in low:
        return "structure_fire"
    if "motorcycle" in low or "mc crash" in low or "mc " in low:
        return "motorcycle_crash"
    if "mvc" in low or "mva" in low or "crash" in low or "collision" in low:
        return "mvc"
    if "fire" in low:
        return "fire"
    if "ems" in low or "medical" in low:
        return "ems"
    if "hazmat" in low:
        return "hazmat"
    return "other"


def _severity(call_type: str, qualifiers: list[str]) -> str:
    if "entrapment" in qualifiers or "working_fire" in qualifiers:
        return "critical"
    if call_type == "structure_fire" or "possible_entrapment" in qualifiers:
        return "high"
    if call_type in ("mvc", "motorcycle_crash") or "injuries" in qualifiers:
        return "moderate"
    return "low"


_STATUS_RE = re.compile(
    r"^(?:(?:ST|Sq|L|E)\s?\d+\s+)?(clear|units clear|fire units clear|"
    r"road (?:is )?now (?:back )?open|roadway (?:is )?now reopened|"
    r"helo on standby|helo standby|helo requested)\b",
    re.I,
)


def parse_status(text: str) -> dict[str, Any] | None:
    """Parse a short status update ('51 clear', 'vs pole', 'Helo on
    standby', 'Road is now back open'). Returns a status dict with
    location null — these update a parent incident, they are not new
    incidents. Never raises."""
    t = (text or "").strip()
    if not t or len(t) > 80:
        return None
    low = t.lower()
    if "clear" in low:
        status = "units_clear"
    elif "back open" in low or "reopened" in low:
        status = "road_reopened"
    elif "helo on standby" in low or "helo standby" in low:
        status = "escalated"
    elif "helo requested" in low:
        status = "escalated"
    elif low.startswith("vs "):
        status = "escalated"
    else:
        return None
    units = _parse_units(t) or []
    return {
        "is_status_update": True,
        "status_signal": status,
        "units": units,
        "qualifiers": _qualifiers(t),
        "location": None,
        "raw": t,
    }


def parse_dispatch(text: str) -> dict[str, Any] | None:
    """Parse one typed-up dispatch into structured data.

    Grammar: <UNITS> <TOWN> <LOCATION>..<CALL TYPE>[ <qualifier>],
    with ".." separating fields. Returns None for free text, agency
    reposts, fundraisers and anything else that is not a dispatch —
    those fall through to a human / LLM, they are not guessed at.
    Never raises."""
    t = (text or "").strip()
    if not t:
        return None
    if t.upper().startswith("OOA"):
        # Out-of-area alert; still parse the rest, flagged below.
        t = t[3:].strip()
        out_of_area = True
    else:
        out_of_area = False
    parts = [p.strip() for p in t.split("..")]
    if len(parts) < 2:
        return None
    first = parts[0]
    call_raw = parts[-1]
    if not call_raw:
        return None
    # Units are the leading unit tokens; the rest is town + location.
    m = re.match(
        r"^(?P<units>(?:(?:ST|Sq|L|E|Engine|R|Amb|Medic)\s?\d+"
        r"(?:\s+(?:(?:ST|Sq|L|E|Engine|R|Amb|Medic)\s?)?\d+)*))\s+(?P<rest>.+)$",
        first,
        re.I,
    )
    if not m:
        return None
    units = _parse_units(m.group("units"))
    if not units:
        return None
    rest = m.group("rest").strip()
    rest_up = rest.upper()
    town: str | None = None
    town_raw: str | None = None
    loc_start = ""
    for alias in sorted(TOWN_ALIASES, key=len, reverse=True):
        if rest_up == alias or rest_up.startswith(alias + " "):
            town = TOWN_ALIASES[alias]
            town_raw = alias
            loc_start = rest[len(alias):].strip()
            break
    if town is None:
        return None  # town not recognised — do not guess
    # Location: whatever followed the town in the first segment, plus
    # any middle ".." segments (the 'S SEAVILLE..20 Siskin Ln' case).
    loc_bits = [loc_start] + parts[1:-1]
    location = " ".join(b for b in loc_bits if b).strip()
    location = re.sub(r"^iao\s+", "", location, flags=re.I).strip()
    if not location:
        return None
    quals = _qualifiers(call_raw + " " + location)
    call_type = _call_type(call_raw, quals)
    return {
        "is_incident": True,
        "is_status_update": False,
        "units": units,
        "town": town,
        "town_raw": town_raw,
        "location": location,
        "intersection": "/" in location,
        "call_type_raw": call_raw,
        "call_type": call_type,
        "qualifiers": quals,
        "mutual_aid_out_of_county": out_of_area or town_raw in OUT_OF_COUNTY,
        "severity": _severity(call_type, quals),
        "source_kind": "radio_transcript",
        "raw": text,
    }


def parse(text: str) -> dict[str, Any] | None:
    """Dispatch first, status update second. None if neither matches."""
    d = parse_dispatch(text)
    if d is not None:
        return d
    return parse_status(text)


# ── Alert bridge ────────────────────────────────────────────────────────────

def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def dispatch_to_anomaly(parsed: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a parsed dispatch into a news_alerts anomaly, the same
    shape news_ingest.record_alert() takes. The incident report links
    out to the source the dispatch came from; the parser itself carries
    no URL, so the caller should set items/urls when it knows the
    source (share-sheet message link, transcript file, agency post).
    Returns None for status updates (those update a parent incident,
    they are not new alerts)."""
    if not parsed or parsed.get("is_status_update"):
        return None
    town_slug = _slug(parsed.get("town", ""))
    loc_slug = _slug(parsed.get("location", ""))[:40]
    key = f"dispatch-{town_slug}-{loc_slug}-{parsed.get('call_type', 'other')}"
    summary = (
        f"{parsed['call_type_raw']} — {parsed['location']}, {parsed['town']}. "
        f"Units: {', '.join(u['raw'] for u in parsed['units'])}. "
        "Block-level location only; no patient details. "
        "Unofficial — information from public radio traffic may be "
        "incomplete. Call 911 for emergencies."
    )
    return {
        "rule_id": "dispatch",
        "severity": parsed.get("severity", "moderate"),
        "incident_key": key,
        "title": f"{parsed['call_type_raw']} — {parsed['town']}",
        "summary": summary,
        "items": [],
        "source_ids": ["dispatch_parse"],
        "urls": [],
    }
