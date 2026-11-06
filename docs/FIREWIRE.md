# Fire Wire ↔ God's Eye View

GEV is Cape Dispatch. Fire Wire is a separate program that feeds it.

## Ownership

| Concern | Owner |
| --- | --- |
| Globe, CCTV panel, RADIO panel, Cape layers, status strip | GEV |
| Station SDR capture, chunk audio, transcription, CAD pins | Fire Wire |
| Broadcastify | **Not used** (kicked off; do not reintroduce) |

## Env

```bash
FIREWIRE_URL=https://your-firewire-api.example
# CAPE_DISPATCH_URL=...   # legacy alias of FIREWIRE_URL
```

Unset or pointed at `capemaydispatch.com` → GEV `/api/cape/*` returns 503.
The old website is retired; do not use it as a default.

## API contract GEV consumes

Same-origin browser paths (proxied):

- `GET /api/cape/radio/feeds`
- `GET /api/cape/radio/live?feed_id=`
- `GET /api/cape/radio/seek` / `buffer`
- `GET /api/cape/audio/...` or `/api/cape/fw-audio/...` (clip bytes)
- `GET /api/cape/cad/incidents|calls|units` (optional `audio_url` on calls)
- Plus board, flood, cameras, NWS, outages, TomTom-via-Cape, etc. while those
  collectors still live on the Fire Wire host

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

## Retiring capemaydispatch.com

1. Deploy GEV as the public Cape Dispatch product (`GEV_REGION=cape`).
2. Set `FIREWIRE_URL` on that deploy to the Fire Wire API (not the old site).
3. Point the Cape May Dispatch domain (or a redirect) at GEV.
4. Take the old Leaflet board offline. Keep Fire Wire API online.

Collectors that still lived on the old monolith (flood, NWS scrape, outages,
board, camera JSON, TomTom-via-Cape) move onto the Fire Wire host or onto
native GEV providers over time. See `nativeFallback.js` for the operator map
while Fire Wire is offline.
