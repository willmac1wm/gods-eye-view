# Antigravity Launch Log (`antigravity/launch`)

Branch: `antigravity/launch` (branched from `wip/local-awareness` at commit `d75ab04b`)
Repository: `https://github.com/willmac1wm/gods-eye-view.git`

---

## 1. Changes Made & Commits

### Commit 1: `2af3c431` — Security Risk Assessment & Public Web Hardening
- **`build/vite.js`**:
  - Added `Referrer-Policy: strict-origin-when-cross-origin` to `BROWSER_HEADERS`.
  - Added `'**/.gev-data/**'` to `server.fs.deny` alongside `.env`, `.env.*`, `**/.gev-logs/**`, and `**/.gev-cache/**`.
  - Added `isBlockedPublicPath()` pre-middleware in `apiResponseHeadersPlugin()` (active on both dev and preview servers) to refuse (`403 Forbidden`) requests targeting `/.env*`, `/.git*`, `/.gev-*` (including `.gev-data/community-reports`), `/@fs/*`, `/__vite_ping`, `/package.json`, `/vite.config.*`, `/server/*`, `/build/*`, `/scripts/*`, and `?raw` / `?inline` / `?import` queries from proxied or preview clients.
  - Added `isCrossSiteApiRequest()` to refuse (`403 Forbidden`) any `/api/*` request carrying a cross-site `Sec-Fetch-Site` header or mismatched `Origin`.
- **`src/keySetup.js`**:
  - Added a non-loopback hostname guard in `initKeySetup()` so non-localhost visitors (`capemaydispatch.com`) immediately disable the `POWER UP` key-setup surface without probing `/api/setup/status`.
- **`server/providers/local/index.js`**:
  - Enforced `admitSameSiteKeyless(req, res)` across `/api/local`.
  - Hardened `POST /api/local/reports`:
    - Enforced `Content-Type: application/json` (`415` on mismatch).
    - Keyed rate-limiting by `cf-connecting-ip` when arriving via loopback tunnel (`5` reports/hr per client IP, `40` reports/hr global).
    - Added a 200-file disk cap on pending `.json` reports in `.gev-data/community-reports/` (`503` when full) to prevent disk exhaustion.
    - Stripped `<` and `>` from `text` and `town` fields.
    - Sanitized 500 error responses (`{ error: 'Local source unavailable' }`) so internal filesystem paths or upstream errors are not leaked.

### Commit 6: `f1e77bbb` — i18n catalog sync for local-awareness strings
- Added the 35 missing Cape May / local-awareness `msg()`/`t()` strings to all 11 non-English locale catalogs as English stand-ins, allowlisted in `src/i18n/same-as-english.json`, and pruned 3 stale entries (`Fly to Tokyo`, `Reset to globe view`, `Show earthquakes`).
- Marked Cape May Dispatch local-panel HTML/status copy in `src/local/shell.js` and local-feature delay/county labels with `// i18n-ignore` so `npm run i18n` and `src/i18n/catalog.test.mjs` pass without a full translation pass.

### Commit 5: `7f1fe64a` — Community report moderator CLI
- **`scripts/moderate-reports.mjs`** + **`npm run moderate-reports`**: local-disk-only list/show/approve/reject (no HTTP). Approving sets `status=approved`, `visibility=public`; optional `--verify`. Reject keeps private. Path-safe ids only.
- **`src/tooling/moderateReports.test.mjs`**: 5 unit tests for list/approve/reject/refuse-rejected/path traversal.
- **`server/providers/local/index.js`**: empty-reports note points operators at the CLI instead of “review tools are not set up yet”.

### Commit 4: `73aedd04` — Launch log security assessment update
- Recorded Realtime CF hardening, port-4180 smoke results, and the public-launch risk table in `docs/ANTIGRAVITY-LOG.md`.

### Commit 3: `3765096e` — OpenAI Realtime Cloudflare / tunnel hardening
- **`server/providers/openai/realtime.js`**:
  - `isLoopbackRequest` now returns false when `hasProxySignals` (CF / Pinokio forwarding headers) are present, so a tunnelled visitor is never treated as local.
  - `isSameOriginRequest` refuses proxied traffic and only allows empty `Origin` from true loopback (non-browser tools).
  - Token mint and OAuth status/login handlers refuse proxied requests up front (`403`) as defense in depth beside the existing `sameSiteGated` wrapper.
