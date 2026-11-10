# Roadmap: retire the old Cape Dispatch app

This is the plan for moving capemaydispatch.com from the old Cape Dispatch app (FastAPI on Legion, port 8100) to this app, and then turning the old app off. It has three phases. Each phase lists who owns it, the steps, what "done" means, and what can go wrong.

Owners used below:

- **Owner** (the site owner): final go/no-go, and anything that needs a console sign-in (Google Cloud, Apple Developer, Firebase, Stripe, App Store Connect, provider billing).
- **God's Eye**: this repo (the globe), its NSSM service, and its build.
- **Cape Dispatch**: the old app, its data export, its API contracts, and its data.
- **hermies**: coordination and reporting status to the owner.

Things that never change in any phase:

- Fire Wire stays on `127.0.0.1:8000` as the backend. It is never published on a public hostname. `/api/ingest/file` is never published.
- Mail DNS stays as it is: MX, SPF, DMARC, and any `_domainkey` or Resend records.
- Ports 4174 (GEV admin listener), 8000 (Fire Wire), and 8100 (old app) are never added to the tunnel for the apex.

---

## Phase 1: subdomain cutover (temporary)

**Goal:** the old app keeps working at `app.capemaydispatch.com`, and the apex `capemaydispatch.com` serves this app.

**Owner:** God's Eye for the tunnel, NSSM, and build. Cape Dispatch for the old app's own settings. the owner for console changes and the final go.

**Steps**

1. Add a tunnel route and DNS record so `app.capemaydispatch.com` reaches the old app on `http://localhost:8100`. The apex and `www` stay on the old app until step 8.
2. Add Cloudflare redirects from `capemaydispatch.com` and `www` to `https://app.capemaydispatch.com`, keeping the path and query, for:
   - `/auth/google/callback`
   - `/auth/apple/callback`
   - `/incidents/*`
   - `/privacy`
   - `/support`

   Create them **disabled** (or not yet deployed). Turn them on at step 8, not before. While the apex still serves the old app, these redirects would send sign-in to the subdomain before it is ready.
3. Add the subdomain to the sign-in providers, without removing the apex entries:
   - Google OAuth client: redirect URI `https://app.capemaydispatch.com/auth/google/callback`, JavaScript origin `https://app.capemaydispatch.com`.
   - Apple Services ID `com.capemaydispatch.signin`: domain `app.capemaydispatch.com`, return URL `https://app.capemaydispatch.com/auth/apple/callback`.
   - Firebase project `cape-dispatch`: authorized domain `app.capemaydispatch.com`.
4. Cape Dispatch updates the old app so it builds its OAuth `redirect_uri`, absolute links (such as `/incidents/{id}`), and password-reset links from `app.capemaydispatch.com` instead of the apex. It also points Resend's reset-link base at the subdomain.
5. Build this app with `npm ci` and `npm run build` in a separate production tree, not the live development tree.
6. Switch the GodsEyeView NSSM service to `node server/prod.mjs` with `HOST=127.0.0.1`, `PORT=4173`, `GEV_ALLOWED_HOSTS=capemaydispatch.com,www.capemaydispatch.com`, `GEV_PUBLIC_HOST=capemaydispatch.com`, `CAPE_DISPATCH_URL=http://127.0.0.1:8100`, `FIREWIRE_URL=http://127.0.0.1:8000`, and `GEV_ADMIN_ENABLED=0`. Keep a rollback of the old NSSM settings.
7. Check that the production build works on Legion, and that the old app still answers at `https://app.capemaydispatch.com` (home page, `/api/buoys`, and a Google and Apple sign-in).
8. **Gated on the owner's final go.** Then point the apex and `www` tunnel ingress at `http://127.0.0.1:4173`, turn on the redirects from step 2, and restart cloudflared.
9. After HTTPS is confirmed on the apex, add `GEV_HSTS=1`.

