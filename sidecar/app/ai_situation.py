"""AI situation layer (D1): snapshots + retrieval-grounded Q&A + forecaster.

Three pieces, one model (Gemini free tier, already keyed). The sidecar
stores what the AI reasons over; the UI layer (`ai-situation`) only
displays it.

- **Snapshots** (`layer_state_snapshots`): every 15 min the snapshot job
  captures what the sidecar can measure directly — CO-OPS tide (Cape May
  8536110 + Atlantic City 8534720), USGS gauges (01411000 + 01411300),
  MassOutage county outages (FIPS 34009, keyless), SWPC Kp, and the
  sidecar's own alert/lightning/aircraft/feed counts. All four external
  fetches are keyless public APIs, verified live 2026-11-17. A failed
  fetch skips that layer's row for the cycle (a gap, honestly) — no row
  is ever faked. Retention: 90 days (rolling delete in the job).
- **Q&A** (`POST /api/qa`): keyword + recency retrieval over stored rows
  (SQLite LIKE + time filter, cap 20), then Gemini answers ONLY from
  those records, with a citation per claim. No record → "I don't have a
  record of that". The retriever never selects `raw_json` or dispatch
  text — raw ACARS/dispatch free text can never reach the model.
- **Forecaster**: the rules in `forecaster_rules.py` compute the numbers;
  the LLM only drafts plain English, and the rule checks the numbers
  (the draft must carry the rule's confidence) before anything is stored.
  Every prediction is stored with confidence + exact sources + what
  would change it + a later outcome check.

Degrades gracefully without a key: Q&A answers "writer not configured"
(the retrieved records are still returned, browsable); the forecaster's
rules half still computes and stores rule-only predictions labeled
"rules only — no plain-English draft"; the brief does not generate.

The D4 risk score is NOT duplicated server-side: its rule table lives in
`src/data/countyRisk.js` (single source of truth, client-side). The
snapshot stores the same inputs the score is built from, so any trend
the score shows is visible in the stored inputs — and the forecaster
rules operate on those inputs.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("ai_situation")

SNAPSHOT_INTERVAL_S = 15 * 60
SNAPSHOT_RETENTION_DAYS = 90
RETRIEVAL_LIMIT = 20
RETRIEVAL_WINDOW_HOURS = 24

COOPS_STATIONS = ("8536110", "8534720")
USGS_SITES = ("01411000", "01411300")
MASSOUTAGE_COUNTY_FIPS = "34009"

QA_NO_RECORD = "I don't have a record of that"
QA_WRITER_OFF = "writer not configured"
UNOFFICIAL_BANNER = "Unofficial — not official guidance"
EMERGENCY_NOTE = "Call 911 for emergencies"

# Verified thresholds only. First-flood roads + feeder history are NOT
# seeded — they need William's (or the A7 record's) confirmation and are
# marked "to be curated" in the spec; a missing fact is unknown, never
# invented.
SEED_FACTS = [
    (
        "nws_minor_flood_ft",
        6.2,
        "NWS minor-flood threshold, Cape May Harbor (verified)",
    ),
    (
        "mdapi_minor_flood_ft",
        6.70,
        "MDAPI minor-flood threshold (verified)",
    ),
    (
        "flood_threshold_note",
        "NWS 6.2 ft (Cape May Harbor) vs MDAPI 6.70 ft — discrepancy noted, not resolved",
        "D1 seed note",
    ),
]

STOPWORDS = frozenset(
    """
    a an the and or of to in on for is are was were what when where who
    how why did do does is it its this that these those there here with
    from by at as be been being have has had will would can could should
    about into over under after before between through during each any
    all some no not only own same so than too very just now then once
    """.split()
)

# Topic words that pull the latest snapshot rows into a retrieval. Without
# a topic match, numeric snapshot rows stay out of the answer — a tide
# reading is not evidence for a question about outages.
SNAPSHOT_TOPICS = {
    "tides": {"tide", "tides", "flood", "flooding", "water", "high", "surge", "coastal"},
    "outages": {"outage", "outages", "power", "electric", "electricity", "customers"},
    "lightning": {"lightning", "storm", "thunder", "thunderstorm"},
    "space-weather": {"kp", "solar", "space", "geomagnetic", "aurora"},
    "aircraft": {"aircraft", "flight", "flights", "military", "plane", "planes", "jet"},
    "alerts": {"alert", "alerts", "warning", "warnings", "watch", "advisory"},
}


def _db_path(db_path: Any = None) -> Path:
    if db_path is not None:
        return Path(db_path)
    from app import news_ingest

    return Path(news_ingest.DB_PATH)


def init_ai_db(db_path: Any = None) -> None:
    """CREATE TABLE IF NOT EXISTS for the three D1 tables + seed facts.
    Idempotent; never wipes. The live DB is the sidecar's news DB."""
    path = _db_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=10)
    try:
        con.execute(
            """CREATE TABLE IF NOT EXISTS layer_state_snapshots (
                   id INTEGER PRIMARY KEY,
                   layer_id TEXT,
                   captured_at INTEGER,
                   state_json TEXT,
                   source TEXT
               )"""
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_snap_layer_time "
            "ON layer_state_snapshots(layer_id, captured_at)"
        )
        con.execute(
            """CREATE TABLE IF NOT EXISTS predictions (
                   id INTEGER PRIMARY KEY,
                   rule_id TEXT,
                   text TEXT,
                   confidence REAL,
                   source_record_ids TEXT,
                   what_would_change_it TEXT,
                   created_at INTEGER,
                   valid_until INTEGER,
                   outcome TEXT,
                   checked_at INTEGER,
                   checked_against TEXT
               )"""
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_pred_rule_outcome "
            "ON predictions(rule_id, outcome)"
        )
        con.execute(
            """CREATE TABLE IF NOT EXISTS county_facts (
                   id INTEGER PRIMARY KEY,
                   key TEXT UNIQUE,
                   value_json TEXT,
                   source TEXT,
                   updated_at INTEGER,
                   updated_by TEXT
               )"""
        )
        now_ms = int(time.time() * 1000)
        for key, value, source in SEED_FACTS:
            con.execute(
                "INSERT OR IGNORE INTO county_facts "
                "(key, value_json, source, updated_at, updated_by) "
                "VALUES (?, ?, ?, ?, ?)",
                (key, json.dumps(value), source, now_ms, "d1-seed"),
            )
        con.commit()
    finally:
        con.close()


