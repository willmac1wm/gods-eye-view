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
- **Next**:
  - Step 5: Port the Managers Page (`/manager` and `/api/manager/*`) controlling settings, layers, approving community reports, and the AI chat on/off switch, plus wiring into the client UI (`src/local/shell.js`).



