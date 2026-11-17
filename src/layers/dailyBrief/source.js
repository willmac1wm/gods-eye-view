import { DAILY_BRIEF_API_URL } from './policy.js';
import {
  normalizeDailyBriefSnapshot,
  validateDailyBriefSnapshot,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Reads the latest daily brief from the sidecar via the Node proxy
 * (/api/news/brief, mounted under /api/news in server/providers/sidecar.js)
 * — the brief is written server-side in sidecar/app/daily_brief.py, so this
 * client only fetches and validates what comes back. It never writes or
 * summarizes anything itself.
 *
 * Attribution (baked into the layer panel): the brief is the blog writer
 * over the last 24 h of stored alerts and news, gated like every post
 * (auto-publish iff confidence >= 0.75, no named individuals, no
 * EMS/patient content, else the review queue).
 */
export function createDailyBriefSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(DAILY_BRIEF_API_URL, {
        signal,
        cache: 'no-store',
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        /* status below remains authoritative */
      }
      signal?.throwIfAborted();
      if (!response.ok) throw new Error(`Daily brief HTTP ${response.status}`);
      const snapshot = validateDailyBriefSnapshot(
        normalizeDailyBriefSnapshot(payload),
      );
      if (!snapshot) throw new Error('Malformed daily brief response');
      return snapshot;
    },
  };
}