def get_facts(db_path: Any = None) -> dict[str, Any]:
    """The county fact table as a plain dict (missing key = unknown)."""
    path = _db_path(db_path)
    if not path.exists():
        return {}
    init_ai_db(path)
    con = sqlite3.connect(path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT key, value_json FROM county_facts").fetchall()
    finally:
        con.close()
    out: dict[str, Any] = {}
    for row in rows:
        try:
            out[row["key"]] = json.loads(row["value_json"])
        except Exception:
            out[row["key"]] = None
    return out


# ------------------------------------------------------------------ fetchers
# Each fetcher takes a fetch_json(url) callable (injectable; production
# uses httpx GET, lazily imported so the module boots without it) and
# returns (layer_id, state_dict) or None on any failure. A failed fetch
# skips the row for the cycle — a gap, honestly, never a faked row.


def _default_fetch_json(url: str) -> dict[str, Any]:
    import httpx

    with httpx.Client(timeout=15) as client:
        resp = client.get(
            url,
            headers={"User-Agent": "cape-dispatch-sidecar/1.0 (+https://capemaydispatch.com)"},
        )
        resp.raise_for_status()
        return resp.json()


def fetch_tides(fetch_json: Any = None) -> tuple[str, dict[str, Any]] | None:
    """CO-OPS water level, latest reading, both county stations (keyless)."""
    fetch = fetch_json or _default_fetch_json
    stations: dict[str, Any] = {}
    try:
        for station in COOPS_STATIONS:
            url = (
                "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
                f"?station={station}&product=water_level&datum=MLLW"
                "&units=english&time_zone=gmt&application=cape-dispatch"
                "&format=json&date=latest"
            )
            payload = fetch(url)
            data = (payload.get("data") or [None])[0]
            if not data or data.get("v") is None:
                return None
            stations[station] = {"ft": float(data["v"]), "at": data.get("t")}
        return (
            "tides",
            {"stations": stations, "cape_may_ft": stations["8536110"]["ft"]},
        )
    except Exception as exc:
        log.warning("ai_situation tides fetch failed: %s", exc)
        return None


def fetch_gauges(fetch_json: Any = None) -> tuple[str, dict[str, Any]] | None:
    """USGS instantaneous gage height (00065) for both county gauges."""
    fetch = fetch_json or _default_fetch_json
    try:
        url = (
            "https://waterservices.usgs.gov/nwis/iv/?format=json"
            f"&sites={','.join(USGS_SITES)}&parameterCd=00065&siteStatus=all"
        )
        payload = fetch(url)
        sites: dict[str, Any] = {}
        for series in (payload.get("value", {}).get("timeSeries") or []):
            source_info = series.get("sourceInfo", {})
            site_code = str(source_info.get("siteCode", [{}])[0].get("value", ""))
            values = (series.get("values") or [{}])[0].get("value") or []
            if not site_code or not values:
                continue
            latest = values[-1]
            sites[site_code] = {
                "ft": float(latest["value"]),
                "at": latest.get("dateTime"),
            }
        if not sites:
            return None
        return ("gauges", {"sites": sites})
    except Exception as exc:
        log.warning("ai_situation gauges fetch failed: %s", exc)
        return None


def fetch_outages(fetch_json: Any = None) -> tuple[str, dict[str, Any]] | None:
    """MassOutage county live endpoint (keyless: 5 req / 5 min per IP;
    the job runs every 15 min, so one call per cycle fits)."""
    fetch = fetch_json or _default_fetch_json
    try:
        url = f"https://massoutage.com/api/v1/live/counties/{MASSOUTAGE_COUNTY_FIPS}"
        payload = fetch(url)
        data = payload.get("data") or {}
        if "customers_out" not in data:
            return None
        return (
            "outages",
            {
                "customers_out": int(data["customers_out"]),
                "customers_tracked": int(data.get("customers_tracked") or 0),
                "incident_count": int(data.get("incident_count") or 0),
                "as_of": data.get("as_of"),
            },
        )
    except Exception as exc:
        log.warning("ai_situation outages fetch failed: %s", exc)
        return None


def fetch_space_weather(fetch_json: Any = None) -> tuple[str, dict[str, Any]] | None:
    """SWPC planetary K-index, latest 1-minute entry (keyless)."""
    fetch = fetch_json or _default_fetch_json
    try:
        url = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
        payload = fetch(url)
        if not isinstance(payload, list) or not payload:
            return None
        last = payload[-1]
        return (
            "space-weather",
            {
                "kp": int(last["kp_index"]),
                "estimated_kp": float(last.get("estimated_kp") or 0),
                "at": last.get("time_tag"),
            },
        )
    except Exception as exc:
        log.warning("ai_situation space-weather fetch failed: %s", exc)
        return None


def fetch_sidecar_counts(db_path: Any = None) -> list[tuple[str, dict[str, Any]]]:
    """Counts the sidecar itself can measure: alerts by severity,
    lightning, aircraft by kind (last hour), feed items by source
    (last hour). Never raises; a missing table is an empty count."""
    path = _db_path(db_path)
    out: list[tuple[str, dict[str, Any]]] = []
    if not path.exists():
        return out
    try:
        con = sqlite3.connect(path, timeout=10)
        try:
            con.row_factory = sqlite3.Row
            now_s = int(time.time())
            hour_ago_s = now_s - 3600
            hour_ago_ms = hour_ago_s * 1000
            # Alerts (the news_alerts table; severity counts + latest).
            try:
                rows = con.execute(
                    "SELECT severity, COUNT(*) c FROM news_alerts GROUP BY severity"
                ).fetchall()
                by_severity = {r["severity"]: r["c"] for r in rows}
                critical = by_severity.get("critical", 0)
                out.append(
                    (
                        "alerts",
                        {
                            "total": sum(by_severity.values()),
                            "by_severity": by_severity,
                            "critical_active": critical,
                        },
                    )
                )
            except sqlite3.Error:
                pass
            # Lightning (the watcher's own DB; read-only helper).
            try:
                from app import lightning_watch

                status = lightning_watch.lightning_status()
                out.append(
                    (
                        "lightning",
                        {
                            "flashes30m": status.get("flashes30m"),
                            "flashes60m": status.get("flashes60m"),
                            "lastFlashMs": status.get("lastFlashMs"),
                        },
                    )
                )
            except Exception:
                pass
            # Aircraft by kind, last hour (seen_at is a ms epoch).
            try:
                rows = con.execute(
                    "SELECT kind, COUNT(*) c FROM aircraft_history "
                    "WHERE seen_at >= ? GROUP BY kind",
                    (hour_ago_ms,),
                ).fetchall()
                by_kind = {r["kind"]: r["c"] for r in rows}
                out.append(
                    (
                        "aircraft",
                        {
                            "air": by_kind.get("air", 0),
                            "mil": by_kind.get("mil", 0),
                            "emg": by_kind.get("emg", 0),
                        },
                    )
                )
            except sqlite3.Error:
                pass
            # Feed items by source, last hour (pub_ms is a ms epoch).
            try:
                rows = con.execute(
                    "SELECT source, COUNT(*) c FROM feed_history "
                    "WHERE pub_ms >= ? GROUP BY source",
                    (hour_ago_ms,),
                ).fetchall()
                out.append(
                    ("feed", {"by_source": {r["source"]: r["c"] for r in rows}})
                )
            except sqlite3.Error:
                pass
        finally:
            con.close()
    except Exception as exc:
        log.warning("ai_situation sidecar counts failed: %s", exc)
    return out


def snapshot_cycle(
    db_path: Any = None,
    *,
    fetch_json: Any = None,
    now_ms: int | None = None,
) -> dict[str, Any]:
    """One 15-minute snapshot cycle: fetch every layer, write one row per
    successful layer, rolling-delete rows older than 90 days. A failed
    fetch skips that layer's row for the cycle — a gap, honestly.
    Returns { written: [layer_ids], failed: [layer_ids] }."""
    path = _db_path(db_path)
    init_ai_db(path)
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    results: list[tuple[str, dict[str, Any]] | None] = [
        fetch_tides(fetch_json),
        fetch_gauges(fetch_json),
        fetch_outages(fetch_json),
        fetch_space_weather(fetch_json),
    ]
    results.extend(fetch_sidecar_counts(path))
    written: list[str] = []
    failed: list[str] = []
    con = sqlite3.connect(path, timeout=10)
    try:
        for result in results:
            if result is None:
                continue
            layer_id, state = result
            if state is None:
                failed.append(layer_id)
                continue
            con.execute(
                "INSERT INTO layer_state_snapshots "
                "(layer_id, captured_at, state_json, source) VALUES (?, ?, ?, ?)",
                (layer_id, now, json.dumps(state), _snapshot_source(layer_id)),
            )
            written.append(layer_id)
        # The four external fetchers return None (not a named failure) when
        # the upstream is down; record which of them did not write.
        for layer_id in ("tides", "gauges", "outages", "space-weather"):
            if layer_id not in written:
                failed.append(layer_id)
        cutoff = now - SNAPSHOT_RETENTION_DAYS * 24 * 3600 * 1000
        con.execute(
            "DELETE FROM layer_state_snapshots WHERE captured_at < ?", (cutoff,)
        )
        con.commit()
    finally:
        con.close()
    return {"written": written, "failed": sorted(set(failed))}


def _snapshot_source(layer_id: str) -> str:
    return {
        "tides": "co-ops",
        "gauges": "usgs",
        "outages": "massoutage",
        "space-weather": "swpc",
        "alerts": "sidecar-db",
        "lightning": "sidecar-db",
        "aircraft": "sidecar-db",
        "feed": "sidecar-db",
    }.get(layer_id, "sidecar-db")


def latest_snapshots(db_path: Any = None) -> dict[str, dict[str, Any]]:
    """Newest snapshot row per layer: { layer_id: { state, captured_at } }."""
    path = _db_path(db_path)
    if not path.exists():
        return {}
    con = sqlite3.connect(path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT layer_id, captured_at, state_json FROM layer_state_snapshots "
            "ORDER BY captured_at DESC"
        ).fetchall()
    finally:
        con.close()
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row["layer_id"] in out:
            continue
        try:
            state = json.loads(row["state_json"] or "{}")
        except Exception:
            state = {}
        out[row["layer_id"]] = {"state": state, "captured_at": row["captured_at"]}
    return out


def snapshot_series(
    layer_id: str, db_path: Any = None, *, since_ms: int = 0
) -> list[dict[str, Any]]:
    """All snapshot rows for one layer since a ms epoch, oldest first."""
    path = _db_path(db_path)
    if not path.exists():
        return []
    con = sqlite3.connect(path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT captured_at, state_json FROM layer_state_snapshots "
            "WHERE layer_id = ? AND captured_at >= ? ORDER BY captured_at ASC",
            (layer_id, since_ms),
        ).fetchall()
    finally:
        con.close()
    out = []
    for row in rows:
        try:
            state = json.loads(row["state_json"] or "{}")
        except Exception:
            continue
        out.append({"captured_at": row["captured_at"], "state": state})
    return out


# ------------------------------------------------------------------ retrieval

def _keywords(question: str) -> list[str]:
    tokens = []
    for raw in str(question or "").lower().split():
        token = "".join(ch for ch in raw if ch.isalnum())
        if len(token) >= 3 and token not in STOPWORDS:
            tokens.append(token)
    # De-duplicated, order kept.
    return list(dict.fromkeys(tokens))


def retrieve(
    question: str,
    db_path: Any = None,
    *,
    since_hours: int = RETRIEVAL_WINDOW_HOURS,
    limit: int = RETRIEVAL_LIMIT,
) -> list[dict[str, Any]]:
    """Keyword + recency retrieval over stored rows. Never selects
    `raw_json` or dispatch text — raw ACARS/dispatch free text can never
    reach the model. Returns [{ record_id, source, title, snippet, url,
    at_ms }], newest first, capped at `limit`."""
    keywords = _keywords(question)
    if not keywords:
        return []
    path = _db_path(db_path)
    if not path.exists():
        return []
    now_ms = int(time.time() * 1000)
    since_ms = now_ms - since_hours * 3600 * 1000
    since_s = since_ms // 1000
    like = " OR ".join(["(title LIKE ? OR summary LIKE ?)"] * len(keywords))
    params: list[Any] = []
    for kw in keywords:
        params.extend([f"%{kw}%", f"%{kw}%"])
    out: list[dict[str, Any]] = []
    con = sqlite3.connect(path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        # News items (title/summary only — never raw_json).
        try:
            rows = con.execute(
                f"SELECT id, source_name, title, summary, url, pub_ms FROM news_items "
                f"WHERE pub_ms >= ? AND ({like}) ORDER BY pub_ms DESC LIMIT ?",
                [since_ms, *params, limit],
            ).fetchall()
            for r in rows:
                out.append(
                    {
                        "record_id": f"news_item:{r['id']}",
                        "source": r["source_name"],
                        "title": r["title"],
                        "snippet": (r["summary"] or "")[:240],
                        "url": r["url"],
                        "at_ms": r["pub_ms"],
                    }
                )
        except sqlite3.Error:
            pass
        # Alerts (title/summary only).
        try:
            rows = con.execute(
                f"SELECT incident_key, severity, title, summary, last_seen FROM news_alerts "
                f"WHERE last_seen >= ? AND ({like}) ORDER BY last_seen DESC LIMIT ?",
                [since_s, *params, limit],
            ).fetchall()
            for r in rows:
                out.append(
                    {
                        "record_id": f"news_alert:{r['incident_key']}",
                        "source": "news_alerts",
                        "title": r["title"],
                        "snippet": (r["summary"] or "")[:240],
                        "url": None,
                        "at_ms": r["last_seen"] * 1000,
                    }
                )
        except sqlite3.Error:
            pass
        # Feed history (title only — never description/raw_json).
        try:
            feed_like = " OR ".join(["title LIKE ?"] * len(keywords))
            rows = con.execute(
                f"SELECT id, source, title, pub_ms FROM feed_history "
                f"WHERE pub_ms >= ? AND ({feed_like}) ORDER BY pub_ms DESC LIMIT ?",
                [since_ms, *[f"%{kw}%" for kw in keywords], limit],
            ).fetchall()
            for r in rows:
                out.append(
                    {
                        "record_id": f"feed:{r['id']}",
                        "source": r["source"],
                        "title": r["title"],
                        "snippet": "",
                        "url": None,
                        "at_ms": r["pub_ms"],
                    }
                )
        except sqlite3.Error:
            pass
        # County facts (key/value — the curated table).
        try:
            rows = con.execute(
                "SELECT key, value_json FROM county_facts "
                "WHERE key LIKE ? OR value_json LIKE ?",
                [f"%{keywords[0]}%", f"%{keywords[0]}%"],
            ).fetchall()
            for r in rows:
                out.append(
                    {
                        "record_id": f"fact:{r['key']}",
                        "source": "county_facts",
                        "title": r["key"],
                        "snippet": str(r["value_json"])[:240],
                        "url": None,
                        "at_ms": None,
                    }
                )
        except sqlite3.Error:
            pass
    finally:
        con.close()
    # Snapshots: only when the question names the topic, and only the
    # latest row per matching layer (numeric state is not prose evidence).
    wanted = {
        layer for layer, topics in SNAPSHOT_TOPICS.items() if topics & set(keywords)
    }
    for layer_id in sorted(wanted):
        snap = latest_snapshots(path).get(layer_id)
        if snap:
            out.append(
                {
                    "record_id": f"snapshot:{layer_id}",
                    "source": layer_id,
                    "title": f"Latest {layer_id} snapshot",
                    "snippet": json.dumps(snap["state"])[:240],
                    "url": None,
                    "at_ms": snap["captured_at"],
                }
            )
    out.sort(key=lambda r: (r["at_ms"] is None, r["at_ms"] or 0), reverse=True)
    return out[:limit]


def closest_topics(db_path: Any = None, *, limit: int = 5) -> list[dict[str, Any]]:
    """For the no-record answer: the most recent stored topics, as links.
    Never invents a topic — only what the store actually holds."""
    path = _db_path(db_path)
    if not path.exists():
        return []
    con = sqlite3.connect(path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT title, last_seen FROM news_alerts "
            "ORDER BY last_seen DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        con.close()
    return [
        {"title": r["title"], "record_id": "news_alerts", "at_ms": r["last_seen"] * 1000}
        for r in rows
    ]


# ------------------------------------------------------------------ Q&A

def _qa_prompt(question: str, records: list[dict[str, Any]]) -> str:
    from app import news_writer

    numbered = []
    for i, rec in enumerate(records, 1):
        numbered.append(
            f"[{i}] {rec['source']} — {rec['title']}: {rec['snippet']}"
            + (f" ({rec['url']})" if rec.get("url") else "")
        )
    return (
        news_writer.WRITER_SYSTEM
        + "\n\nAnswer the question using ONLY the records below. "
        "Every claim in the answer must cite a record number, like [1]. "
        "Do not use outside knowledge. Do not invent a position, a name, "
        "or a number that is not in the records. If the records do not "
        "answer the question, say exactly: I don't have a record of that. "
        "Never present this answer as official guidance.\n\n"
        f"Question: {question}\n\n"
        "Records:\n" + "\n".join(numbered) + "\n\n"
        'Reply as JSON only: {"answer": "...", '
        '"citations": [{"record_id": "...", "claim": "..."}], '
        '"confidence": 0.0 to 1.0}'
    )


def answer_question(
    question: str,
    db_path: Any = None,
    *,
    api_key: str | None = None,
    model: str | None = None,
    transport: Any = None,
) -> dict[str, Any]:
    """Retrieval-grounded Q&A. The response shape is the spec's:
    { answer, citations, confidence, unofficial, emergencyNote,
    retrievedAt } — plus closest_topics on a no-record answer."""
    path = _db_path(db_path)
    init_ai_db(path)
    records = retrieve(question, path)
    retrieved_at = int(time.time() * 1000)
    base = {
        "unofficial": True,
        "emergencyNote": EMERGENCY_NOTE,
        "retrievedAt": retrieved_at,
    }
    if not records:
        return {
            **base,
            "answer": QA_NO_RECORD,
            "citations": [],
            "confidence": None,
            "closest_topics": closest_topics(path),
        }
    citations = [
        {
            "record_id": r["record_id"],
            "source": r["source"],
            "url": r["url"],
            "snippet": r["snippet"],
        }
        for r in records
    ]
    if api_key is None:
        # Graceful degradation: the records are still browsable.
        return {
            **base,
            "answer": QA_WRITER_OFF,
            "citations": citations,
            "confidence": None,
        }
    from app import news_writer

    try:
        text = news_writer.generate_content(
            _qa_prompt(question, records),
            api_key=api_key,
            model=model,
            transport=transport,
        )
    except Exception as exc:
        log.warning("ai_situation qa generation failed: %s", exc)
        return {
            **base,
            "answer": QA_WRITER_OFF,
            "citations": citations,
            "confidence": None,
        }
    try:
        parsed = json.loads(text)
    except Exception:
        return {**base, "answer": QA_NO_RECORD, "citations": [], "confidence": None}
    answer = str(parsed.get("answer") or "").strip()
    if not answer:
        return {**base, "answer": QA_NO_RECORD, "citations": [], "confidence": None}
    # The model may only cite records it was given; drop anything else.
    valid_ids = {r["record_id"] for r in records}
    kept = []
    for cite in parsed.get("citations") or []:
        if isinstance(cite, dict) and cite.get("record_id") in valid_ids:
            kept.append(
                {
                    "record_id": cite["record_id"],
                    "source": next(
                        r["source"]
                        for r in records
                        if r["record_id"] == cite["record_id"]
                    ),
                    "url": next(
                        r["url"]
                        for r in records
                        if r["record_id"] == cite["record_id"]
                    ),
                    "claim": str(cite.get("claim") or "")[:240],
                }
            )
    confidence = parsed.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        confidence = None
    if answer == QA_NO_RECORD:
        return {
            **base,
            "answer": answer,
            "citations": [],
            "confidence": None,
            "closest_topics": closest_topics(path),
        }
    return {**base, "answer": answer, "citations": kept, "confidence": confidence}


# ------------------------------------------------------------------ forecaster

def _open_prediction(rule_id: str, db_path: Any, now_ms: int) -> dict[str, Any] | None:
    con = sqlite3.connect(db_path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT id, text, created_at, valid_until FROM predictions "
            "WHERE rule_id = ? AND outcome = 'open' AND valid_until > ? "
            "ORDER BY created_at DESC LIMIT 1",
            (rule_id, now_ms),
        ).fetchone()
    finally:
        con.close()
    return dict(row) if row else None


def _store_prediction(
    db_path: Any, pred: dict[str, Any], *, created_at: int
) -> dict[str, Any]:
    con = sqlite3.connect(db_path, timeout=10)
    try:
        cur = con.execute(
            "INSERT INTO predictions (rule_id, text, confidence, "
            "source_record_ids, what_would_change_it, created_at, "
            "valid_until, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')",
            (
                pred["rule_id"],
                pred["text"],
                pred["confidence"],
                json.dumps(pred["source_record_ids"]),
                pred["what_would_change_it"],
                created_at,
                pred["valid_until_ms"],
            ),
        )
        con.commit()
        pred_id = cur.lastrowid
    finally:
        con.close()
    return {"id": pred_id, **pred, "outcome": "open", "created_at": created_at}


def _draft_plain_english(
    pred: dict[str, Any],
    *,
    api_key: str | None,
    model: str | None,
    transport: Any,
) -> str | None:
    """Ask the model to draft the plain-English version of a rule
    prediction, then CHECK the numbers: the draft must carry the rule's
    confidence. If it does not, the rules-only text stands."""
    if api_key is None:
        return None
    from app import news_writer

    prompt = (
        news_writer.WRITER_SYSTEM
        + "\n\nRewrite this rule-computed prediction in plain English for "
        "a Cape May County resident. Keep every number exactly as given, "
        "including the confidence. Do not add a new number, a new place, "
        "or a new claim. Do not present this as official guidance.\n\n"
        f"Rule text: {pred['text']}\n"
        f"Confidence: {pred['confidence']:.2f}\n"
        f"What would change it: {pred['what_would_change_it']}\n\n"
        'Reply as JSON only: {"text": "..."}'
    )
    try:
        text = news_writer.generate_content(
            prompt, api_key=api_key, model=model, transport=transport
        )
        draft = str(json.loads(text).get("text") or "").strip()
    except Exception as exc:
        log.warning("ai_situation forecaster draft failed: %s", exc)
        return None
    if not draft or f"{pred['confidence']:.2f}" not in draft:
        # The rule checks the numbers: a draft that drops the confidence
        # (or invents its own) is rejected; the rules-only text stands.
        return None
    return draft


def run_forecaster(
    db_path: Any = None,
    *,
    api_key: str | None = None,
    model: str | None = None,
    transport: Any = None,
    now_ms: int | None = None,
) -> list[dict[str, Any]]:
    """Evaluate the forecaster rules against the latest stored data and
    store any firing prediction. Rules run first; the LLM is called only
    when a rule fires. An open prediction for the same rule blocks a
    duplicate until its window lapses."""
    from app import forecaster_rules as rules

    path = _db_path(db_path)
    init_ai_db(path)
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    snaps = latest_snapshots(path)
    facts = get_facts(path)
    stored: list[dict[str, Any]] = []

    # --- flood: NWS alerts + tide series.
    nws_alerts = _recent_nws_alerts(path, now)
    tide_series = snapshot_series("tides", path, since_ms=now - 2 * 3600 * 1000)
    tide_now = None
    tide_prev = None
    if tide_series:
        tide_now = tide_series[-1]["state"].get("cape_may_ft")
        prev = [s for s in tide_series if s["captured_at"] <= now - 3600 * 1000]
        tide_prev = prev[-1]["state"].get("cape_may_ft") if prev else None
    flood = rules.evaluate_flood_rule(
        nws_alerts=nws_alerts,
        tide_now_ft=tide_now,
        tide_prev_ft=tide_prev,
        tide_now_ms=now,
        facts=facts,
    )
    # --- outage: lightning + NWS + outages series.
    lightning = snaps.get("lightning", {}).get("state") or {}
    flashes30 = lightning.get("flashes30m")
    outage_series = snapshot_series("outages", path, since_ms=now - 7 * 24 * 3600 * 1000)
    outage_now = None
    outage_last_max = None
    if outage_series:
        outage_now = outage_series[-1]["state"].get("customers_out")
        outage_last_max = max(
            (s["state"].get("customers_out") or 0) for s in outage_series
        )
    outage = rules.evaluate_outage_rule(
        lightning_flash=bool(flashes30),
        nws_alerts=nws_alerts,
        outage_now=outage_now,
        outage_last_storm_max=outage_last_max,
        now_ms=now,
    )
    # --- mil surge: aircraft snapshot (last hour) vs 30-day median.
    mil_count = (snaps.get("aircraft", {}).get("state") or {}).get("mil", 0)
    mil_median = _mil_median_30d(path, now)
    mil = rules.evaluate_mil_surge_rule(
        mil_count_1h=int(mil_count or 0),
        mil_median_30d=mil_median,
        spike_hours_30d=None,
        now_ms=now,
    )
    for pred in (flood, outage, mil):
        if pred is None:
            continue
        if _open_prediction(pred["rule_id"], path, now) is not None:
            continue
        draft = _draft_plain_english(
            pred, api_key=api_key, model=model, transport=transport
        )
        if draft is not None:
            pred = {**pred, "text": draft}
        stored.append(_store_prediction(path, pred, created_at=now))
    return stored


def _recent_nws_alerts(path: Path, now_ms: int) -> list[dict[str, Any]]:
    """Active NWS alerts as the rules expect: { incident_key, event }.
    Read from the sidecar's stored alerts (last 24 h)."""
    if not path.exists():
        return []
    from app import news_ingest

    try:
        alerts = news_ingest.recent_alerts(now_ms // 1000 - 24 * 3600, limit=100)
    except Exception:
        return []
    out = []
    for a in alerts:
        event = ""
        # The alert title carries the NWS event name; keep the row's own
        # fields and derive the event from the title's leading phrase.
        title = str(a.get("title") or "")
        event = title.split("—")[0].split("-")[0].strip()
        out.append({"incident_key": a.get("incident_key"), "event": event})
    return out


def _mil_median_30d(path: Path, now_ms: int) -> float | None:
    """Median hourly military aircraft count over the last 30 days, from
    the stored snapshots. None when no aircraft snapshots exist yet."""
    series = snapshot_series(
        "aircraft", path, since_ms=now_ms - 30 * 24 * 3600 * 1000
    )
    values = sorted(
        int(s["state"].get("mil") or 0) for s in series if s["state"].get("mil") is not None
    )
    if not values:
        return None
    mid = len(values) // 2
    if len(values) % 2:
        return float(values[mid])
    return (values[mid - 1] + values[mid]) / 2.0


# ------------------------------------------------------------------ outcomes

def check_outcomes(
    db_path: Any = None, *, now_ms: int | None = None
) -> dict[str, int]:
    """Re-read the store for each open prediction past its window and
    mark it confirmed/wrong. A prediction whose outcome cannot be
    checked stays open, labeled 'outcome uncheckable — still open'.
    Returns { checked, confirmed, wrong, still_open }."""
    from app import forecaster_rules as rules

    path = _db_path(db_path)
    init_ai_db(path)
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    facts = get_facts(path)
    threshold = facts.get("nws_minor_flood_ft")
    con = sqlite3.connect(path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT * FROM predictions WHERE outcome = 'open' AND valid_until <= ? "
            "AND (checked_against IS NULL "
            "OR checked_against NOT LIKE 'outcome uncheckable%')",
            (now,),
        ).fetchall()
    finally:
        con.close()
    checked = confirmed = wrong = still_open = 0
    for row in rows:
        pred = dict(row)
        outcome: str | None = None
        against = ""
        if pred["rule_id"] == "flood-noreaster":
            tide_series = snapshot_series(
                "tides",
                path,
                since_ms=pred["created_at"],
            )
            # The window starts AFTER the prediction: the tide at creation
            # time is what the rule fired on, not follow-up evidence.
            window = [
                s
                for s in tide_series
                if pred["created_at"] < s["captured_at"] <= pred["valid_until"]
            ]
            tide_max = max(
                (s["state"].get("cape_may_ft") for s in window),
                default=None,
            )
            mentions = _feed_mentions(
                path,
                pred["created_at"],
                pred["valid_until"],
                ("flood", "closure", "closed", "water over"),
            )
            outcome = rules.check_flood_outcome(
                tide_max_ft=tide_max, threshold_ft=threshold, flood_mentions=mentions
            )
            against = f"tide max {tide_max} ft vs threshold {threshold}; {mentions} flood mentions"
        elif pred["rule_id"] == "outage-thunderstorm":
            series = snapshot_series(
                "outages", path, since_ms=pred["created_at"] - 3600 * 1000
            )
            before = [s for s in series if s["captured_at"] <= pred["created_at"]]
            after = [
                s
                for s in series
                if pred["created_at"] < s["captured_at"] <= pred["valid_until"]
            ]
            at_pred = (
                before[-1]["state"].get("customers_out") if before else None
            )
            max_win = max(
                (s["state"].get("customers_out") or 0 for s in after),
                default=None,
            )
            outcome = rules.check_outage_outcome(
                outage_at_prediction=at_pred, outage_max_in_window=max_win
            )
            against = f"outages {at_pred} at prediction, max {max_win} in window"
        else:
            # mil-surge (and any future pattern note): no checkable
            # outcome by design. Mark it once so it is not re-checked.
            outcome = None
            against = "outcome uncheckable — still open"
        if outcome is None and pred["rule_id"] != "mil-surge-pattern":
            still_open += 1
            continue
        checked += 1
        if outcome == "confirmed":
            confirmed += 1
        elif outcome == "wrong":
            wrong += 1
        else:
            still_open += 1
        con = sqlite3.connect(path, timeout=10)
        try:
            con.execute(
                "UPDATE predictions SET outcome = ?, checked_at = ?, "
                "checked_against = ? WHERE id = ?",
                (
                    outcome if outcome is not None else "open",
                    now,
                    against,
                    pred["id"],
                ),
            )
            con.commit()
        finally:
            con.close()
    return {
        "checked": checked,
        "confirmed": confirmed,
        "wrong": wrong,
        "still_open": still_open,
    }


def _feed_mentions(
    path: Path, start_ms: int, end_ms: int, keywords: tuple[str, ...]
) -> int:
    """Count feed_history titles in a window mentioning any keyword.
    Title only — never description/raw_json."""
    if not path.exists():
        return 0
    con = sqlite3.connect(path, timeout=10)
    try:
        like = " OR ".join(["title LIKE ?"] * len(keywords))
        row = con.execute(
            f"SELECT COUNT(*) c FROM feed_history "
            f"WHERE pub_ms >= ? AND pub_ms <= ? AND ({like})",
            [start_ms, end_ms, *[f"%{kw}%" for kw in keywords]],
        ).fetchone()
        return int(row[0]) if row else 0
    except sqlite3.Error:
        return 0
    finally:
        con.close()


def accuracy_counts(db_path: Any = None) -> dict[str, int]:
    """The forecaster's public honesty record: { open, confirmed, wrong }."""
    path = _db_path(db_path)
    if not path.exists():
        return {"open": 0, "confirmed": 0, "wrong": 0}
    con = sqlite3.connect(path, timeout=10)
    try:
        rows = con.execute(
            "SELECT outcome, COUNT(*) c FROM predictions GROUP BY outcome"
        ).fetchall()
    finally:
        con.close()
    counts = {"open": 0, "confirmed": 0, "wrong": 0}
    for outcome, c in rows:
        if outcome in counts:
            counts[outcome] = c
    return counts


def list_predictions(
    db_path: Any = None, *, limit: int = 20
) -> list[dict[str, Any]]:
    """Newest predictions first, with source ids parsed."""
    path = _db_path(db_path)
    if not path.exists():
        return []
    con = sqlite3.connect(path, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT * FROM predictions ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        con.close()
    out = []
    for row in rows:
        pred = dict(row)
        try:
            pred["source_record_ids"] = json.loads(pred["source_record_ids"] or "[]")
        except Exception:
            pred["source_record_ids"] = []
        out.append(pred)
    return out


def trend_lines(db_path: Any = None, *, now_ms: int | None = None) -> list[str]:
    """Brief inputs from the snapshots: alert counts, tide, outages, Kp.
    A line is omitted when its series is missing — never faked."""
    path = _db_path(db_path)
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    day_ms = 24 * 3600 * 1000
    lines: list[str] = []
    # Alerts: last 24 h vs the prior 24 h (from the alerts table).
    try:
        from app import news_ingest

        recent = news_ingest.recent_alerts(now // 1000 - 24 * 3600, limit=200)
        prior = news_ingest.recent_alerts(
            now // 1000 - 48 * 3600, limit=200
        )
        prior = [a for a in prior if a.get("last_seen", 0) < now // 1000 - 24 * 3600]
        lines.append(
            f"Alerts: {len(recent)} in the last 24 hours vs {len(prior)} in the prior 24 hours."
        )
    except Exception:
        pass
    # Tide: now vs 24 h ago.
    tide_series = snapshot_series("tides", path, since_ms=now - day_ms)
    if tide_series:
        now_ft = tide_series[-1]["state"].get("cape_may_ft")
        ago = [s for s in tide_series if s["captured_at"] <= now - day_ms + 900 * 1000]
        if now_ft is not None and ago:
            ago_ft = ago[0]["state"].get("cape_may_ft")
            if ago_ft is not None:
                direction = (
                    "rising" if now_ft > ago_ft else "falling" if now_ft < ago_ft else "steady"
                )
                lines.append(
                    f"Tide at Cape May: {now_ft:.2f} ft MLLW, {direction} "
                    f"from {ago_ft:.2f} ft 24 hours ago."
                )
    # Outages: now vs 24 h ago.
    out_series = snapshot_series("outages", path, since_ms=now - day_ms)
    if out_series:
        now_out = out_series[-1]["state"].get("customers_out")
        ago = [s for s in out_series if s["captured_at"] <= now - day_ms + 900 * 1000]
        if now_out is not None and ago:
            ago_out = ago[0]["state"].get("customers_out")
            if ago_out is not None:
                lines.append(
                    f"Outages: {now_out} customers out now vs {ago_out} 24 hours ago."
                )
    # Kp: latest.
    snaps = latest_snapshots(path)
    kp = (snaps.get("space-weather", {}).get("state") or {}).get("kp")
    if kp is not None:
        lines.append(f"Space weather: Kp {kp}.")
    return lines
