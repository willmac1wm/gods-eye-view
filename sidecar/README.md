# Cape Dispatch news sidecar

The Python half of the gods-eye-view migration. The old site's news pipeline
and watchers were already built, tested, and live-verified — so they keep
running as a small loopback service the Node app proxies, instead of being
rewritten in Node.

## What it is

- **News ingest** (`app/news_ingest.py`): 33-source verified allowlist,
  15-min refresh with a 5-min fast cycle for anomaly sources (FAA ground
  stop, NWS Mount Holly alerts), plus the auto-catch rules that write
  `news_alerts` (34 rows at migration time).
- **Watchers** (`app/adsb_watch.py`, `app/acars_watch.py`,
  `app/ipaws_watch.py`, `app/lightning_watch.py`): squawk/VIP watch,
  ACARS incidents, FEMA IPAWS backfill, GOES-19 GLM lightning — all on the
  5-min cycle, all alerting through `news_ingest.record_alert`.
  The ACARS watcher is the **nationwide** build (Addendum 3): the seven
  critical categories — mayday, pan-pan, emergency, engine failure, smoke
  on board, fire on board, depressurisation — alert anywhere in the US;
  diversion, medical, minimum fuel, bird strike stay local-only.
- **Blog writer** (`app/news_writer.py` + `app/news_blog.py`): Gemini
  reporter that clusters fresh items, drafts a post, gates it, and stores
  it as `published`/`review` in `news_posts`. One writer pass per 5-min
  cycle; inert without `GEMINI_API_KEY`.
- **HTTP front** (`main.py`, FastAPI): the endpoints below, on
  **127.0.0.1:8120 (loopback only)**. The Node app reaches it via
  `server/providers/sidecar.js` (`SIDECAR_URL`, default
  `http://127.0.0.1:8120`). Never expose the sidecar directly.

## Endpoints

| Method | Path | Source |
|---|---|---|
| GET | `/health` | liveness + DB/store counts + writer state |
| GET | `/api/news/latest?limit=15` | `news_ingest.latest()` |
| GET | `/api/news/status` | `news_ingest.status()` (per-source health) |
| GET | `/api/alerts?limit=10` | `news_ingest.latest_alerts()` |
| GET | `/api/alerts/{incident_key}` | one alert + incident report |
| GET | `/news` | published posts (HTML) |
| GET | `/news/feed.xml` | published posts as RSS 2.0 |
| GET | `/news/{slug}` | one published article (HTML) |
| GET | `/blog` | published posts, Blog category (HTML) |
| GET | `/api/news/review` | posts awaiting human review (JSON) |

## Database

`sidecar/data/cape_dispatch.db` (via `NEWS_DB_FILE`; default is that path).
Created by the migration script:

```
python sidecar/migrate.py --source <path-to-old-cape_dispatch.db>
```

`migrate.py` copies the `news_items` + `news_alerts` tables (the live news
history and alert state) into a fresh sidecar DB and leaves the old DB
untouched; it does NOT copy `aircraft_history` / `feed_history` (archive
only — see HANDOFF-GODSEYE-MIGRATION.md §4). The blog tables
(`news_posts`, `news_post_sources`) are created on first start
(`news_blog.init_posts_db`). The lightning watcher's small state DB lives
at `sidecar/data/lightning_watch.db` (`LIGHTNING_DB_FILE`).

**Never commit the database.** `sidecar/data/` is gitignored. For a local
smoke test, point `NEWS_DB_FILE` at a *copy* of a backup DB, never at the
live Legion DB and never at the pristine backup itself.

## Start it

```powershell
cd sidecar
pip install -r requirements.txt   # needs netCDF4 (lightning watcher)
uvicorn main:app --host 127.0.0.1 --port 8120
```

On Legion it runs as a service (loopback port 8120) with auto-restart;
port 8101 is the FaxSnap API — do not use it. Port 8100 is the old site,
4173 the Node app, 8000 Fire Wire.

## Environment (names only — values via the service env / .env, never in code)

| Name | Purpose |
|---|---|
| `NEWS_DB_FILE` | sidecar SQLite DB (default `sidecar/data/cape_dispatch.db`) |
| `LIGHTNING_DB_FILE` | lightning watcher state (default `sidecar/data/lightning_watch.db`) |
| `GEMINI_API_KEY` | Gemini key for the blog writer; writer inert without it |
| `GEMINI_MODEL` | optional writer model override (default `gemini-3.5-flash-lite`) |
| `GEMINI_MAX_RPM` | shared pool: sustained Gemini calls/min (default 10) |
| `GEMINI_MAX_RPD` | shared pool: max Gemini calls/day, UTC (default 200) |
| `GEMINI_BREAKER_FAILURES` | consecutive 429/503 responses that open the breaker (default 3) |
| `GEMINI_BREAKER_COOLDOWN_S` | breaker cooldown in seconds (default 900) |
| `NEWS_SOURCES_JSON` | optional override of the news source allowlist (JSON) |

## Tests

Offline suite (no network), same tests the old site ran:

```
cd sidecar
python tests/run_tests.py
```

Expected: **177 passed, 5 failed** — the 5 failures are pre-existing and
time-dependent: the Sep-2026 retention fixtures in
`test_news_ingest_offline` (4) and `test_press_ingest_offline` (1) are
older than the 30-day `RETENTION_DAYS` sweep, so the save/dedupe/latest
tests that store them now prune them on save. They fail the same way on
the old site; any *new* failure is a regression. `netCDF4` must be
installed or the 3 lightning tests that build synthetic GLM files fail
too (they are skipped-counted as failures, not passes).
