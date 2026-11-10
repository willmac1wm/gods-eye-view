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

## Step 1 — Branch Initialization (`7605cb08`)
- Created branch `antigravity/retire-old-app` from `will/cursor/public-launch-security-a401` (`7605cb08`).
- Verified baseline security fixes in `src/publicExposure.mjs`, `build/vite.js`, `server/prod.mjs`, and `server/providers/local/capeProxy.js`.
- Next: Port `/privacy`, `/support`, and `/terms` pages (`server/providers/local/legalPages.js`).