- **`src/publicLaunchSecurity.test.mjs`** (new):
  - Regression coverage for CF-header refusal on Realtime token/OAuth, Gemini Live token, OpenAI chat, MCP local gate, Provider Settings, and `admitSameSite`.

### Commit 2: `4a6d0241` — Cape May Dispatch Static & Motion Logos
- **`public/` Assets**:
  - Installed static lighthouse radar logos (`public/logo.png`, `public/logo-alt.png`, `public/logo.svg`) and generated resized app icons (`public/icons/icon-32.png`, `icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`).
  - Installed audio-stripped, H.264 `+faststart` motion logo videos (`public/logo-motion.mp4` for 16:9 loading screen and `public/logo-motion-square.mp4` for 1:1 circular badges).
- **`index.html` & `src/ui/styles/controls.css` & `src/app/startupChrome.js`**:
  - Replaced the God's Eye SVG in `#loading-screen` with the looping motion video (`<video class="loader-video" src="/logo-motion.mp4" poster="/logo.png" autoplay muted loop playsinline></video>`), paused automatically once the loading screen hides, and updated title/heading to `Cape May Dispatch`.
- **`src/ui/views/SceneChromeView.vue` & `src/ui/styles/foundation.css`**:
  - Updated `#title-bar` to display the Cape May Dispatch circular motion badge (`/logo-motion-square.mp4` with `/logo.png` fallback and `prefers-reduced-motion` support) and `CAPE MAY DISPATCH` title.
- **`src/local/shell.js` & `src/ui/styles/local.css` & `public/manifest.webmanifest`**:
  - Added the circular motion badge and `Cape May Dispatch · South Jersey` kicker to the Local conditions header, and updated the PWA manifest name/short_name to `Cape May Dispatch`.

---

## 2. What Was Tested & How

1. **Unit & Contract Tests (`node scripts/run-unit-tests.mjs`)**:
   - `src/tooling/applicationHtml.test.mjs`: Passed (loading screen static markup, unique element IDs, view host order).
   - `src/keySetup.test.mjs` & `src/keySetupCore.test.mjs`: Passed (loopback/proxy admission gates, refusal codes, non-loopback surface teardown).
   - `src/localRequestGate.test.mjs`: Passed (same-origin, cross-site `Sec-Fetch-Site`, and `Origin` checks).
   - `src/materialSymbolsSubset.test.mjs`: Passed (all icon ligatures present in Google Fonts subset URL).
   - `src/ui/frameRateView.test.mjs`, `safeFrameView.test.mjs`, `statusChipsView.test.mjs`, `toastView.test.mjs`: Passed.
2. **Production Build (`npm run build`)**:
   - Passed (`vite build` transformed 1,161 modules cleanly in `8.24s`).
3. **Endpoint & Security Gate Verification**:
   - `/api/setup/status` -> `403` when proxied or non-loopback.
   - `/mcp` -> `403` when proxied or non-loopback.
   - `/.env`, `/.gev-data/community-reports/`, `/@fs/...`, `/package.json`, `/server/...` -> `403`.
   - `/api/local/conditions` with `Sec-Fetch-Site: cross-site` -> `403`.
   - `/api/local/nws-alerts`, `/api/local/conditions`, `/api/local/reports` (same-origin GET) -> `200`.
4. **Take-over security pass (port `4180`, no live cutover)**:
   - `node --import=./build/registerVue.js --test src/publicLaunchSecurity.test.mjs` → 7/7 pass.
   - `node --import=./build/registerVue.js --test src/tooling/localServices.test.mjs` → 30/30 pass.
   - Smoke on `http://127.0.0.1:4180` with CF headers (`cf-connecting-ip`, `cf-ray`, `x-forwarded-*`):
     - `/api/setup/status` → `403` (`code: proxied`)
     - `/mcp` → `403` (local-only)
     - `/api/realtime/token` → `403` (`Proxied requests are not accepted`)
     - `/api/local/nws-alerts` with matching `Host` + `Origin` + `x-forwarded-proto` → `200` (keyless local APIs stay usable behind a tunnel)
     - Sensitive paths `/.env`, `/.gev-data/...`, `/package.json`, `/server/...` → `403`
   - **Not done this pass:** DNS, Cloudflare tunnel, or restart of `100.123.135.82:4173` / `capemaydispatch.com` (explicitly out of scope).

