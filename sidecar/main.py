"""Cape Dispatch news sidecar — FastAPI front for the Python news/alert stack.

The sidecar is the Python half of the gods-eye-view migration: it keeps the
already-built, already-tested watchers and news pipeline (news_ingest,
adsb_watch, acars_watch, ipaws_watch, lightning_watch, news_writer,
news_blog) running as a small loopback service the Node app proxies, instead
of rewriting them in Node. It serves ONLY the news/alert surface:

  GET /health                liveness + DB/store counts
  GET /api/news/latest       newest stored source items (JSON)
  GET /api/news/status       per-source health + stored/alert counts
  GET /api/alerts            newest auto-catch alerts from news_alerts
  GET /api/alerts/{key}      one alert + its incident report
  GET /api/history/aircraft  stored aircraft/ship positions in a window
  GET /api/history/feed      stored feed items in a window
  GET /api/history/status    stored row counts + the honest window
  GET /news                  published blog posts (HTML, via news_blog router)
  GET /news/feed.xml         published posts as RSS 2.0
  GET /news/{slug}           one published article (HTML)
  GET /blog                  published posts in the Blog category (HTML)
  GET /api/news/review       posts awaiting human review (JSON)

Background loops (same cycles as the old site ran them):
  news refresh 15 min, with a 5-min fast cycle for anomaly sources
  (FAA ground stop, NWS alerts); ADS-B / ACARS / IPAWS / lightning
  watchers every 5 min; blog writer once per 5-min cycle over the
  freshest items (skipped entirely when GEMINI_API_KEY is unset).

Run:  uvicorn main:app --host 127.0.0.1 --port 8120
(or: python -m uvicorn main:app --host 127.0.0.1 --port 8120)
from this directory, so `app` resolves to sidecar/app. Loopback only —
the sidecar is never exposed directly; the Node app proxies it
(server/providers/sidecar.js, SIDECAR_URL).

Env (names only; values come from the service environment / .env):
  NEWS_DB_FILE      sidecar SQLite DB (default: sidecar/data/cape_dispatch.db;
                    created by sidecar/migrate.py — see README.md)
  LIGHTNING_DB_FILE lightning watcher state (default: sidecar/data/lightning_watch.db)
  GEMINI_API_KEY    Gemini key for the blog writer; writer is inert without it
  GEMINI_MODEL      optional writer model override (default gemini-3.5-flash-lite)
  NEWS_SOURCES_JSON optional override of the news source allowlist (JSON)
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

# --- Env defaults. MUST be set before importing app.*: the modules read
# NEWS_DB_FILE / LIGHTNING_DB_FILE at import time.
SIDECAR_DIR = Path(__file__).resolve().parent
DATA_DIR = SIDECAR_DIR / "data"
os.environ.setdefault("NEWS_DB_FILE", str(DATA_DIR / "cape_dispatch.db"))
os.environ.setdefault(
    "LIGHTNING_DB_FILE", str(DATA_DIR / "lightning_watch.db")
)

from fastapi import FastAPI, Query  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from app import (  # noqa: E402
    acars_watch,
    adsb_watch,
    credibility,
    history,
    ipaws_watch,
    lightning_watch,
    news_blog,
    news_ingest,
    news_writer,
)

log = logging.getLogger("sidecar")
logging.basicConfig(level=logging.INFO)
_STARTED = time.time()

app = FastAPI(title="cape-dispatch-sidecar", version="1.0.0")
app.include_router(news_blog.router)


@app.get("/health")
def health() -> dict:
    st = news_ingest.status()
    return {
        "ok": True,
        "service": "cape-dispatch-sidecar",
        "uptime_s": int(time.time() - _STARTED),
        "db": os.environ["NEWS_DB_FILE"],
        "db_exists": Path(os.environ["NEWS_DB_FILE"]).exists(),
        "stored": st.get("stored", 0),
        "alerts": st.get("alerts", 0),
        "sources": len(st.get("sources", [])),
        "writer_enabled": bool(news_writer.get_api_key()),
    }


@app.get("/api/news/latest")
def api_news_latest(limit: int = 15) -> dict:
    items = news_ingest.latest(limit)
    return {"count": len(items), "items": items}


@app.get("/api/news/status")
def api_news_status() -> dict:
    return news_ingest.status()


@app.get("/api/alerts")
def api_alerts(limit: int = 10) -> dict:
    alerts = news_ingest.latest_alerts(limit)
    return {"count": len(alerts), "alerts": alerts}


@app.get("/api/alerts/{incident_key}")
def api_alert(incident_key: str):
    alert = news_ingest.get_alert(incident_key)
    if alert is None:
        return JSONResponse({"error": "alert_not_found"}, status_code=404)
    return alert


@app.get("/api/credibility")
def api_credibility(limit: int = 20) -> dict:
    """D2: scored alert clusters (credibility 0-100 + trend), newest first.

    Clusters touching a blocked domain (RT / Sputnik / PressTV) are excluded
    from the list and counted as `excluded_count` — the exclusion is
    reported, never silent. A cluster with no sources is unscored and
    omitted. Read-only; never writes.
    """
    alerts = news_ingest.latest_alerts(limit)
    clusters = []
    excluded_count = 0
    for alert in alerts:
        scored = credibility.score_alert(alert)
        if scored is None:
            continue
        if scored.get("excluded"):
            excluded_count += 1
            continue
        clusters.append(scored)
    return {
        "count": len(clusters),
        "excluded_count": excluded_count,
        "clusters": clusters,
        "fetchedAt": int(time.time() * 1000),
    }


@app.get("/api/credibility/{incident_key}")
def api_credibility_one(incident_key: str):
    """D2: one scored alert cluster by incident_key."""
    alert = news_ingest.get_alert(incident_key)
    if alert is None:
        return JSONResponse({"error": "alert_not_found"}, status_code=404)
    scored = credibility.score_alert(alert)
    if scored is None:
        return JSONResponse({"error": "alert_not_scored"}, status_code=404)
    return scored


@app.get("/api/history/aircraft")
def api_history_aircraft(
    from_ms: str | None = Query(default=None, alias="from"),
    until_ms: str | None = Query(default=None, alias="until"),
    bbox: str | None = None,
    kind: str | None = None,
    limit: str | None = None,
) -> dict:
    """D3: stored aircraft/ship positions in [from, until] (ms epochs).

    Read-only against the sidecar DB; positions only, never raw text.
    Window defaults to the last hour and clamps to 24 h; limit clamps
    to 500. A seconds-epoch window returns nothing (1970 in ms).
    """
    try:
        start, end = history.resolve_window(
            from_ms, until_ms, now_ms=int(time.time() * 1000)
        )
        box = history.parse_bbox(bbox)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    try:
        with history.open_db() as con:
            rows = history.query_aircraft(
                con, start, end, bbox=box, kind=kind,
                limit=history.clamp_limit(limit),
            )
    except FileNotFoundError:
        return JSONResponse({"error": "history_unavailable"}, status_code=503)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return {
        "count": len(rows),
        "fromMs": start,
        "untilMs": end,
        "rows": rows,
        "fetchedAt": int(time.time() * 1000),
    }


@app.get("/api/history/feed")
def api_history_feed(
    from_ms: str | None = Query(default=None, alias="from"),
    until_ms: str | None = Query(default=None, alias="until"),
    source: str | None = None,
    limit: str | None = None,
) -> dict:
    """D3: stored feed items in [from, until] (ms epochs).

    Titles only — description and raw_json never leave the store.
    Same window/limit rules as /api/history/aircraft.
    """
    try:
        start, end = history.resolve_window(
            from_ms, until_ms, now_ms=int(time.time() * 1000)
        )
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    try:
        with history.open_db() as con:
            rows = history.query_feed(
                con, start, end, source=source,
                limit=history.clamp_limit(limit),
            )
    except FileNotFoundError:
        return JSONResponse({"error": "history_unavailable"}, status_code=503)
    return {
        "count": len(rows),
        "fromMs": start,
        "untilMs": end,
        "rows": rows,
        "fetchedAt": int(time.time() * 1000),
    }


@app.get("/api/history/status")
def api_history_status() -> dict:
    """D3: stored row counts + the honest window (oldest/newest ms)."""
    try:
        with history.open_db() as con:
            return history.history_status(con)
    except FileNotFoundError:
        return JSONResponse({"error": "history_unavailable"}, status_code=503)


async def _writer_loop() -> None:
    """One writer pass per 5-min cycle over the freshest items.

    process_items() is synchronous (Gemini over httpx) so it runs in a
    thread; a failed cluster is logged and skipped inside process_items.
    With no GEMINI_API_KEY the writer is inert — skip the cycle quietly.
    """
    while True:
        try:
            if news_writer.get_api_key():
                fresh = news_ingest.latest(50)
                if fresh:
                    await asyncio.to_thread(news_writer.process_items, fresh)
        except Exception as exc:  # never kill the loop
            log.warning("sidecar writer cycle error: %s", exc)
        await asyncio.sleep(300)


@app.on_event("startup")
async def _startup() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    news_ingest._init_db()
    news_blog.init_posts_db()
    if news_writer.get_api_key():
        log.info("sidecar: blog writer enabled (GEMINI_API_KEY set)")
    else:
        log.info("sidecar: blog writer inert (no GEMINI_API_KEY)")
    asyncio.create_task(news_ingest._background_refresher())
    asyncio.create_task(adsb_watch._background_refresher())
    asyncio.create_task(acars_watch._background_refresher())
    asyncio.create_task(ipaws_watch._background_refresher())
    asyncio.create_task(lightning_watch._background_refresher())
    asyncio.create_task(_writer_loop())
    log.info("sidecar: background loops started (news 15m/5m fast, watchers 5m)")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8120)
