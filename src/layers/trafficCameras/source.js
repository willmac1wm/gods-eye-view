import { mergeTrafficCameras, validateTrafficSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Fetches the two existing providers in parallel and merges them. One
 * half failing never kills the other: a down NJ511 still shows DelDOT
 * cameras (and vice versa). Only when BOTH halves fail does the layer
 * report unavailable — and a missing NJ511 key is the designed
 * DelDOT-only state, not a failure.
 *
 * Attribution (baked into the layer panel): "NJDOT 511NJ (as-is) ·
 * DelDOT · Delaware River and Bay Authority". Camera stills refresh on
 * card open, never on a timer; the layer never re-hosts video.
 */
export function createTrafficCamerasSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function fetchHalf(url, { signal }) {
    const response = await fetchImpl(url, { signal, cache: 'no-store' });
    if (!response.ok)
      throw new Error(`Traffic cameras HTTP ${response.status}`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Traffic cameras returned non-JSON');
    }
    signal?.throwIfAborted();
    return payload;
  }

  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const [nj511Result, deldotResult] = await Promise.allSettled([
        fetchHalf('/api/nj511', { signal }),
        fetchHalf('/api/deldot-cameras', { signal }),
      ]);
      signal?.throwIfAborted();
      if (
        nj511Result.status === 'rejected' &&
        deldotResult.status === 'rejected'
      ) {
        throw new Error('Traffic cameras unavailable');
      }
      const nj511 =
        nj511Result.status === 'fulfilled' ? nj511Result.value : null;
      const deldot =
        deldotResult.status === 'fulfilled' ? deldotResult.value : null;
      const merged = mergeTrafficCameras(nj511?.cameras, deldot?.cameras);
      return validateTrafficSnapshot({
        fetchedAt: Date.now(),
        stale: nj511?.stale === true || deldot?.stale === true,
        nj511Configured: nj511?.configured === true,
        nj511Error:
          nj511Result.status === 'rejected'
            ? String(nj511Result.reason?.message || nj511Result.reason)
            : (nj511?.error ?? null),
        deldotError:
          deldotResult.status === 'rejected'
            ? String(deldotResult.reason?.message || deldotResult.reason)
            : (deldot?.error ?? null),
        records: merged.records,
        nj511Count: merged.nj511Count,
        deldotCount: merged.deldotCount,
      });
    },
  };
}