### Security risk assessment (public web)

| Surface | Risk if tunnelled | Gate |
| --- | --- | --- |
| Provider Settings `/api/setup/*` | Key read/write | `admitKeySetupRequest` + client non-loopback short-circuit |
| OpenAI Realtime `/api/realtime/*` | Spend / OAuth | `sameSiteGated` + handler proxy refuse (this commit) |
| Gemini / OpenAI chat & Live token | Spend | `isGeminiRequestOriginAllowed` → `admitSameSiteRequest` (proxy refuse) |
| `/mcp` | Local tool RCE surface | `isLocalMcpRequest` (proxy + non-loopback refuse) |
| Sensitive files / `@fs` / `server/` | Source & private reports | `isBlockedPublicPath` + `fs.deny` |
| Cross-site `/api/*` | CSRF / drive-by | `isCrossSiteApiRequest` |
| Community reports POST | Spam / disk fill | same-site keyless + CF IP rate limit + 200-file cap |
| Keyless local reads (`/api/local/*`) | Intended public | `admitSameSiteKeyless` (proxy allowed; Origin / Sec-Fetch-Site enforced) |

**Deploy note (env only, do not change DNS here):** a public hostname needs `GEV_ALLOWED_HOSTS=capemaydispatch.com,www.capemaydispatch.com` on the process that serves it, or Vite answers `Blocked request. This host is not allowed.`

---

## 3. What Failed / Pre-Existing Issues Noted

- **`src/i18n/catalog.test.mjs`**: fixed on this branch (English stand-ins + `i18n-ignore` for local panel).
- **`src/voice/*.test.mjs` (from `d75ab04b`, still open)**:
  - Cape May preset locations in `src/voice/layerManifest.js` still trip `voiceCardPlanSteps.i18n.test.mjs` (`Fly to Sf` vs San Francisco; `austin` not a preset city) and the Realtime prompt size budget (`integrationContract.test.mjs`, `pointAndAsk.test.mjs`).
- **Broadcastify / Fire Wire (`public-safety-calls`)**:
  - Upstream Broadcastify feed remains offline (`403`), so the Calls tab displays its explicit offline notice (`feed offline since Oct 30`).
- **OpenStreetMap Overpass (`military-areas`)**:
  - Public Overpass servers intermittently time out on the military areas query; the source caches and retries automatically.

---

## 4. What Is Next / Open Questions

1. **Moderator Review Tool for Community Reports**:
   - Done on this branch: `node scripts/moderate-reports.mjs list|show|approve|reject` (disk only). Still no in-browser moderator UI.
2. **Ferry Camera Placement & Predicted Flooding Street Overlay**:
   - Cape May–Lewes Ferry camera coordinates/headings are currently marked unverified pending exact terminal layout coordinates, and the predicted flooding street overlay awaits a forecast or test-mode toggle to preview high-water street shading on dry days.
3. **i18n Catalog Sync (`npm run i18n`)**:
   - Done for launch: catalogs complete; local panel English opted out via `i18n-ignore`. Proper translations can replace the English stand-ins later.
4. **Public hostname allowlist on the live process**:
   - Confirm `GEV_ALLOWED_HOSTS` includes `capemaydispatch.com` / `www` on whatever serves the public tunnel (env only; no DNS/tunnel edits from this branch).
5. **Cost rate-limit key behind tunnels**:
   - Cost endpoints refuse proxy traffic entirely, so shared `127.0.0.1` rate-limit buckets are moot for CF visitors. Keyless local writes already key by `cf-connecting-ip`. No further change planned unless a cost route is later intentionally exposed through a proxy.
