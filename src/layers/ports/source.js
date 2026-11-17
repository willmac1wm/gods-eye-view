// Static snapshot reader: no upstream, no fetch. The ports layer
// ships the hand-curated regional snapshot bundled in the repo
// (portsSnapshot.json) — ports are slow-moving, and the bulk WPI
// download is unreachable today (theportindex.online/data 404s;
// msi.nga.mil HTTP 503, the same blocker as B4). A custom snapshot
// can be injected for tests; bad rows are dropped by records.js and
// reported, never thrown.
import snapshot from './portsSnapshot.json' with { type: 'json' };
import { validateSnapshot } from './records.js';

export const PORTS_SNAPSHOT = snapshot;

export function createPortsSource({ snapshot: injected = snapshot } = {}) {
  return {
    getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      return validateSnapshot(injected);
    },
  };
}
