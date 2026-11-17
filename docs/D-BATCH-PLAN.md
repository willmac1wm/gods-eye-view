# L9 Matrix — Remaining D6–D9 Plan

Group **D** in `scripts/qa-l9-matrix.mjs` is the existing browser harness fleet for the L9 release-candidate QA pass. **D1–D5** are earlier in that fleet; this note covers only the **remaining D6–D9** slice.

Runner:

```bash
node scripts/qa-l9-matrix.mjs --only D6,D7,D8,D9 --url http://localhost:4173
# or individually:
node scripts/qa-<name>.mjs --url http://localhost:4173
```

**Status key (this write-up):** none of D6–D9 were executed in the Cape May Dispatch / `antigravity/launch` take-over session. Status below is from the matrix definitions and harness source headers, not a fresh run.

---

## D6 — Attribution (Batch 12)

| | |
| --- | --- |
| **What** | Prove per-layer data credits register in Cesium’s credit display and appear in the expandable “Data attribution” lightbox; prove clean-view and recording modes keep the Google/Cesium credit line visible (`#cesium-credits`). |
| **Sources** | Harness: `scripts/qa-attribution-b12.mjs`. Matrix entry: `scripts/qa-l9-matrix.mjs` (`id: D6`). Findings H10/H11: `docs/pre-ship-audit-2026-07-01.md`. Screenshots: `qa-shots/b12/` (gitignored). |
| **Matrix flags** | Not marked `heavy`. Timeout 600s. No `knownConditions` annotation. |
| **Status** | **Not run** this session. Script present and wired into the L9 matrix. Ready to execute against a keyed local/preview server when the D-batch is resumed. |

---

## D7 — Cockpit utility

| | |
| --- | --- |
| **What** | Focused rendered proof that the adaptive Cockpit Display / Radio layout is ready (`READY` / `NOT_READY` parse in the matrix). Covers cockpit display and radio layout readiness in a real browser session. |
| **Sources** | Harness: `scripts/qa-cockpit-utility.mjs`. Matrix entry: `scripts/qa-l9-matrix.mjs` (`id: D7`, `parseNote: 'READY/NOT_READY'`, `parse: readCockpit`). Related unit pin: `src/contactsDetectionPolicy.test.mjs` (notes this harness). Screenshots: `qa-shots/cockpit-utility/`. |
| **Matrix flags** | `heavy: true`. Timeout 900s. |
| **Known condition** | If the only failing assertion is “runtime console remains clean” and the noise is honest upstream `503`s (e.g. `/api/military-installations` temporarily unavailable), treat as **environmental** — still reported FAIL; re-run when the upstream recovers before filing a product bug. |
| **Status** | **Not run** this session. Expect possible env-linked FAIL under thin/unkeyed upstreams; re-run on a healthy keyed target. |

---

## D8 — Worldwide radio

| | |
| --- | --- |
| **What** | Deterministic browser proof for the Radio companion layer: marker scale/culling, station-tag filtering, first-click selection, direct-action-only playback, panel/Context independence, restoration without autoplay, responsive UI, clean console. Uses fixture stations and stubs `play()`. |
| **Sources** | Harness: `scripts/qa-radio.mjs`. Matrix entry: `scripts/qa-l9-matrix.mjs` (`id: D8`). Screenshots: `qa-shots/radio/`. |
| **Matrix flags** | `heavy: true`. Timeout 900s. No `knownConditions` annotation. |
| **Status** | **Not run** this session. Script present; long-running heavy harness. Run with `welcome=0` URL behavior as the harness sets. |

---

## D9 — Floor verify (grounded contacts)

| | |
| --- | --- |
| **What** | Pin the camera at a site (default Austin / AUS), enable flights, and measure nearby contact render heights against the **actual rendered mesh** (`scene.sampleHeight`, sprite/model excluded). Grounded contacts must sit **on** the floor, not buried under it. |
| **Sources** | Harness: `scripts/qa-floor-verify.mjs`. Matrix entry: `scripts/qa-l9-matrix.mjs` (`id: D9`, `parse: readFloorVerdict`). Cross-ref: `scripts/track-regression.mjs` (notes prior −15.5 m buried measurement). |
| **Matrix flags** | `heavy: true`. Timeout 600s. Harness may not set a process exit code — stdout verdict is the truth for the matrix parser. |
| **Known condition** | Annotated as **EXPECTED FAIL** at `main` `4f9d99b` while the below-mesh fix is not landed (`VERDICT: FAIL` / “buried”). If `fix/below-mesh-contacts` (or equivalent) has landed, PASS is expected; any remaining FAIL (jet-bridge / intra-cell relief residual) is a **real** product failure. |
| **Status** | **Not run** this session. Confirm whether the below-mesh fix is on the branch under test before treating FAIL as a regression. |

---

## Suggested resume order

1. **D6** — shortest timeout, attribution / ToS surface; good smoke of the D runner wiring.
2. **D9** — check below-mesh fix presence first; avoid filing a known expected FAIL.
3. **D7** — cockpit layout; watch for honest `503` console noise.
4. **D8** — longest radio surface; run last when the app is stable.

Do not treat matrix SKIP/ENV as product green. Do not change live DNS, Cloudflare tunnel, or `capemaydispatch.com` as part of this D-batch.
