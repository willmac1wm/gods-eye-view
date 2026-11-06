# Fire Wire ↔ God's Eye View

GEV is Cape Dispatch. **Fire Wire lives in-app** as a quiet store under
`/api/cape/*` (CAD / radio / review-shaped APIs). There is **no separate Fire
Wire host requirement**, **no `FIREWIRE_URL`**, and **no
`503 firewire_unconfigured`**. Optional `FIREWIRE_URL` remains only as a
legacy upstream override if an operator still points at an external API.

## Ownership

| Concern | Owner |
| --- | --- |
| Globe, CCTV panel, RADIO panel, Cape layers, status strip | GEV |
| In-app Fire Wire quiet store (`/api/cape/*`) | GEV |
| Station SDR capture, chunk audio, transcription, CAD pins | Future in-app ingest (quiet until real data) |
| Broadcastify | **Not used** (kicked off; do not reintroduce) |
| LiveATC audio | GEV Icecast proxy on `/ops/atc` (allowlisted mounts + optional **local** STT); RADIO still refuses raw `liveatc.net`. Aviation keeps optional link-outs. |
| Managers desk | GEV `/ops/managers` — **ungated** (no `CAPE_MANAGER_TOKEN`) |

## Env

```bash
GEV_REGION=cape           # Cape May regional mode (CCTV packs, home camera, …)
# Optional legacy override only — not required for Cape desks to work:
# FIREWIRE_URL=https://optional-external-api.example
```

Unset `FIREWIRE_URL` → `/api/cape/*` returns **200** empty-tolerant JSON from
the in-app quiet store (`X-Cape-Mode: inapp-quiet`). CAD/radio show
**quiet · waiting on SDR**, never invent sample data.

Managers config (`GET`/`PUT` `/api/ops/manager/config`) is same-site and
ungated. Session (`/api/ops/manager/session`) always reports
`configured` + `authenticated` with `mode: "inapp"`. Manager tool paths
return quiet stubs until real review ingest exists.

See `.env.example` for ATC local STT (`ATC_LIVEATC_INGEST`, `ATC_WHISPER_CMD`).

## API contract GEV consumes

Same-origin browser paths:

- `GET /api/cape/radio/feeds`
- `GET /api/cape/radio/live?feed_id=`
- `GET /api/cape/radio/seek` / `buffer`
- `GET /api/cape/audio/...` or `/api/cape/fw-audio/...` (clip bytes — 404 quiet until SDR)
- `GET /api/cape/cad/incidents|calls|units` (optional `audio_url` on calls)
- `GET /api/cape/board` · optional `social` / `news` / `wire` for `/ops/social`
- Soft Place stubs: `GET /api/cape/place`, `/api/cape/permits`,
  `/api/cape/code_enforcement` — quiet until published. Place permits prefer
  native DCA (`/api/ops/permits`).
- Plus flood, cameras, NWS, outages, etc. — quiet stubs prefer native GEV
  collectors where they exist (`nativeFallback.js`)
- Managers: `GET /api/ops/manager/{status,summary,queue,review,doctrine,members,…}`
  (in-app stubs) · config via `/api/ops/manager/config`
- Managers AI overrides (`ai.briefOverride` / `ai.askOverride`) inject into
  GEV Voice + Chat + HUD brief paths; missing config **fails open** to stock
  `instructions.js`

## Radio / SDR audio contract

GEV never restreams Broadcastify. RADIO refuses raw LiveATC hosts; the ATC
desk uses a same-origin Icecast proxy on allowlisted mounts only. When an SDR
transmission lands in-app, GEV expects:

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

Quiet mode returns `chunk: null`.

## LiveATC / ATC desk (old Cape Dispatch program)

GEV ports the retired Cape / Fire Wire **Icecast proxy + transcript ingest**:

- `/ops/atc` — VFR/IFR charts, in-page `<audio>` on
  `GET /api/ops/atc/stream?mount=…`, transcript log from
  `GET /api/ops/atc/live`, Managers `ai.atc` alert rules.
- Proxy sends a **fixed desktop Chrome User-Agent** (not rotated) —
  `Mozilla/5.0 … Chrome/131.0.0.0 Safari/537.36` — against allowlisted Icecast
  mounts only: `kacy_a_twr`, `kwwd_twr`, `kmiv_awos` (all on by default;
  Managers `sources.liveatc.mounts`). One upstream Icecast fetch at a time
  (Listen + probe/STT share a mutex). On upstream **403/429** (or TLS reset),
  the proxy **stops**, backs off ~20 minutes, and falls back to **external
  LiveATC link-outs only** — no UA rotation.
- **Local transcription only** (on-computer): set `ATC_LIVEATC_INGEST=1` and
  `ATC_WHISPER_CMD` to a local CLI. No OpenAI / cloud Whisper for ATC.
  Offline worker: `tools/atc-liveatc-ingest.mjs` (no manager token).
- **Same-origin** `/api/ops/atc/*` audio URLs are allowed; raw `liveatc.net`
  hosts remain refused in `audioUrl.js`.
- `/ops/aviation` keeps optional external link-outs (`sources.liveatc.links`).
- Broadcastify remains banned. Public-safety SDR stays on in-app Fire Wire radio.

## Managers → Cesium Cape layers

Managers persist `globe.layers` (`cape-*` ids). After the layer-state
coordinator starts, the globe applies those prefs via
`src/layers/capeDispatch/applyManagerLayers.js`. Share links with `v=2&l=`
win over manager prefs; non-Cape layers are never forced.

## Place permits (NJ DCA)

`GET /api/ops/permits` queries Socrata `data.nj.gov/resource/w9se-dmra.json`
for Cape May County (public domain). Place desk prefers it over demo
fixtures. With `?lat=&lon=` and no block/lot, the handler point-in-parcels via
native GIS when available.

## Intel / acoustic

KMZ/KML parse is native on `/ops/intel`. TDOA / Doppler need multi-receiver
audio (same `radio/live` + `fw-audio` contract). Until those media routes
publish usable chunks, the Intel desk shows **blocked-on-media**.

## Smoke checklist (local / staging)

| Check | Expect |
| --- | --- |
| `/api/cape/radio/feeds` | 200 `{ feeds: [] }` without `FIREWIRE_URL` |
| `/api/cape/cad/incidents` | 200 empty incidents (not 503) |
| CAD / RADIO quiet | `/ops/incidents` + `/ops/scanners` show quiet / waiting on SDR |
| Ops desks | `/ops/`, Place, Flood, Board, Aviation, Whales, Managers load 200 |
| Managers | Config save works with no token; tools return in-app stubs |
| LiveATC | `/ops/atc` Icecast proxy (+ local `ATC_WHISPER_CMD` STT) |
| Whales share | `/?v=2&l=0c` enables `cape-whales` |

## Hold (do not do without William approval)

- Staging publish with sample CAD/radio data
- DNS / Legion cutover
- OpenAI / paid STT for ATC
- Flood estimator / SDR hardware bring-up

## Retiring capemaydispatch.com

1. Deploy GEV as the public Cape Dispatch product (`GEV_REGION=cape`).
2. Point the Cape May Dispatch domain (or a redirect) at GEV.
3. Take the old Leaflet board offline.
4. Do **not** require a separate Fire Wire API host for Cape desks to work.

Collectors migrate onto native GEV providers / in-app Fire Wire ingest over
time. See `nativeFallback.js` for the operator map.
