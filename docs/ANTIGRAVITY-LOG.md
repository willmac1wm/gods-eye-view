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

---

## 3. What Failed / Pre-Existing Issues Noted

- **`src/i18n/catalog.test.mjs` & `src/voice/*.test.mjs` (from `d75ab04b`)**:
  - In commit `d75ab04b` (`wip/local-awareness`), new English UI strings in `src/local/shell.js`, `src/layers/localFeatures/definitions.js`, and Cape May preset locations in `src/voice/layerManifest.js` were added without updating the 10 non-English locale JSON catalogs (`src/i18n/locales/*.json`) or the voice prompt character-budget test (`src/voice/integrationContract.test.mjs`).
- **Broadcastify / Fire Wire (`public-safety-calls`)**:
  - Upstream Broadcastify feed remains offline (`403`), so the Calls tab displays its explicit offline notice (`feed offline since Oct 30`).
- **OpenStreetMap Overpass (`military-areas`)**:
  - Public Overpass servers intermittently time out on the military areas query; the source caches and retries automatically.

---

## 4. What Is Next / Open Questions

1. **Moderator Review Tool for Community Reports**:
   - `POST /api/local/reports` stores reports privately as `status: "pending-review"`, `visibility: "private"` in `.gev-data/community-reports/`. A loopback-only moderator script or CLI (`scripts/moderate-reports.mjs`) can be added if you want a fast way to inspect and approve reports on the server.
2. **Ferry Camera Placement & Predicted Flooding Street Overlay**:
   - Cape May–Lewes Ferry camera coordinates/headings are currently marked unverified pending exact terminal layout coordinates, and the predicted flooding street overlay awaits a forecast or test-mode toggle to preview high-water street shading on dry days.
3. **i18n Catalog Sync (`npm run i18n`)**:
   - Mark the new strings in `src/local/shell.js` with `translate="no"` (or add locale translations) if full `catalog.test.mjs` green status is desired.
