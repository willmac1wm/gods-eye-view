# Cape layers: old-backend repoint list (sidecar-port branch)

Ground truth: live read-only probe 2026-11-16 — Fire Wire `:8000` and the old
app `:8100` on Legion, plus code reads in this branch. The staging cape
proxy points at Fire Wire (`FIREWIRE_URL=http://127.0.0.1:8000`), and **Fire
Wire serves none of the `/api/*` paths the cape proxy forwards** (its API is
`/api/snapshot`, `/api/incidents`, `/api/transmissions`, `/api/traffic`,
`/api/weather`, `/api/marine`, `/api/fires`, `/api/flights`, `/api/sources`,
`/api/stream`, `/api/poll-status`, `/audio/{filename}` — see its
`/openapi.json`). So every cape layer below that reads `/api/cape/*` was
already 404ing in staging before this branch; the repoints here are the
fix path, not a regression.

Verdicts: **repointed** (done here) · **native** (already native, no change)
· **remaining** (still reads the old backend; exact file + upstream + why).

## Repointed in this branch

| Layer / surface | Before | After |
|---|---|---|
| `/ops/news` desk + `/api/ops/social?kind=news` | Cape upstream `/api/news` — 404 on Fire Wire `:8000` **and** on the old app `:8100` (the old app's news lives at `/api/news/latest`, not `/api/news`); the desk was already serving nothing | Sidecar `/api/news/latest?limit=50` — `server/providers/ops/social.js` `fetchSidecarNews()`; items mapped to the social shape (`pub_ms` → `at`), `sources.sidecar` reported. Board/social/wire still come from the cape upstream (all 404 on Fire Wire today — pre-existing, desk degrades to sidecar news only) |
| `/news`, `/news/{slug}`, `/news/feed.xml`, `/blog` | Did not exist in the new app | Sidecar via `server/providers/sidecar.js` (`/api/news/*`, `/api/alerts/*`, `/news`, `/blog` mounts; `SIDECAR_URL`, default `http://127.0.0.1:8120`) |
| `/api/alerts` | Did not exist in the new app (old app `/api/alerts` only) | Sidecar `/api/alerts` via the same proxy |
| `cape-nws` | `src/layers/capeDispatch/layers.js` loader read `/api/cape/hazards` + `/api/cape/feeds` (old app `:8100`) | Native provider `server/providers/nws.js` — `api.weather.gov/alerts/active?zone=NJZ023,NJZ024`, same zones the old source used; payload keeps the `mapNws()` shape (`{nws_alerts: [{id, event, headline, area, severity, geometry}], feeds: {}}`). Loader now fetches `/api/nws` via `fetchOpsJson`. The old `/api/feeds` pins (Waze / USGS / NJ511) have no direct public equivalent here and are dropped with the old backend. The status strip's NWS section (`src/layers/capeDispatch/index.js`) is repointed the same way |

## Already native (no change)

| Layer / surface | Upstream now |
|---|---|
| `cape-flood` | Prefers `/api/ops/flood` — native `server/providers/ops/floodNative.js` (`api.water.noaa.gov` NWPS gauges). Cape `flood_gauges` / `flood_map` fallback still old-backend (see remaining) |
| `cape-outages` | Prefers `/api/ops/outages` — native `server/providers/ops/outagesNative.js`. Cape `power_outages` fallback still old-backend (see remaining) |
| `cape-whales` | `/api/ops/whales` — native |
| `/api/ops/board` | Native `server/providers/ops/boardNative.js` (NWS + flood + outages + messages). Client fallbacks `capeGet('board' | 'county-status' | 'power_outages')` in `src/ops/board.js` still old-backend (see remaining) |

## Remaining — still reads the old backend

| Layer | Current upstream (file) | Direct source / what it needs |
|---|---|---|
| `cape-tomtom` | `/api/cape/tomtom/status` + `tomtom/traffic` (old app `:8100`) — `src/layers/capeDispatch/layers.js` `LOADERS['cape-tomtom']` | Native `/api/tomtom` serves flow tiles + status only, no incidents list. Needs a TomTom Traffic Incidents API provider (`TOMTOM_API_KEY` already exists) + loader change |
| `cape-buoys` | `/api/cape/buoys` (old app `:8100`, module `buoys.py`) | NOAA NDBC `realtime2` text files, stations 44009 (Delaware Bay) + CMAN4 (Cape May Point — filename is uppercase, `cman4.txt` 404s). Needs a Node NDBC provider (fetch + header-driven column parse) or a sidecar `/api/buoys` endpoint |
| `cape-airports` | `/api/cape/airport_wx` (old app `:8100`, module `airport_wx.py`) | aviationweather.gov Data API (METAR/TAF) + FAA flight-category computation (LIFR/IFR/MVFR from ceiling/visibility). Needs a Node provider porting that computation |
| `cape-tfrs` | `/api/cape/aviation/tfrs` (old app `:8100`, 82 KB payload) | FAA TFR data (old site caches `tfrs_cache.geojson`). Needs a Node provider or a sidecar endpoint serving the cached GeoJSON |
| `cape-wind` | `/api/cape/wx/wind` (old app `:8100`, module `wx_layers`) | Unclear from this branch — trace `wx_layers` on the old site first (NWS/NDBC wind observations) before choosing a provider |
| `cape-cameras` | `/api/cape/traffic_cameras` + `intel/nj511_cameras` + `fx/cameras` (all old app `:8100`) | Per-source providers; NJ511 cameras need `NJ511_API_KEY` (key decision) |
| `cape-webcams` | `/api/cape/webcams` (old app `:8100`), bundled `CAPE_PUBLIC_WEBCAMS` fallback works today | Needs a provider for the old webcams list, or accept the public fallback as the source |
| `cape-cad` | `/api/cape/cad/{incidents,units,calls}` (old app `:8100` — returns 200 with 30 bytes, nearly empty) | True upstream is Fire Wire, but Fire Wire has no `/api/cad/*` routes; it has `/api/incidents`, `/api/transmissions`, `/api/snapshot` (status only). Needs a **new** Fire Wire incidents provider mapping `/api/incidents` to `mapCad()`'s shape — a new integration, not a repoint |
| `cape-radio` | `/api/cape/radio/feeds` (old app `:8100`) | True upstream is Fire Wire audio (`/api/stream`, `/api/transmissions`, `/audio/{filename}`). Needs a Fire Wire radio provider; `/ops/atc` already handles LiveATC listening separately |
| `cape-flood` raster fallback | `/api/cape/flood_map/tile/{z}/{x}/{y}.png` + `flood_map/plan` (old app `:8100`) — `layers.js` `createCapeFeedLayer` init | Flood raster tiles are generated by the old app; the native flood path (NWPS gauges) has no raster. Needs a raster source decision at cutover |
| `cape-outages` fallback + board-desk fallbacks | `/api/cape/power_outages`, `capeGet('board' | 'county-status' | 'power_outages')` — `src/ops/board.js` | Drop the fallbacks once the native paths are proven in staging, or keep them as degraded fallbacks until cutover |

## Status strip (`src/layers/capeDispatch/index.js`)

The strip's **NWS** section is repointed with the layer: it now reads the
native `/api/nws` provider instead of the old app's `/api/hazards`, and is
no longer gated on the old health endpoint. The strip's other sections
still read `/api/cape/*` (old backend) and are remaining work: Tide
(`floodwatch`), Flood map (`flood_map/plan`, `flood_gauges`), Storm
(`storm_status`), County (`county-status`), Outages (`power_outages`),
Radio (`radio/feeds`), board (`board`), SAR (`sar/flood`), storms
(`storms`).

## Notes

- The freshness gate (`checkCapeSourceFresh`, `src/layers/capeDispatch/client.js`)
  fails **open** when `/api/cape/health/sources` is absent, so repointed and
  native-first layers are not gated by the old health endpoint. Layers still
  on the gate (`cape-tomtom`, `cape-cameras`) also fail open — they attempt
  the cape fetch and surface the 404 as an error state.
- `server/providers/cape.js` `CAPE_ALLOW` still lists old-app-only paths
  (`news`, `board`, `hazards`, `airport_wx`, `buoys`, …). Left in place:
  the proxy still serves the Fire Wire paths that exist (`/audio/*`), and
  the allow-list is the gate, not the data. Do **not** point `FIREWIRE_URL`
  at the old app to "fix" them — that re-couples staging to the retired
  backend. Remove the dead allow-list entries at cutover.
- Nothing in this branch touches the live Legion services, DNS, or the
  `GodsEyeView` staging service. Staging verification of the repointed
  paths needs the sidecar running on Legion (loopback 8120) first.
