# Antigravity Build & Port Log (`antigravity/retire-old-app`)

## Mission
Make this God's Eye View–based Cape May Dispatch app the **only** Cape May Dispatch app so the legacy app (`willmac1wm/capemay-scanner` / `cape-dispatch`) can be retired.

Port these 4 capabilities from the old app into this app on branch `antigravity/retire-old-app` (created from `cursor/public-launch-security-a401` / PR 13 commit `7605cb08`):
1. **Google and Apple Sign-In (`Firebase project cape-dispatch`)** — keeping the same user accounts, roles (`member`, `trusted`, `master`, `admin`), and `DISPATCH_ADMINS`.
2. **Incident Pages at `/incidents/{id}`** (plus legacy `/incident/{id}` redirect and `/incident/{id}/card.svg` social image) — shareable public HTML pages with Open Graph & Twitter Card metadata, audio player, and "Open on 3D Globe" link, failing closed on non-public or unknown IDs.
3. **The `/privacy` and `/support` Pages (plus `/terms`)** — exact App Store–compliant public HTML pages (`200 OK`, `<!--email_off-->`, emergency safety notice, self-service account deletion instructions, zero third-party trackers).
4. **The Managers Page (`/manager` and `/api/manager/*`)** — restricted to admins/managers and controlling **this** app:
   - App settings (announcement banner, default town, community report intake open/closed, daily AI request/USD caps)
   - Map & 3D layer defaults and visibility (`enabledByDefault`, `hidden`)
   - Community reports moderation (Approve as Public, Mark Verified, Reject/Hide, Delete, photo inspection)
   - Live AI Chat & Voice On/Off switch (`aiChatEnabled`, wired into `admitLlmRequest` and `/api/local/app-config`)

## Rules & Constraints
- Branch: `antigravity/retire-old-app` (from `cursor/public-launch-security-a401`, commit `7605cb08`).
- Do **not** undo any security fixes from PR 13 (`a6cbc1fa`, `7605cb08`).
- Commit small and push often to `will` (`github.com/willmac1wm/gods-eye-view.git`).
- Do **not** touch the Cloudflare tunnel, DNS, `capemaydispatch.com`, `app.capemaydispatch.com`, or the live service on Legion (`100.123.135.82:4173`). Test locally on a separate port.
- Never commit API keys, `.env` files, or personal information.

---

## Step 1 — Branch Initialization (`7605cb08`, `cfb078b1`)
- Created branch `antigravity/retire-old-app` from `will/cursor/public-launch-security-a401` (`7605cb08`).
- Verified baseline security fixes in `src/publicExposure.mjs`, `build/vite.js`, `server/prod.mjs`, and `server/providers/local/capeProxy.js`.

## Step 2 — Ported `/privacy`, `/support`, and `/terms` Pages
- **Changed**:
  - Created `server/providers/local/legalPages.js` serving `GET` and `HEAD` for `/privacy`, `/support`, and `/terms` with `BROWSER_HEADERS` (including `BROWSER_CSP` and `X-Frame-Options: DENY`), `<!--email_off-->` markers around `support@capemaydispatch.com`, emergency 9-1-1 disclaimer banner, Firebase `cape-dispatch` disclosure, and self-service `/account` deletion instructions.
  - Registered `installLegalRoutes(server)` in `server/providers/local/index.js`.
  - Added `server/providers/local/legalPages.test.mjs`.
- **Tested**:
  - `node --test server/providers/local/legalPages.test.mjs src/publicExposure.test.mjs` — 11/11 tests passing.

## Step 3 — Ported Google and Apple Sign-In (`Firebase project cape-dispatch`)
- **Changed**:
  - Created `server/providers/local/auth.js` implementing:
    - RS256 Firebase ID token verification for `cape-dispatch` (`https://securetoken.google.com/cape-dispatch`) against Google's X.509 public certs via `node:crypto`.
    - Account continuity importing/syncing existing rows from the legacy SQLite `members` table (`CAPE_DISPATCH_DB_PATH` via `node:sqlite`) and persisting in `.gev-data/cape-accounts.json`, preserving `id`, `username`, `email`, `role` (`member`, `trusted`, `master`, `admin`), `tier`, and `DISPATCH_ADMINS` / `GEV_ADMIN_EMAILS`.
    - Signed `HttpOnly; SameSite=Lax` `gev_session` cookie.
    - Routes: `/api/auth/firebase-config`, `/api/auth/firebase`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/delete-account`, `/logout`, `/login`, `/account`, `/auth/google`, `/auth/apple`.
  - Created `public/cape-auth.js` for external-module Google & Apple Firebase sign-in without inline scripts.
  - Updated `BROWSER_CSP` in `build/vite.js` to allow Firebase JS SDK (`https://www.gstatic.com https://apis.google.com`) and Firebase/Google/Apple OAuth frames (`https://cape-dispatch.firebaseapp.com https://accounts.google.com https://appleid.apple.com`).
  - Added `server/providers/local/auth.test.mjs`.
- **Tested**:
  - `node --test server/providers/local/auth.test.mjs server/providers/local/legalPages.test.mjs src/publicExposure.test.mjs` — 14/14 tests passing.

