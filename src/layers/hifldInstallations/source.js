// src/layers/hifldInstallations/source.js
// Static snapshot reader: no upstream, no fetch, no server provider.
// The layer ships the HIFLD Next MIRTA snapshot bundled in the repo
// (mirtaSnapshot.json, built by scripts/generate-hifld-snapshot.mjs)
// — HIFLD Open shut down August 26, 2025, so there is nothing live to
// poll. A custom snapshot can be injected for tests; a malformed one
// throws, never partially publishes.
import snapshot from './mirtaSnapshot.json' with { type: 'json' };
import { validateSnapshot } from './records.js';

export const HIFLD_SNAPSHOT = snapshot;

export function createHifldInstallationsSource({
  snapshot: injected = snapshot,
} = {}) {
  return {
    getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const validated = validateSnapshot(injected);
      if (!validated) throw new Error('Invalid HIFLD installations snapshot');
      return validated;
    },
  };
}