**Gate for step 8 (the owner's final go)**

- Provider spend limits are set on Gemini, OpenAI, Google Maps, and TomTom. hermies reports this.
- The Stripe Payment Link's after-payment return URL has been checked. **This check is still pending.** If it returns to the apex, change it to a page that still exists.
- The security PR for the production server has been reviewed and merged.

**Exit criteria**

- `https://capemaydispatch.com` serves this app from `server/prod.mjs`, not a development server.
- `https://app.capemaydispatch.com` serves the old app, and Google and Apple sign-in both work there.
- The five redirect paths land on the subdomain.
- Fire Wire, the old app on 8100, and mail all still work.

**Risks**

- **Sign-in breaks** if the redirects go live before the subdomain callbacks are registered and the old app emits the subdomain `redirect_uri`.
- **Everyone is signed out.** The old session cookie is host-only on the apex, so it is not sent to the subdomain. This is expected.
- **Web push subscriptions die.** They belong to the apex origin and cannot be moved. Users have to allow alerts again.
- **Old installed PWAs** can keep showing the old app from their service worker cache until it is cleared. This app unregisters old workers on first load.
- **LAN and Tailscale access to port 4173 stops** when `HOST=127.0.0.1`. Use Tailscale Serve or a second listener if that access is still needed.
- **A short outage** happens when cloudflared and NSSM restart.
- **App Store links** to `/privacy` and `/support` depend on the redirects working.

---

## Phase 2: port the old app's features into this app

**Goal:** everything people still use on the old app works on the apex inside this app, so the subdomain is no longer needed.

**Owners:** God's Eye builds these features in this app. Cape Dispatch provides the data export, the API contracts, and the data for each feature.

**Steps**

1. **Google and Apple sign-in, with sessions.** The session cookie is host-only on the apex (no `Domain` attribute), `HttpOnly`, `Secure`, `SameSite=Lax`. Ignore any old `session` cookie this app did not issue. Move the OAuth redirect URIs back to the apex (`https://capemaydispatch.com/auth/google/callback` and `/auth/apple/callback`). Firebase sign-in, if kept, uses the apex as an authorized domain.
2. **Incident detail pages** at `/incidents/{id}`, with the same IDs and URLs the old app used, so shared links keep working.
3. **`/privacy` and `/support`.** These are the App Store URLs, so they must stay at exactly these paths and stay stable. Move them before the redirects to the subdomain are removed.
4. **A managers/admin page behind login** that controls this app: settings, layers, the region and CCTV packs, and community-report moderation (approve, hide, delete). It replaces approving reports by editing files on disk. It needs:
   - roles (for example viewer, moderator, admin),
   - an audit log of who changed what and when,
   - CSRF protection on every change,
   - real sign-in. It must **not** reuse the loopback trust model: behind the tunnel, every visitor looks local.
5. **The data feeds this app gets from port 8100 through `/api/cape`** (incidents, buoys, airport weather, power outages, radio, traffic, and the rest). Decide for each feed whether to port it into this app's server or keep the old app's process running as a local-only sidecar on `127.0.0.1:8100`. Write the decision down per feed. A sidecar is never published.
6. **Push notifications, PWA install, and the service worker** on the apex: a manifest, a worker scoped to the apex, and new push subscriptions (old ones cannot be carried over).

**Exit criteria**

- A signed-in user can do everything they used to do on the old app, on the apex.
- Managers can moderate reports and change settings in the admin page, with each change in the audit log.
- Each `/api/cape` feed is either ported or running as a documented local sidecar.
- No traffic still needs `app.capemaydispatch.com` (check the Cloudflare analytics for the subdomain).

**Risks**

- **Admin security.** A login, roles, or CSRF mistake would expose controls to the public. It needs a security review before it ships.
- **Lost data** if the old app's users, incidents, or reports are not exported completely. Cape Dispatch owns the export and should provide a checksum or a row count.
- **Broken links** if incident IDs or URL formats change.
- **App Store review** problems if `/privacy` or `/support` move or go down.
- **Feeds stop** if the sidecar is turned off before its feeds are ported.

---

## Phase 3: retire the old app and rename

**Goal:** one app, named Cape May Dispatch, on the apex.

**Owners:** Cape Dispatch turns off the old app. God's Eye does the rebrand. The owner removes the console entries.

**Steps**

1. Turn off the old app, unless it is kept as a local-only sidecar from Phase 2.
2. Remove `app.capemaydispatch.com` from the tunnel. Keep redirects from `app.capemaydispatch.com/*` to the same path on the apex for a grace period (for example 90 days), then remove them and the DNS record.
3. Remove the subdomain entries from the Google OAuth client, the Apple Services ID, and Firebase authorized domains. Leave the apex entries.
4. Rebrand this app fully as **Cape May Dispatch**: the UI title, page metadata, social cards, the PWA manifest, and the repo docs. No more "God's Eye" or "new app" naming in anything people see.
5. Fire Wire stays as the backend on `127.0.0.1:8000`. Never publish `/api/ingest/file`.
6. Mail DNS stays unchanged.

**Exit criteria**

- The old app's process is off (or local-only), and nothing public points at port 8100.
- The subdomain is gone after the grace period, with no OAuth or Firebase entries left for it.
- The visible product name everywhere is Cape May Dispatch.
- Mail still works.

**Risks**

- **Links people saved** to the subdomain break once the grace-period redirects end.
- **Removing the wrong OAuth entry** (the apex instead of the subdomain) breaks sign-in.
- **Missed "God's Eye" strings** in metadata, the manifest, or translations. Search the repo for them before calling this done.
- **Upstream merges.** This fork tracks the upstream God's Eye View project, and future merges may bring old names back.
