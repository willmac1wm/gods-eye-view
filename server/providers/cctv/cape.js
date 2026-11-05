// Cape May cameras as CCTV sources. The right-hand camera panel plays them.
// Streams stay on their own public hosts. Catalog JSON comes from Fire Wire
// (FIREWIRE_URL / CAPE_DISPATCH_URL). The retired Cape website is never a default.
import { readResponseJsonCapped } from '../common/http.js';
import { prioritizeSources } from './normalize.js';
import { CCTV_SOURCE_FETCH_TIMEOUT_MS } from './constants.js';
import { capeCctvSources } from '../../../src/layers/capeDispatch/cctvFeed.js';
import { isRetiredCapeWebsite, resolveCapeUpstream } from '../capeUpstream.js';

const DEFAULT_CAPE_MAX_SOURCES = 400;
const CAPE_ANCHOR = Object.freeze([{ lat: 38.935, lon: -74.91 }]);
const PATHS = [
  'traffic_cameras',
  'intel/nj511_cameras',
  'fx/cameras',
  'webcams',
];

function operatorBase() {
  const base = resolveCapeUpstream();
  if (!base || isRetiredCapeWebsite(base)) return null;
  return base;
}

async function readCape(base, path) {
  const response = await fetch(`${base}/api/${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    redirect: 'error',
  });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* no-op */
    }
    throw new Error(`${path} HTTP ${response.status}`);
  }
  return readResponseJsonCapped(response, 8 * 1024 * 1024);
}

/**
 * Fetch the Cape camera catalog and return CCTV source objects.
 * One failed list does not drop the others. No Fire Wire URL → empty pack.
 * @returns {Promise<Array<object>>}
 */
export async function loadCapeSources() {
  const base = operatorBase();
  if (!base) return [];
  const results = await Promise.allSettled(
    PATHS.map((path) => readCape(base, path)),
  );
  const payload = {};
  const keys = ['traffic', 'nj511', 'fx', 'webcams'];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') payload[keys[index]] = result.value;
    else
      console.warn(
        '[CCTV] Cape catalog list failed:',
        PATHS[index],
        result.reason?.message || result.reason,
      );
  });
  // Absolutize fx stills onto the Fire Wire host so /api/cctv/frame can fetch
  // them. The browser still uses /api/cctv/frame/:id, not the Fire Wire origin.
  const sources = capeCctvSources(payload, base);
  if (!sources.length) return [];
  const maxRaw = Number(
    process.env.CCTV_CAPE_MAX_SOURCES || DEFAULT_CAPE_MAX_SOURCES,
  );
  const maxCount = Number.isFinite(maxRaw)
    ? Math.max(8, Math.min(800, Math.floor(maxRaw)))
    : DEFAULT_CAPE_MAX_SOURCES;
  const prioritized = prioritizeSources(sources, maxCount, CAPE_ANCHOR);
  console.log(
    `[CCTV] Loaded Cape camera sources: ${sources.length} (using nearest ${prioritized.length})`,
  );
  return prioritized;
}
