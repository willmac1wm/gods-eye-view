# Putting Cape May Dispatch on the public web

This note is for the person running the home server. It lists what was unsafe, what the code does now, and the exact settings to use before capemaydispatch.com points at this app.

The app used to be a private Vite development server. A Cloudflare Tunnel makes every visitor look like they are on the same computer (`127.0.0.1`). That is safe only after the changes below, and only if the service runs the production command rather than `vite`.

## Start command for NSSM

Build once (repeat after you pull updates):

```
npm run build
```

NSSM application:

- Path: `node` (or `C:\Program Files\nodejs\node.exe`)
- Arguments: `server/prod.mjs`
- Startup directory: the folder that contains `package.json`

Do not use `vite`, `npm run dev`, or `vite --host 0.0.0.0 --port 4173` for the public service. Those expose the development server (live reload and source files).

`server/prod.mjs` forces public mode, serves the built site, and keeps the same `/api` routes. It does not turn on Vite's file browser.

## Environment variables

Set these on the NSSM service. Do not commit the real `.env`.

| Variable | What to set |
| --- | --- |
| `HOST` | `127.0.0.1` so only this PC and cloudflared can connect |
| `PORT` | `4173` (the port the tunnel uses) |
| `GEV_PUBLIC` | Set automatically by `server/prod.mjs`. Leave it `1` if you also put it in the service environment |
| `GEV_ALLOWED_HOSTS` | `capemaydispatch.com,www.capemaydispatch.com` |
| `GEV_PUBLIC_HOST` | `capemaydispatch.com` |
| `GEV_HSTS` | `1` once the site is reached only over HTTPS |
| `CAPE_DISPATCH_URL` | `http://127.0.0.1:8100` (the old Cape Dispatch app). Never `https://capemaydispatch.com` |
| `FIREWIRE_URL` | `http://127.0.0.1:8000` |
| `GEV_LLM_DISABLED` | `1` to turn chat and voice off immediately. Unset or `0` to allow them |
| `GEV_LLM_DAILY_REQUEST_CAP` | `800` (default in public mode) |
| `GEV_LLM_DAILY_TOKEN_CAP` | `1500000` (default in public mode) |
| `GEV_LLM_DAILY_USD_CAP` | `5` (default in public mode, a rough dollar estimate, not your provider's bill) |
| `GEV_ADMIN_ENABLED` | `0` unless you need the key screen |
| `GEV_ADMIN_TOKEN` | At least 24 random characters, only if admin is enabled |
| `GEV_ADMIN_PORT` | `4174` if admin is enabled. Do not add this port to the tunnel |
| `GEV_TURNSTILE_SITE_KEY` | Optional Cloudflare Turnstile site key (public) |
| `TURNSTILE_SECRET_KEY` | Optional Turnstile secret. Server only |
| `GEV_REPORTS_REQUIRE_TURNSTILE` | `1` after both Turnstile keys are set |

Keep `GEMINI_API_KEY`, `OPENAI_API_KEY`, and the other provider secrets in the service environment or the ignored `.env`. They are not copied into the browser bundle. The Google Maps key, Cesium ion token, and Mapillary token are still visible in the browser on purpose. Restrict those in each vendor's console (HTTP referrer / URL limits).

cloudflared should target `http://127.0.0.1:4173` and should not rewrite the Host header to `localhost`. Leave Cloudflare's `CF-Connecting-IP` header in place. The app uses it only to count requests per visitor. It never uses that header, or `X-Forwarded-For`, to decide that someone is the operator.

## What was risky, and what changed

### Critical — key setup trusted "this computer"

The POWER UP / Provider Settings screen can write API keys into `.env`. It allowed any request that arrived from `127.0.0.1`. Through the tunnel, that is every visitor.

**Fix:** On the public server the key screen is not mounted. A forwarded address cannot turn it back on. If you set `GEV_ADMIN_ENABLED=1` and a long `GEV_ADMIN_TOKEN`, a second listener on `127.0.0.1:4174` accepts key updates only with that token, only from this PC, and only when proxy headers are absent. Do not publish port 4174. After a save, restart the NSSM service.

### Critical — development server on the public internet

`vite --host` can serve project source and the dev client.

**Fix:** `node server/prod.mjs` serves the `dist` build through Vite's preview server (no hot reload, no `/@fs`). Source maps are off. Requests for `.env`, `.git`, and `..` paths are rejected. There is no directory listing.

### High — chat and voice spend

Gemini and OpenAI keys stay on the server. Anyone who can open the site can still ask the server to call those providers.

**Fix:** Per-visitor limits now use `CF-Connecting-IP` behind the tunnel (a private or loopback value in that header is ignored, and `X-Forwarded-For` is never trusted). Public mode also stops at 800 model calls, 1.5 million tokens, or about $5 of rough usage per UTC day, whichever comes first. `GEV_LLM_DISABLED=1` stops chat and voice immediately. Set a hard budget in the Google and OpenAI accounts as well. The in-app dollar figure is an estimate.

ChatGPT sign-in, the voice debug log, and the local MCP tool endpoint are turned off in public mode. They trusted loopback, which the tunnel also is.

### High — Cape Dispatch proxy loop and open fetch

There was no general `/api/cape` open proxy. Airport radio already called `CAPE_DISPATCH_URL`, defaulting to `http://127.0.0.1:8100`. If that variable were set to `https://capemaydispatch.com` after this app takes the domain, the server would call itself.

**Fix:** `CAPE_DISPATCH_URL` must be a local address (localhost, `*.local`, or a private IP). The public hostname is rejected. A new read-only route, `/api/cape/...`, forwards only:

- `/api/cad/incidents`
- `/api/buoys`
- `/api/aviation/tfrs`
- `/api/airport_wx`
- `/api/power_outages`
- `/api/radio/live`
- `/api/tomtom/traffic`
- `/api/webcams`
- `/api/wx/wind`
- `/api/flood_map/...`
- `/fw-audio/<file>`

Example: `/api/cape/api/cad/incidents` reads `http://127.0.0.1:8100/api/cad/incidents`. `POST` is refused. Fire Wire's `POST /api/ingest/file` is not forwarded. The scanner route only calls a local Fire Wire origin, and only fixed paths. Camera, TomTom, and the other data routes still do not accept an arbitrary URL from the browser. Those routes are rate limited and the Cape responses are cached briefly.

### High — community reports

Reports were already stored as private until someone reviews them, and the page escapes text when it draws it.

**Fix:** Smaller uploads, stripped control characters and angle brackets, 5 reports an hour and 20 a day per visitor, a hidden field bots fill in, and an optional Turnstile check. New reports stay private. There is still no review screen in the app: a report becomes public only if its file is edited to `"status": "approved"` and `"visibility": "public"`. Until you want that, leave them private.

### Medium — browser security headers

**Fix:** Pages send a content security policy that fits Cesium (workers, map tiles, and the optional Turnstile widget), plus `nosniff`, a referrer policy, `frame-ancestors 'none'`, and a microphone/camera permissions policy. `GEV_HSTS=1` adds HSTS. Public API routes do not answer cross-site preflight with a wildcard origin.

### Medium — secrets in the client

**Fix:** The production build's client defines are still only the browser map tokens described above. Server keys are not in that list. Source maps are off. `.env` is not a public file.

## Still blocking a public launch

1. **Build and switch NSSM** to `node server/prod.mjs` with `HOST=127.0.0.1` before the DNS or tunnel points at this app. Until that happens, the dev server is what the world would hit.
2. **Keep the old Cape Dispatch process on port 8100** if you still want its feeds through `/api/cape`. This app does not replace that process by itself.
3. **Old site URLs that this app does not serve.** God's Eye View does not implement `/auth/google/callback`, `/auth/apple/callback`, `/incidents/{id}`, `/privacy`, or `/support`. After the domain moves, those addresses will show this app's own page (or a 404), not the old one. Add Cloudflare redirect rules for them if people still have those links, or keep serving them from the old app on another hostname.
4. **The old Cape Dispatch PWA.** If phones installed the old site, its service worker can keep showing the old app after DNS moves. This app unregisters service workers for this site when the new page loads. Ask regulars to refresh once. If a home-screen icon still shows the old app, remove it and add it again.
5. **Provider bills.** Set spending limits on the Gemini, OpenAI, Google, and TomTom accounts. The in-app caps reset if the process restarts and are not a substitute for those account limits.
6. **Google Maps / Cesium / Mapillary browser tokens** need referrer or URL restrictions for `https://capemaydispatch.com` before the site is public.
7. **No review desk for community reports.** They stay on disk under `.gev-data/community-reports/` and are not public until a person edits the file. Do not commit that folder.
8. **Admin port.** Leave `GEV_ADMIN_ENABLED` off unless you are saving keys from this PC. Never add 4174 to the tunnel.

## Cloudflare Tunnel

Point the public hostname at `http://127.0.0.1:4173` only. Do not also publish 4174, 8000, or 8100. Those stay on the PC: Fire Wire, the old Cape Dispatch app, and the optional admin listener.
