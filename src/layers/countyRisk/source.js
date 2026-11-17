// County risk source (D4): read the live layer states, fetch the
// lightning status from the sidecar, score the county.
//
// The score is computed HERE, client-side, from the input layers'
// analyst records + stats — the rules are in src/data/countyRisk.js and
// this source only feeds them. The one exception is lightning: it has no
// layer module, so the source fetches /api/lightning/status (sidecar,
// mounted in server/providers/sidecar.js) and treats a 503 / failure as
// a missing lightning input, never as zero lightning.
//
// The outages layer keeps no history, so the source keeps its own small
// ring of customers-out readings (6 h) to answer "rising" for the power
// rule. The ring is in-memory only and resets with the page.
import { scoreCountyRisk } from '../../data/countyRisk.js';
import { readCountyRiskInputs } from './inputs.js';
import { COUNTY_RISK_LIGHTNING_API_URL } from './policy.js';
import {
  normalizeCountyRiskSnapshot,
  validateCountyRiskSnapshot,
} from './records.js';

const OUTAGE_HISTORY_KEEP_MS = 6 * 60 * 60 * 1000;
const OUTAGE_TREND_LOOKBACK_MS = 60 * 60 * 1000;

export function createCountyRiskSource({
  readLayers = () => ({}),
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  if (typeof readLayers !== 'function')
    throw new TypeError('County risk requires a layer reader');
  const outageHistory = [];

  function customersOut1hAgo(nowMs) {
    const cutoff = nowMs - OUTAGE_TREND_LOOKBACK_MS;
    let best = null;
    for (const entry of outageHistory) {
      if (entry.t <= cutoff && (best === null || entry.t > best.t)) {
        best = entry;
      }
    }
    return best === null ? null : best.customersOut;
  }

  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const nowMs = now();
      const inputs = readCountyRiskInputs(readLayers(), nowMs);

      // Lightning: sidecar status, or missing on any failure.
      try {
        const response = await fetchImpl(COUNTY_RISK_LIGHTNING_API_URL, {
          signal,
          cache: 'no-store',
        });
        if (response.ok) {
          const payload = await response.json();
          const flashes30m = Number.isFinite(payload?.flashes30m)
            ? payload.flashes30m
            : null;
          const flashes60m = Number.isFinite(payload?.flashes60m)
            ? payload.flashes60m
            : null;
          inputs.lightning = {
            available: true,
            updatedAtMs: Number.isFinite(payload?.checkedAtMs)
              ? payload.checkedAtMs
              : nowMs,
            flashes30m: flashes30m ?? 0,
            flashes60m: flashes60m ?? 0,
          };
        }
      } catch {
        // 503 (watcher never ran) or network failure: lightning stays
        // missing. The score renormalizes over the remaining inputs.
      }
      signal?.throwIfAborted();

      // Power trend from the source's own ring.
      const customersOut = inputs.power?.customersOut;
      if (Number.isFinite(customersOut)) {
        outageHistory.push({ t: nowMs, customersOut });
        while (
          outageHistory.length > 0 &&
          outageHistory[0].t < nowMs - OUTAGE_HISTORY_KEEP_MS
        ) {
          outageHistory.shift();
        }
        inputs.power.customersOut1hAgo = customersOut1hAgo(nowMs);
      }

      const scored = scoreCountyRisk(inputs);
      const snapshot = validateCountyRiskSnapshot(
        normalizeCountyRiskSnapshot({ ...scored, inputs }),
      );
      if (!snapshot) throw new Error('Malformed county risk snapshot');
      return snapshot;
    },
  };
}
