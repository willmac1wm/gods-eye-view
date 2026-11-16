# Cape layers: old-backend repoint list (cape-repoint branch — finished)

Ground truth: live read-only probes 2026-11-16 — Fire Wire `:8000` and the
old app `:8100` on Legion, plus code reads in this branch. The staging cape
proxy points at Fire Wire (`FIREWIRE_URL=http://127.0.0.1:8000`), and **Fire
Wire serves none of the `/api/*` paths the cape proxy forwards** (its API is
`/api/snapshot`, `/api/incidents`, `/api/transmissions`, `/api/traffic`,
`/api/weather`, `/api/marine`, `/api/fires`, `/api/flights`, `/api/sources`,
`/api/stream`, `/api/poll-status`, `/audio/{filename}` — see its
`/openapi.json`). So every cape layer below that read `/api/cape/*` was
already 404ing in staging before this work; the repoints here are the
fix path, not a regression.

Verdicts: **repointed** (done here) · **native** (already native, no change)
· **dropped** (source no longer exists natively; reason recorded) ·
**remaining** (still reads the old backend; exact file + upstream + why).

## Repointed in this branch

| Layer / surface | Before | After |
|---|---|---|
| `cape-nws` | `src/layers/capeDispatch/layers.js` loader read `/api/cape/hazards` + `/api/cape/feeds` (old app `:8100`) | Native provider `server/providers/nws.js` — `api.weather.gov/alerts/active?zone=NJZ023,NJZ024`, same zones the old source used; payload keeps the `mapNws()` shape. The old `/api/feeds` pins (Waze / USGS / NJ511) have no direct public equivalent and are dropped with the old backend. (Same provider as merged PR #17; see merge note below.) |
| `cape-tomtom` | `/api/cape/tomtom/status` + `tomtom/traffic` (old app) | Native TomTom Incidents API — `server/providers/traffic.js` (`/api/tomtom/status` + `/api/tomtom/incidents`, `TOMTOM_API_KEY` already exists) |
| `cape-buoys` | `/api/cape/buoys` (old app, module `buoys.py`) | Native NDBC provider `server/providers/ndbc.js` (NOAA `realtime2` text files, stations 44009 + CMAN4 — filename is uppercase, `cman4.txt` 404s) |
| `cape-airports` | `/api/cape/airport_wx` (old app) | Native aviation-weather provider `server/providers/aviationWx.js` (aviationweather.gov METAR/TAF + FAA flight categories) |
| `cape-tfrs` | `/api/cape/aviation/tfrs` (old app, 82 KB cached GeoJSON) | Native FAA provider `server/providers/tfrs.js` (live list + AIXM detail parse, not the cached file) |
| `cape-wind` | `/api/cape/wx/wind` (old app, module `wx_layers`) | Native NWS observations provider `server/providers/nwsWind.js` (api.weather.gov stations KWWD / KACY / KMIV / KOBI) |
| `cape-cameras` | `/api/cape/traffic_cameras` + `intel/nj511_cameras` + `fx/cameras` (all old app) | Per-source native providers: DelDOT TMC (`server/providers/deldot.js`, + ArcGIS fallback + ferry/bridge seed), NJ511 (`server/providers/nj511.js`, key-gated — see below), Windy (`server/providers/windy.js`, key-gated). The old fx leg (DelDOT + Windy snapshots) is composed from the same two payloads. |
| `cape-webcams` | `/api/cape/webcams` (old app), bundled `CAPE_PUBLIC_WEBCAMS` fallback | Windy provider (`/api/windy-webcams`) + the public ferry fallback as the source; the old list was the ferry cameras (bundled identically) plus Windy |
| `cape-cad` | `/api/cape/cad/{incidents,units,calls}` (old app — 200 with 30 bytes, nearly empty demo fixtures) | **New** Fire Wire integration, not a repoint: `server/providers/firewireCad.js` maps Fire Wire `/api/incidents` to `mapCad()`'s shape. The units/calls legs have no Fire Wire equivalent and are dropped. |
| `cape-radio` | `/api/cape/radio/feeds` (old app) | Fire Wire radio provider `server/providers/firewireRadio.js`: the curated 8-feed table plus liveness from Fire Wire `/api/snapshot` `audio_feeds` (180 s chunk window). `/ops/atc` (LiveATC listening) is untouched. Known gap: per-feed chunk playback has no Fire Wire mapping yet (transmissions carry no audio URLs; the old `/api/radio/buffer\|seek\|live` served disk chunks) — feeds show live/idle state and the RADIO panel stays quiet until that mapping lands. |
| `cape-flood` (gauges) | `/api/ops/flood` native-first, `/api/cape/flood_gauges` + `flood_map/plan` fallback | Native only: `/api/ops/flood` (`server/providers/ops/floodNative.js`). The fallback is dropped — after cutover it would 404 forever, and the native path is now real (see the parser fix below). Coverage change: the old 14-gauge NWS set becomes 3 gauges (CO-OPS 8536110 Cape May Harbor, NWPS ACYN4 Atlantic City, NWPS BRNN4 — the last 404s in NWPS v1 and stays null-tolerant). |
| `cape-flood` (raster) | `/api/cape/flood_map/tile/{z}/{x}/{y}.png` (old app) | **Built, not dropped:** native provider `server/providers/floodTiles.js` — NOAA Sea Level Rise Viewer tiles (public, no key) differenced level-vs-0 ft with a dependency-free PNG codec (`server/providers/common/png.js`; sharp is dev-only). Level from the native flood payload (nearest gauge, forecast peak above MHHW, gated on the minor flood stage — the old `anchors()` rule). Layer init URL is now `/api/flood-tiles/{z}/{x}/{y}.png`. |
| `cape-outages` | `/api/ops/outages` native-first, `/api/cape/power_outages` fallback | Native only: `/api/ops/outages` (`server/providers/ops/outagesNative.js`, ArcGIS county payload, verified live in merged PR #17). Known limitation: the ArcGIS layer carries customers-out but not customers-served, so the strip County line shows `power out/0` until a served figure has a source. |
| Status strip — Tide | `/api/cape/floodwatch` (old app, CO-OPS 8536110) | `/api/ops/flood/watch` (native; CO-OPS 8536110 again, plus `next_high_tide` from CO-OPS predictions) |
| Status strip — Flood map | `/api/cape/flood_map/plan` + `flood_gauges` | `/api/ops/flood` (native `plan` + `gauges`) |
| Status strip — NWS | `/api/cape/hazards` | `/api/nws` (native) |
| Status strip — Storm | `/api/cape/storm_status` (old app; was just NWS-alert text) | `/api/nws` (native alerts count) |
| Status strip — County | `/api/cape/county-status` (old app) | `/api/ops/county` — new native provider `server/providers/ops/countyNative.js`, a port of the old app's `county_status.py` (SRF rip current, native floodwatch tide, native outages power, Fire Wire call counts). Drops the old payload's `alerts`/`chips` fields, which no surface read. |
| Status strip — Outages | `/api/cape/power_outages` | `/api/ops/outages` (native) |
| Status strip — Radio | `/api/cape/radio/feeds` | `/api/firewire-radio` (same feed shape) |
| Status strip — Board | `/api/cape/board` | `/api/ops/board` (native aggregator; `official` + `flash_rumors`) |
| Status strip — CAD | `/api/cape/cad/{calls,incidents,units}` | `/api/firewire-cad` (`mapCad({ incidents })`) |
| Status strip — TomTom | `/api/cape/tomtom/status` + `tomtom/traffic` | `/api/tomtom/status` + `/api/tomtom/incidents` |
| Status strip — Marine & WX | `/api/cape/wx/status` + `wx/wind` + `buoys` + `airport_wx` | `/api/cyclones` (tropical count) + `/api/nws-wind` + `/api/ndbc` + `/api/airport-wx` |
| Board desk (`src/ops/board.js`) | Native `/api/ops/board` + `/api/ops/outages`, cape fallbacks `capeGet('board' \| 'county-status' \| 'power_outages')` | Native only: `/api/ops/board` + `/api/ops/outages` + `/api/ops/county`. The fallbacks are dropped — all three native paths are live-verified (board + outages in merged PR #17, county in this branch). |
| Native flood parser | `server/providers/ops/floodNative.js` read a NWPS shape the API never returns (`status.primary.value`), so **every gauge came back null**; CMHN4/BRNN4 404 in NWPS v1 | Parser fixed to the live payload (`status.observed.primary` / `status.forecast.primary` numbers, `flood.categories.*.stage`); Cape May Harbor now comes from CO-OPS 8536110 (water_level + predictions hilo for `next_high_tide`, 1 h trend). Tests use trimmed live payloads. |

## Dropped with reasons (no native source; not silent)

| Surface | Why it goes |
|---|---|
| Status strip — SAR (`sar/flood`) | Sentinel-1 flood detection needs Copernicus Data Space OAuth (`CDSE_CLIENT_ID` / `CDSE_CLIENT_SECRET`) + a SAR processing pipeline (old `sar_flood.py`, ~300 lines, median filter + baseline passes + Processing Unit requests). No free public equivalent is wired. Flood situational awareness continues via NWPS/CO-OPS gauges, the flood raster, and NWS alerts. The `/ops/flood` desk still shows its SAR panel from the cape fallback — that desk is the remaining reader (see below). |
| Status strip — Storms (`storms`, storm archive) | The archive is derived from the old app's disk store (`storm_archive/`, CO-OPS tide history + Sentinel-1 passes, per `storms.py`): it is data the old app accumulated, not a feed that can be repointed. Rebuilding it natively needs the same Copernicus pipeline as SAR plus a multi-year tide-history build. The live flood gauges + flood raster cover current flooding; the historical archive does not move. |

## Already native (no change)

| Layer / surface | Upstream now |
|---|---|
| `cape-whales` | `/api/ops/whales` — native |
| `/api/ops/board` | Native `server/providers/ops/boardNative.js` (NWS + flood + outages + messages) |

> **Pre-existing bug, fixed on main by merged PR #17:** the
> native board/flood/outages/permits handlers called the same-site gate
> inverted — `if (!admitSameSiteKeyless(req, res)) return;` — in
> `boardNative.js:120`, `floodNative.js:152`, `outagesNative.js:115`,
> `permitsNative.js:195`. Admitted loopback requests returned with **no
> response** (hung until client timeout) while refused cross-site requests
> proceeded. The fix removes the `!` in those four lines; regression test
> `server/providers/ops/nativeGate.test.mjs` (4 tests) fails 4/4 with the
> bug and passes 4/4 with the fix. This branch originally carried the
> same fix as its own commit; the rebase onto post-#17 main dropped
> the duplicate.

## Remaining — still reads the old backend

| Surface | Current upstream (file) | What it needs |
|---|---|---|
| `/ops/flood` desk (`src/ops/flood.js`) | Native-first for watch/gauges/plan (`/api/ops/flood`), cape fallbacks `floodwatch` / `flood_gauges` / `flood_map/plan`, cape-only `storms` + `sar/flood` | Drop the three cape fallbacks now that the native path is real; the storms + SAR panels need the product decision recorded above (no native source) |
| `/ops/aviation` desk (`src/ops/aviation.js`) | `capeGet('aviation/tfrs')`, `capeGet('airport_wx')`, `capeGet('air')` | Repoint at the native providers built here (`/api/tfrs`, `/api/airport-wx`); `air` (aircraft details/photo) has no native endpoint yet |
| `/ops/cameras` desk (`src/ops/cameras.js`) | `capeGet('webcams')`, `capeGet('traffic_cameras')`, `capeGet('fx/cameras')`, `capeGet('intel/nj511_cameras')` | Repoint at the per-source providers built here (`/api/deldot-cameras`, `/api/nj511`, `/api/windy-webcams`) |
| `/ops/scanners` desk (`src/ops/scanners.js`) | `capeGet('radio/feeds')` | Repoint at `/api/firewire-radio` (same feed shape as the strip) |
| `/ops/incidents` desk (`src/ops/incidents.js`) | `capeGet('cad/incidents')`, `capeGet('cad/calls')`, `capeGet('cad/units')` | Repoint at `/api/firewire-cad` (incidents only; units/calls have no Fire Wire equivalent) |
| `/ops/place` desk (`src/ops/place.js`) | `capeGet('place')`, `capeGet('permits')`, `capeGet('code_enforcement')` | Place/permits are soft Fire Wire reads (empty until Fire Wire publishes them); `permits` already has a native provider (`/api/ops/permits`) |
| News / alerts / `/ops/social` | Merged PR #17 — the Python sidecar on `127.0.0.1:8120` + `server/providers/sidecar.js` serves `/api/ops/social?kind=news`, `/news`, `/blog`, `/api/alerts` | No longer a remaining item (was PR #17 before it merged) |
| NJ511 | `server/providers/nj511.js` is built and key-gated (answers 200 `{ configured: false }` without a key), but its endpoint shape is **unverified** — the old environment's network policy blocked reaching 511nj.org, and the module assumes the Iteris `GetCameras`/`GetEvents` convention from 511NY/511GA | William must supply `NJ511_API_KEY` (free developer key from 511NJ); verify the endpoint + field names against a real key before trusting it |
| Flood raster tile cache | In-memory only (per process) | The old app cached tiles on disk (90-day NOAA tiles, permanent diffs); a disk cache returns if tile latency shows up in staging |

## Allow-list (`server/providers/cape.js` `CAPE_ALLOW`)

Removed in this branch — only entries this branch's repoints made dead,
each confirmed to have zero remaining readers in this branch:
`hazards`, `storm_status`, `county-status`, `power_outages`, `board`,
`wx/status`, `wx/wind`, `flood_map/tile/{z}/{x}/{y}.png`.
`storms` stays listed: the `/ops/flood` desk still reads it (see Remaining).
Still listed because other desks still read them (see Remaining above):
`floodwatch`, `flood_gauges`, `flood_map/plan`, `flood_map/streets`,
`storms`, `sar/flood`, `radio/feeds`, `airport_wx`, `aviation/tfrs`,
`traffic_cameras`, `webcams`, `fx/cameras`, `intel/nj511_cameras`,
`cad/*`, `tomtom/*`, `feeds`, `air`, `aircraft/*`.
Do **not** point `FIREWIRE_URL` at the old app to "fix" them — that
re-couples staging to the retired backend. Remove the dead allow-list
entries at cutover.

## Notes

- The freshness gate (`checkCapeSourceFresh`, `src/layers/capeDispatch/client.js`)
  fails **open** when `/api/cape/health/sources` is absent, so repointed and
  native-first layers are not gated by the old health endpoint. The strip
  no longer uses the gate at all — every section reads a native/sidecar
  source or is dropped above.
- Merge note vs merged PR #17 (`feature/sidecar-port`, now on main): this
  branch's gate-fix commit was dropped in the rebase (byte-identical to
  the merged `ac6f6f06`), and the NWS provider is main's copy with this
  branch's test coverage folded in (the event-less-drop test). The
  remaining merge question is PR #18 (`feature/missing-layers`) vs this
  branch — clean both ways (verified by `git merge-tree` against the
  current tips).
- Nothing in this branch touches the live Legion services, DNS, or the
  `GodsEyeView` staging service. Staging verification of the repointed
  paths needs the sidecar running on Legion (loopback 8120) first for the
  news surfaces, and the native providers need no keys except the ones
  already named (`TOMTOM_API_KEY`, `NJ511_API_KEY`).