## Step 4 — Ported Incident Pages at `/incidents/{id}`
- **Changed**:
  - Created `server/providers/local/incidentPages.js` and `public/cape-incident.js` serving:
    - `GET` / `HEAD` `/incidents/:id` — full server-rendered HTML with Open Graph & Twitter Card metadata, Teresa-style Fire Wire headline (`UNITS TOWN -- LOCATION -- NATURE`), apartment/unit number stripping (`stripUnitNumber`), audio player, and "View on 3D Live Map" button (`/?lat=...&lon=...&incident=...`).
    - `GET` `/incident/:id` — `302` redirect to `/incidents/:id`.
    - `GET` `/incidents/:id/card.svg` and `/incident/:id/card.svg` — 1200x630 social card SVG preview.
    - Fail-closed privacy & safety gate (`isIncidentPublicSafe`) returning `404` on unknown IDs, unreviewed community reports, or sensitive call natures (domestic, juvenile, psychiatric, suicide, DOA, sexual assault).
  - Added `server/providers/local/incidentPages.test.mjs`.
- **Tested**:
  - `node --test server/providers/local/incidentPages.test.mjs server/providers/local/auth.test.mjs server/providers/local/legalPages.test.mjs src/publicExposure.test.mjs` — 16/16 tests passing.

## Step 5 — Ported Managers Page (`/manager` and `/api/manager/*`) Controlling This App
- **Changed**:
  - Created `server/providers/local/manager.js` and `public/cape-manager.js`:
    - Restricted `/manager` and `/api/manager/*` to signed-in admins (`role === 'admin'` or `DISPATCH_ADMINS` / `GEV_ADMIN_EMAILS`) or requests presenting `GEV_ADMIN_TOKEN`. Unauthenticated visitors redirect `302` to `/login?next=%2Fmanager`; non-admin accounts receive `403`.
    - **AI Chat & Voice On/Off Switch & Daily Caps**: Toggles `aiChatEnabled` (`true`/`false`), `dailyRequestCap`, and `dailyUsdCap` in `.gev-data/manager-config.json` and immediately updates `setRuntimeLlmOverrides` in `src/publicExposure.mjs` (`admitLlmRequest`) and `/api/local/app-config`. Displays live daily LLM request/token/USD usage (`getLlmBudgetSnapshot`).
    - **Approving Community Reports**: Lists all community reports from `.gev-data/community-reports/` with attached photos (`/api/manager/reports/:id/photo`), category, town, text, and approximate coordinates. Supports one-click **Approve (Public)**, **Approve & Mark Verified**, **Reject/Hide**, and **Delete**. Approved reports immediately appear on the map's Community Reports layer (`/api/local/reports`) and at `/incidents/report:{id}`.
    - **Map & 3D Layers Control**: Configures `enabledByDefault` and `hidden` state for all 21 Local Awareness and 3D Globe layers (`MANAGED_LAYERS`).
    - **App Settings**: Configures top announcement banner (`bannerText`, `bannerSeverity`), `defaultTown`, and community report intake open/closed switch (`reportsOpen`).
  - Wired `/api/local/app-config` and `/incidents/{id}` links into `src/local/shell.js` and `src/layers/localFeatures/definitions.js` so the main 3D map applies manager layer defaults/visibility, hides AI chat UI when disabled, shows Sign-In / Account / 🛡️ Manager links in the Local header, and flies to `?lat=...&lon=...` when opened from `/incidents/{id}`.
  - Added `server/providers/local/manager.test.mjs`.

## Step 6 — Full Verification & Production Build Check
- **Tested**:
  - Unit test suite (`node --test server/providers/local/manager.test.mjs server/providers/local/incidentPages.test.mjs server/providers/local/auth.test.mjs server/providers/local/legalPages.test.mjs server/providers/local/capeProxy.test.mjs src/publicExposure.test.mjs src/keySetupCore.test.mjs`) — **42/42 tests passing**.
  - Production build (`npm run build`) — **succeeded cleanly**.
  - End-to-end production server check (`node server/prod.mjs` on local test port `4189`):
    - `GET /privacy` -> `200 OK`
    - `GET /support` -> `200 OK`
    - `GET /terms` -> `200 OK`
    - `GET /login` -> `200 OK`
    - `GET /api/auth/firebase-config` -> `200 OK`
    - `GET /api/auth/me` -> `200 OK`
    - `GET /api/local/app-config` -> `200 OK`
    - `GET /incident/101` -> `302` redirect to `/incidents/101`
    - `GET /incidents/unknown-999` -> `404` (fail-closed)
    - `GET /manager` (anonymous) -> `302` redirect to `/login?next=%2Fmanager`
    - `GET /manager` (with admin auth) -> `200 OK`
    - `GET /api/key-setup` (in `server/prod.mjs`) -> `404` (not mounted in production preview server)

## Status: Ready for Operator Review & Cutover
- **What's Done**:
  1. Google & Apple Sign-In (`Firebase project cape-dispatch`) preserving legacy accounts and roles (`/login`, `/account`, `/api/auth/*`).
  2. Shareable Incident Pages at `/incidents/{id}` (plus `/incident/{id}` redirect and `/incidents/{id}/card.svg` social card).
  3. App Store–compliant `/privacy`, `/support`, and `/terms` pages.
  4. Managers Page at `/manager` controlling settings, layers, approving community reports, and the AI chat on/off switch.
  5. All PR 13 (`cursor/public-launch-security-a401`) security fixes preserved.
- **What's Next (Operator Steps on Legion when ready to retire the old app)**:
  1. Ensure `FIREBASE_WEB_API_KEY` (for `cape-dispatch`) and `DISPATCH_ADMINS` (your admin email/username) are set in Legion's environment (and optionally `CAPE_DISPATCH_DB_PATH=C:\cape-dispatch\cape_dispatch.db` to auto-import legacy SQLite accounts on first login).
  2. Pull `antigravity/retire-old-app`, run `npm run build`, and run the service with `node server/prod.mjs`.




