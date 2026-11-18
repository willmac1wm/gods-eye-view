# Cape May Dispatch: rules for every agent working in this repository

Read this before you change anything. It applies to Claude, Cursor, Codex,
Antigravity, Gemini and any other agent, and to people.

## What this repository is

This is **Cape May Dispatch**, the situational-awareness globe for Cape May
County, NJ, live at https://capemaydispatch.com. It began as a fork of
`bilawalsidhu/gods-eye-view`, but it is its own product now:

- The name is **Cape May Dispatch**. The opening screen plays the lighthouse
  logo video (`public/brand/cape-may-dispatch.*`), and the header, page title,
  icons and manifest all say Cape May Dispatch. Never restore "God's Eye View"
  branding.
- It starts over Cape May County and has town quick-jumps (`src/cityPois.js`:
  Cape May City, Wildwood, Ocean City, Avalon, Stone Harbor, Sea Isle City,
  Cape May Court House, Wildwood Crest, North Wildwood, Villas, County
  Overview). Voice fly-to targets come from that file.
- It has the Local panel and local layers (`src/local/`,
  `src/layers/localFeatures/`, scanner calls, radar flood, wildlife
  sightings), the news sidecar (`sidecar/`, `/news`, `/api/news/*`,
  `/api/alerts`), the Cape feeds (`src/layers/capeDispatch/`) and the data
  layers built in PRs #21 onward.

## The one rule that matters most

**`main` on `willmac1wm/gods-eye-view` is the only base.** Every change starts
from the current `main` and goes back into it by pull request. On 2026-11-17
`main` was replaced by the merge of William's Cape May Dispatch line
(`antigravity/retire-old-app`) with every layer built on the older stock
line. Before that, two lines existed and agents built 40+ layers on the wrong
one. Do not recreate that split:

- Never build on `antigravity/*`, `wip/*`, `cursor/*` or any other old branch.
- Never base work on `upstream` (`bilawalsidhu/gods-eye-view`). Upstream
  changes come in only by a deliberate merge PR that keeps this branding.
- If you find a second line of work that is not in `main`, stop and tell
  William. Do not pick one yourself.

## Hard rules

- Spend no money. No paid tiers, paid APIs or new paid keys.
- Never push to `main`. Branch from `main`, open a pull request, get CI green,
  then merge.
- `gh` defaults to upstream in some clones. Always pass
  `--repo willmac1wm/gods-eye-view`.
- Nothing deploys, restarts or touches the live site without William's
  explicit go-ahead in the current conversation.
- Never read or print secret values or database rows.
- Do not touch FaxSnapAPI (port 8101) or CapeMayFireWire (port 8000) on Legion.
- Never stash, switch branches or reinstall dependencies in someone's working
  checkout. Use `git worktree add ../gods-eye-view-<task> <branch>`.
- Before starting a layer or feature, check it does not already exist:
  `gh pr list --repo willmac1wm/gods-eye-view --state all --limit 20` and
  `ls src/layers/`.

## Adding a data layer

Follow an existing layer such as `src/layers/faaStatus/` (map + card) or
`src/layers/fuel/` (card only). A layer is not done until all of these are
updated, or CI fails:

- `src/app/constructCatalog.js` and `src/app/sourceComposition.js`
- `src/sources/reference.js` and `src/tools/services.js`
- `src/ui/layerNames.js` and `src/voice/layerManifest.js`
- `src/data/layerState.js` plus `src/data/layerStateTokenReservations.json`:
  get the token with `npm run layer-token:next -- <layer-id>`. Published
  tokens are permanent; never change one.
- `package.json` exports and `scripts/package-boundaries.json`
- Translations in all 11 `src/i18n/locales/*.json` (`npm run i18n`)
- `DATA_SOURCES.md` (source, terms, key, cost: it must be free)
- The pinned counts in `src/app/*.test.mjs` and `src/data/layerState*.test.mjs`

## Checks to run before a pull request

```bash
npm run format:check
npm run check:boundaries
npm run layer-token:check -- --base-ref origin/main
TZ=UTC npm test
npm run build
```

Run tests with `TZ=UTC`: CI runs in UTC, and a few date tests fail in
Eastern time.

## Known failing tests

Some unit tests were already failing on William's line before the merge
(voice prompt-size budget, missing translations for local-panel strings,
pinned voice-schema hashes). The list and status live in
`docs/KNOWN-ISSUES.md`. Do not "fix" one by deleting the test, and do not
add new failures.

## Live deployment (Legion)

- Windows host `legion`, reached by `ssh legion` (Tailscale / Cloudflare).
- Service `GodsEyeView` (NSSM) runs `node server/prod.mjs` in
  `C:\Users\willm\gods-eye-view-prod`, port 4173, behind the Cloudflare
  tunnel. That is the production server (public mode): it serves the built
  `dist/` folder, so a change reaches visitors only after `npm run build`.
  The live tunnel config is
  `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`.
- News sidecar: `sidecar/`, loopback 127.0.0.1:8120, SQLite DB under
  `sidecar/data/`. Never run `sidecar/migrate.py --force` against it; it
  wipes the database. Use `sidecar/merge_migrate.py`.
- The old Python app is service `CapeDispatch` (port 8100). Its public site
  is retired: Cloudflare redirects app.capemaydispatch.com pages to this
  app. Keep the service running: `FIREWIRE_URL` and `CAPE_DISPATCH_URL`
  (both `http://127.0.0.1:8100`) feed this app's CAD, radio, health and
  Managers config from it.
- Deploy only with William's go-ahead, and only with
  `scripts/legion/deploy.ps1` from an elevated PowerShell on Legion. It
  stops the service, checks out `origin/main`, runs `npm ci` and
  `npm run build`, restarts, checks the page loads the new build's
  scripts, and prints the previous commit for rollback. A `git pull` in
  the prod folder on its own changes nothing visitors see (`dist/` is
  not rebuilt) and can leave server code and `dist/` out of step.
