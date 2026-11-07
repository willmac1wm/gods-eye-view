# Fire Wire ↔ God's Eye View

GEV is Cape Dispatch. Fire Wire is a separate program that feeds it.

## Ownership

| Concern | Owner |
| --- | --- |
| Globe, CCTV panel, RADIO panel, Cape layers, status strip | GEV |
| Station SDR capture, chunk audio, transcription, CAD pins | Fire Wire |
| Broadcastify | **Not used** (kicked off; do not reintroduce) |
| LiveATC audio | GEV Icecast proxy on `/ops/atc` (allowlisted mounts + optional **local** STT); RADIO still refuses raw `liveatc.net`. Aviation keeps optional link-outs. |

## Env

```bash
FIREWIRE_URL=https://your-firewire-api.example
# CAPE_DISPATCH_URL=...   # legacy alias of FIREWIRE_URL
GEV_REGION=cape           # Cape May regional mode (CCTV packs, home camera, …)
CAPE_MANAGER_TOKEN=…      # unlocks /ops/managers (auth-gated)
# FIREWIRE_MANAGER_TOKEN=…  # legacy alias of CAPE_MANAGER_TOKEN
```

Unset or pointed at `capemaydispatch.com` → GEV `/api/cape/*` returns 503.
The old website is retired; do not use it as a default.

Public Cape proxy never forwards `manager` / `admin` / `evidence` paths.
Managers use same-origin `/api/ops/manager/*` with a Bearer token that must
match `CAPE_MANAGER_TOKEN`, then GEV calls Fire Wire `/api/manager/<tool>`.

See `.env.example` for the full commented list (`FIREWIRE_URL`,
`CAPE_MANAGER_TOKEN`, `GEV_REGION=cape`).

## API contract GEV consumes

Same-origin browser paths (proxied):

- `GET /api/cape/radio/feeds`
- `GET /api/cape/radio/live?feed_id=`
- `GET /api/cape/radio/seek` / `buffer`
- `GET /api/cape/audio/...` or `/api/cape/fw-audio/...` (clip bytes)
- `GET /api/cape/cad/incidents|calls|units` (optional `audio_url` on calls)
- `GET /api/cape/board` · optional `social` / `news` / `wire` for `/ops/social`
- Soft Place stubs (empty until Fire Wire publishes): `GET /api/cape/place`,
  `/api/cape/permits`, `/api/cape/code_enforcement` — allowlisted on GEV.
  Place permits prefer native DCA (`/api/ops/permits`); Fire Wire permits are
  an optional overlay. Code enforcement stays honest-empty + portal links
  unless Fire Wire publishes cases (never invent). Anonymized permit demo
  fixtures are **off by default** (`?demo=1` or Managers
  `sources.place.demoFixtures`); demo never invents enforcement rows.
- Plus flood, cameras, NWS, outages, TomTom-via-Cape, etc. while those
  collectors still live on the Fire Wire host
- Auth-gated: `GET /api/ops/manager/{status,summary,queue,review,doctrine,members,…}`
- Managers AI overrides (`ai.briefOverride` / `ai.askOverride` via
  `/api/ops/manager/config`) inject into GEV Voice + Chat + HUD brief paths;
  missing config fails open to stock `instructions.js`

## Radio / SDR audio contract

Fire Wire owns station SDR capture. GEV never restreams Broadcastify.
RADIO refuses raw LiveATC hosts; the ATC desk uses a same-origin Icecast
proxy on allowlisted mounts only. When an SDR transmission lands, GEV expects:

### `GET /api/cape/radio/feeds`

```json
{
  "feeds": [
    {
      "feed_id": "cm-pd-1",
      "agency": "Cape May PD",
      "name": "Dispatch",
      "desc": "Primary dispatch",
      "live": false,
      "has_audio": false,
      "last_heard_at": null,
      "is_primary": true
    }
  ]
}
```

Empty `feeds: []` is healthy → strip / `/ops/scanners` say **quiet · waiting on SDR**.

### `GET /api/cape/radio/live?feed_id=`

When a chunk exists:

```json
{
  "feed_id": "cm-pd-1",
  "chunk": {
    "audio_url": "/fw-audio/cm-pd-1/2026-11-05T23-00-00Z.mp3",
    "started_at": "2026-11-05T23:00:00Z",
    "duration_ms": 4200,
    "transcript": null
  }
}
```

`audio_url` may be:

- same-origin relative `/fw-audio/...` or `/audio/...`
- absolute on the Fire Wire host (`https://<firewire>/fw-audio/...`)
- already proxied `/api/cape/fw-audio/...`

GEV rewrites those onto `/api/cape/...` via `rewriteCapeAudioUrl`
(`src/layers/capeDispatch/audioUrl.js`). Absolute URLs on unknown hosts
(including LiveATC / Broadcastify) are **refused** (empty string).

Fixture sample used by unit tests:
`src/layers/capeDispatch/fixtures/radioLiveChunk.json`.

CAD calls may also carry `audio_url` with the same rewrite rules.

Quiet path (no chunk yet): RADIO panel shows
“Fire Wire has no audio chunk yet (waiting on SDR).” — not a hard failure.

## LiveATC / ATC desk (old Cape Dispatch program)

GEV ports the retired Cape / Fire Wire **Icecast proxy + transcript ingest**:

- `/ops/atc` — VFR/IFR charts, in-page `<audio>` on
  `GET /api/ops/atc/stream?mount=…`, transcript log from
  `GET /api/ops/atc/live`, Managers `ai.atc` alert rules.
- Proxy sends a **fixed desktop Chrome User-Agent** (not rotated) —
  `Mozilla/5.0 … Chrome/131.0.0.0 Safari/537.36` — against allowlisted Icecast
  mounts only: `kacy_a_twr`, `kwwd_twr`, `kmiv_awos` (all on by default;
  Managers `sources.liveatc.mounts`). One upstream Icecast fetch at a time
  (Listen + probe/STT share a mutex). Feeds and health responses are short-TTL
  cached. On upstream **403/429** (or an HTML block page / TLS reset), the
  proxy **stops**, records the exact status/body snippet, backs off ~20
  minutes, and falls back to **external LiveATC link-outs only** — no UA
  rotation, no alternate hosts, no scrape-around.
- **Local transcription only** (on-computer): set `ATC_LIVEATC_INGEST=1` and
  `ATC_WHISPER_CMD` to a local CLI that takes an audio file path and prints
  text to stdout. No OpenAI / cloud Whisper API and no `OPENAI_API_KEY` for
  ATC. Without `ATC_WHISPER_CMD`, ingest probes mounts only (no invented
  text). Offline worker: `tools/atc-liveatc-ingest.mjs` with
  `ATC_GEV_ORIGIN` → `POST /api/ops/atc/ingest`.
- **Same-origin** `/api/ops/atc/*` audio URLs are allowed; raw
  `liveatc.net` hosts remain refused in `audioUrl.js` (RADIO never plays them).
- `/ops/aviation` keeps optional external link-outs (`sources.liveatc.links`).
- Broadcastify remains banned. Public-safety SDR stays on Fire Wire radio.

## Managers → Cesium Cape layers

Managers persist `globe.layers` (`cape-*` ids). After the layer-state
coordinator starts, the globe applies those prefs via
`src/layers/capeDispatch/applyManagerLayers.js`. Share links with `v=2&l=`
win over manager prefs; non-Cape layers are never forced.

## Place permits (NJ DCA)

`GET /api/ops/permits` queries Socrata `data.nj.gov/resource/w9se-dmra.json`
for Cape May County (public domain). Place desk prefers it over demo
fixtures. With `?lat=&lon=` and no block/lot, the handler point-in-parcels via
NJGIN MOD-IV (same cadastral compile as Place) then filters DCA for that
parcel; `?comu=` / county-wide recent remain available. Code enforcement
stays honest-empty + portal links unless Fire Wire publishes
`/api/cape/code_enforcement` — never invent violations.

## SDR ingest (when radios arrive)

Fire Wire (not GEV browser WebUSB) should:

1. Capture county public-safety channels on station SDRs.
2. Segment transmissions into chunks.
3. Transcribe and classify.
4. Emit CAD incidents/calls with location (and optional `audio_url`).
5. Serve chunks on the radio/audio APIs above.

GEV already opens RADIO for feed pins / CAD clips and draws CAD pins. No GEV
redesign is required when SDR audio starts flowing — only Fire Wire ingest.

Until then, empty feeds are healthy: strip/layers show `quiet` / waiting on SDR.

## Intel acoustics media

KMZ/KML parse is native on `/ops/intel`. TDOA / Doppler need multi-receiver
Fire Wire audio (same `radio/live` + `fw-audio` contract). Until those media
routes publish usable chunks, the Intel desk shows **blocked-on-media** and
keeps the health strip honest. Do not invent acoustic results.

## Cutover runbook (prod)

Operators run this outside the cloud agent VM — **DNS / secrets cannot be set
from CI agents**.

### 1. Fire Wire host + env

1. Deploy / confirm Fire Wire API is reachable on a dedicated host (not the
   retired Leaflet site).
2. On the GEV production deploy set:
   - `FIREWIRE_URL=https://<firewire-api-host>` (no trailing slash)
   - `GEV_REGION=cape`
   - `CAPE_MANAGER_TOKEN=<long random>` (and optionally mirror as
     `FIREWIRE_MANAGER_TOKEN` on Fire Wire)
3. Restart GEV so Vite/server middleware picks up env.
4. Confirm `GET /api/cape/health/sources` is **not** 503
   (`firewire_unconfigured` / `cape_website_retired`).

### 2. Smoke checklist

| Check | Expect |
| --- | --- |
| Ferry / Cape CCTV | Globe CCTV panel plays Cape catalog stills/streams |
| `/ops/cameras` | Directory loads; pins hand off to CCTV |
| CAD / RADIO quiet | `/ops/incidents` + `/ops/scanners` show quiet / waiting on SDR (not 502 spam) |
| RADIO open on idle feed | Panel message: waiting on SDR (no Broadcastify) |
| Ops desks | `/ops/`, Place, Flood, Board, Aviation, Whales, Managers load 200 |
| Managers unlock | Bearer `CAPE_MANAGER_TOKEN` → config save + Fire Wire review proxy |
| Whales share | `/?v=2&l=0c` enables `cape-whales` |
| LiveATC | `/ops/atc` Icecast proxy (+ local `ATC_WHISPER_CMD` STT); Aviation link-outs optional |

### 3. DNS retire `capemaydispatch.com`

1. Point the public Cape May Dispatch hostname (A/AAAA or CNAME) at the GEV
   front door (or a redirector that 301s to GEV).
2. Keep Fire Wire API on its **own** hostname — do not reuse the old site
   origin as `FIREWIRE_URL`.
3. Take the old Leaflet board offline once GEV smoke passes.
4. Remove any CDN / Page Rules that still serve the retired static board.
5. Update operator bookmarks: globe `/`, ops `/ops/`, managers `/ops/managers`.

### 4. Post-cutover

- Station SDR → Fire Wire chunk pipeline → scanners / CAD `audio_url` go live
  without further GEV redesign.
- Airband ingest (when built) replaces LiveATC link-outs; keep the ToS guard
  until then.
- Place permits use native DCA (`/api/ops/permits`); Fire Wire
  `code_enforcement` remains optional when published. Demo fixtures are no
  longer the default Place path.

## Retiring capemaydispatch.com (summary)

1. Deploy GEV as the public Cape Dispatch product (`GEV_REGION=cape`).
2. Set `FIREWIRE_URL` on that deploy to the Fire Wire API (not the old site).
3. Point the Cape May Dispatch domain (or a redirect) at GEV.
4. Take the old Leaflet board offline. Keep Fire Wire API online.

Collectors that still lived on the old monolith (flood, NWS scrape, outages,
board, camera JSON, TomTom-via-Cape) move onto the Fire Wire host or onto
native GEV providers over time. See `nativeFallback.js` for the operator map
while Fire Wire is offline.
