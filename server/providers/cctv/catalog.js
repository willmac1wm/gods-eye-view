import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CCTV_SOURCE_FILE, CCTV_SOURCE_CACHE_MS } from './constants.js';
import { allocateSourceCap, resolveCatalogCap } from './cap.js';
import { loadGroundHeights, joinGroundHeights } from './groundHeights.js';
import { cameraRegion, normalizeSourceItem } from './normalize.js';
import { loadLithuaniaSources } from './lithuania.js';
import { loadTaiwanSources } from './taiwan.js';
import {
  loadAustinSourcesFromOpenData,
  loadCaltransSourcesFromOpenData,
  loadTflSourcesFromOpenData,
  loadOntarioSourcesFromOpenData,
  loadFintrafficSourcesFromOpenData,
  loadDriveBcSourcesFromOpenData,
  loadTxdotSourcesFromOpenData,
  loadTallinnSourcesFromCatalog,
  loadTarkteeSourcesFromDatex,
  loadWarendorfSourcesFromCatalog,
  loadNswSourcesFromOpenData,
  loadCalgarySourcesFromOpenData,
  loadCataloniaSourcesFromOpenData,
  loadHkSourcesFromOpenData,
  loadDelDOTSourcesFromOpenData,
  loadKingCountySourcesFromOpenData,
  loadWsdotSourcesFromOpenData,
  loadVegvesenSourcesFromOpenData,
  loadNycSourcesFromOpenData,
  loadTorontoSourcesFromOpenData,
  loadFloridaSourcesFromOpenData,
  loadHoustonSourcesFromOpenData,
  loadA22SourcesFromOpenDataHub,
} from './sources.js';
import { loadFaaWebcamSourcesFromOpenData } from './faa.js';
import {
  cctvPackEnabled,
  effectiveCctvMaxSources,
} from '../../../src/region/mode.js';

/**
 * Default-on pack. Unset or anything but "0" enables. `GEV_REGION=cape` or
 * `CCTV_REGION_PACKS` narrows that to the allowlist (see src/region/mode.js).
 * Austin and Caltrans use the same switch as every other default-on pack.
 */
const envEnabled =
  (name, pack) =>
  (env = process.env) =>
    cctvPackEnabled(pack, name, {}, env);
/** Env opt-in: only "1" enables, including when a regional allowlist is off. */
const envOptIn =
  (name, pack) =>
  (env = process.env) =>
    cctvPackEnabled(pack, name, { optIn: true }, env);

/**
 * Live open-data packs, in merge order. Adding a region is one entry here
 * plus its loader (in sources.js or its own module); the catalog cap is
 * shared across entries round-robin (cap.js), so a new pack never silently
 * evicts an older one.
 * Each pack fails independently (allSettled) and is gated by its own env
 * kill switch, or by an opt-in flag where access needs an agreement or the
 * terms are unconfirmed.
 */
const LIVE_PACKS = [
  {
    name: 'austin',
    enabled: envEnabled('CCTV_AUSTIN_ENABLED', 'austin'),
    load: loadAustinSourcesFromOpenData,
  },
  {
    name: 'caltrans',
    enabled: envEnabled('CCTV_CALTRANS_ENABLED', 'caltrans'),
    load: loadCaltransSourcesFromOpenData,
  },
  {
    name: 'tfl',
    enabled: envEnabled('CCTV_TFL_ENABLED', 'tfl'),
    load: loadTflSourcesFromOpenData,
  },
  {
    name: 'ontario',
    enabled: envEnabled('CCTV_ONTARIO_ENABLED', 'ontario'),
    load: loadOntarioSourcesFromOpenData,
  },
  {
    name: 'fintraffic',
    enabled: envEnabled('CCTV_FINTRAFFIC_ENABLED', 'fintraffic'),
    load: loadFintrafficSourcesFromOpenData,
  },
  {
    name: 'drivebc',
    enabled: envEnabled('CCTV_DRIVEBC_ENABLED', 'drivebc'),
    load: loadDriveBcSourcesFromOpenData,
  },
  {
    name: 'txdot',
    enabled: envEnabled('CCTV_TXDOT_ENABLED', 'txdot'),
    load: loadTxdotSourcesFromOpenData,
  },
  {
    name: 'tallinn',
    enabled: envEnabled('CCTV_TALLINN_ENABLED', 'tallinn'),
    load: loadTallinnSourcesFromCatalog,
  },
  {
    name: 'tarktee',
    enabled: envEnabled('CCTV_TARKTEE_ENABLED', 'tarktee'),
    load: loadTarkteeSourcesFromDatex,
  },
  {
    name: 'warendorf',
    enabled: envEnabled('CCTV_WARENDORF_ENABLED', 'warendorf'),
    load: loadWarendorfSourcesFromCatalog,
  },
  {
    name: 'nsw',
    enabled: envEnabled('CCTV_NSW_ENABLED', 'nsw'),
    load: loadNswSourcesFromOpenData,
  },
  {
    name: 'calgary',
    enabled: envEnabled('CCTV_CALGARY_ENABLED', 'calgary'),
    load: loadCalgarySourcesFromOpenData,
  },
  {
    name: 'catalonia',
    enabled: envEnabled('CCTV_CATALONIA_ENABLED', 'catalonia'),
    load: loadCataloniaSourcesFromOpenData,
  },
  {
    name: 'hk',
    enabled: envEnabled('CCTV_HK_ENABLED', 'hk'),
    load: loadHkSourcesFromOpenData,
  },
  {
    name: 'deldot',
    enabled: envEnabled('CCTV_DELDOT_ENABLED', 'deldot'),
    load: loadDelDOTSourcesFromOpenData,
  },
  {
    name: 'kingcounty',
    enabled: envEnabled('CCTV_KINGCOUNTY_ENABLED', 'kingcounty'),
    load: loadKingCountySourcesFromOpenData,
  },
  {
    name: 'wsdot',
    enabled: envEnabled('CCTV_WSDOT_ENABLED', 'wsdot'),
    load: loadWsdotSourcesFromOpenData,
  },
  {
    name: 'vegvesen',
    enabled: envEnabled('CCTV_VEGVESEN_ENABLED', 'vegvesen'),
    load: loadVegvesenSourcesFromOpenData,
  },
  {
    // NYC DOT requires a data-sharing agreement for this feed, so the pack is
    // off unless the operator opts in (see DATA_SOURCES.md).
    name: 'nyc',
    enabled: envOptIn('CCTV_NYC_ENABLED', 'nyc'),
    load: loadNycSourcesFromOpenData,
  },
  {
    name: 'toronto',
    enabled: envEnabled('CCTV_TORONTO_ENABLED', 'toronto'),
    load: loadTorontoSourcesFromOpenData,
  },
  {
    // Opt-in until the Via Lietuva open-data terms are confirmed to cover the
    // camera photos (see DATA_SOURCES.md).
    name: 'lithuania',
    enabled: envOptIn('CCTV_LITHUANIA_ENABLED', 'lithuania'),
    load: loadLithuaniaSources,
  },
  {
    // FL511's terms limit its content to individual, personal use (other use
    // needs FDOT's written consent), so the pack is off unless the operator
    // opts in (see DATA_SOURCES.md).
    name: 'florida',
    enabled: envOptIn('CCTV_FLORIDA_ENABLED', 'florida'),
    load: loadFloridaSourcesFromOpenData,
  },
  {
    name: 'taiwan',
    enabled: envEnabled('CCTV_TAIWAN_ENABLED', 'taiwan'),
    load: loadTaiwanSources,
  },
  {
    name: 'houston',
    enabled: envOptIn('CCTV_HOUSTON_ENABLED', 'houston'),
    load: loadHoustonSourcesFromOpenData,
  },
  {
    name: 'a22',
    enabled: envEnabled('CCTV_A22_ENABLED', 'a22'),
    load: loadA22SourcesFromOpenDataHub,
  },
  {
    name: 'faa-weathercams',
    enabled: envEnabled('CCTV_FAA_ENABLED', 'faa-weathercams'),
    load: loadFaaWebcamSourcesFromOpenData,
  },
];
/**
 * Load CCTV sources from a local JSON file (CCTV_SOURCES_FILE env or default).
 *
 * @returns {Array<object>} Array of raw source objects, or [] on error.
 */
function loadSourcesFromFile(sourceRoot) {
  const sourceFile = process.env.CCTV_SOURCES_FILE || DEFAULT_CCTV_SOURCE_FILE;
  const resolved = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(sourceRoot, sourceFile);
  try {
    if (!fs.existsSync(resolved)) return [];
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(
      '[CCTV] failed to read source file:',
      resolved,
      error?.message || error,
    );
    return [];
  }
}

/**
 * Load CCTV sources from the CCTV_SOURCES_JSON env variable (inline JSON).
 *
 * @returns {Array<object>} Array of raw source objects, or [] if unset/invalid.
 */
function loadSourcesFromEnv() {
  const raw = process.env.CCTV_SOURCES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Create an independent catalog rooted in the consuming application. */
export function createCctvCatalog({ sourceRoot = process.cwd() } = {}) {
  /** @type {Array<object>} Cached merged + normalized CCTV source list. */
  let _cctvSourceCache = [];
  /** @type {number} Epoch-ms when the source cache was last refreshed. */
  let _cctvSourceCacheAt = 0;
  /** @type {Promise<Array<object>>|null} In-flight refresh, shared by concurrent
   * callers so a post-TTL burst launches ONE refetch, not one per request. */
  let _cctvSourceInflight = null;
  /** @type {WeakMap<Array<object>, Array<{pack: string, available: number, served: number}>>}
   * Packs that serve fewer cameras than they offer, keyed by the source list
   * they describe, so a request served the old list during a background
   * refresh never pairs it with the new list's trim notes. */
  const _cctvTrimmedPacks = new WeakMap();

  /**
   * Assemble and cache the merged CCTV source list.
   *
   * Merges every source pack (live open-data packs, local file, env
   * variable), deduplicates by ID, shares the catalog cap fairly across
   * packs, and caches for CCTV_SOURCE_CACHE_MS. Past that, the cached list is
   * returned while a background refresh replaces it; only a first load waits.
   *
   * @returns {Promise<Array<object>>} Deduplicated, capped source list.
   */
  async function getCctvSources() {
    const now = Date.now();
    if (
      _cctvSourceCache.length &&
      now - _cctvSourceCacheAt <= CCTV_SOURCE_CACHE_MS
    ) {
      return _cctvSourceCache;
    }
    // Single-flight: a burst of requests arriving past the TTL shares ONE refresh
    // instead of each launching the full multi-provider refetch. The `.finally`
    // clears the ref so the next post-TTL cycle starts fresh.
    if (!_cctvSourceInflight) {
      _cctvSourceInflight = refreshCctvSources().finally(() => {
        _cctvSourceInflight = null;
      });
      // A background refresh has no caller waiting on it: report its failure
      // here, once per refresh rather than once per request it serves. Keep
      // the old catalog for another TTL, as an empty refresh does, so a refresh
      // that keeps failing is retried once per TTL, not back to back.
      if (_cctvSourceCache.length) {
        _cctvSourceInflight.catch((error) => {
          _cctvSourceCacheAt = Date.now();
          console.warn(
            '[CCTV] background catalog refresh failed; serving',
            _cctvSourceCache.length,
            'cameras from the last catalog:',
            error?.message || error,
          );
        });
      }
    }
    // With a catalog in hand, answer with it while the refresh runs: the
    // refresh lasts as long as the slowest pack (Tarktee's DATEX feeds take up
    // to its 30 s timeout), and every /api/cctv request would otherwise wait
    // for it. Only the first load, with nothing to serve yet, waits.
    return _cctvSourceCache.length ? _cctvSourceCache : _cctvSourceInflight;
  }

  /**
   * Assemble and cache the merged CCTV source list from file/env + live packs.
   * Always resolves (loaders self-catch to []); on a fully-empty refresh with a
   * good prior catalog it serves stale rather than blanking the CCTV layer.
   *
   * @returns {Promise<Array<object>>} Deduplicated, capped source list.
   */
  async function refreshCctvSources() {
    const fromFile = loadSourcesFromFile(sourceRoot);
    const fromEnv = loadSourcesFromEnv();

    const forceAustin =
      String(process.env.CCTV_FORCE_AUSTIN || '').trim() === '1';
    const preferAustin =
      String(process.env.CCTV_PREFER_AUSTIN || '1').trim() !== '0';
    // Live open-data packs load unless a file/env pack is configured and live
    // packs aren't forced — the same gate that governed the Austin-only fetch
    // now governs every entry in LIVE_PACKS.
    const needsLiveSources =
      forceAustin || (fromFile.length + fromEnv.length === 0 && preferAustin);
    const liveResults = needsLiveSources
      ? await Promise.allSettled(
          // Invoked inside the promise so a loader that throws synchronously
          // (a file-based pack on a malformed row) is isolated like any other
          // failed pack instead of rejecting the whole refresh.
          LIVE_PACKS.map((pack) =>
            Promise.resolve().then(() =>
              pack.enabled() ? pack.load({ sourceRoot }) : [],
            ),
          ),
        )
      : [];
    // Live packs first so file/env overrides win on duplicate IDs; each pack
    // keeps its own priority order and the catalog cap is shared fairly.
    const normalizePack = (name, items) => ({
      name,
      sources: items
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({ ...normalizeSourceItem(item), pack: name }))
        .filter((item) => item.id),
      available: Number.isFinite(items.available)
        ? items.available
        : items.length,
      region: items.region ?? null,
    });
    const packs = [
      ...LIVE_PACKS.map((pack, index) =>
        normalizePack(
          pack.name,
          liveResults[index]?.status === 'fulfilled'
            ? liveResults[index].value
            : [],
        ),
      ),
      normalizePack('file', fromFile),
      normalizePack('env', fromEnv),
    ];
    const maxCount = resolveCatalogCap(effectiveCctvMaxSources());
    const allocation = allocateSourceCap(packs, maxCount);
    // Shipped ground heights (src/data/local_data/cctv_ground_heights/, produced by
    // scripts/precompute-cctv-heights.mjs) ride along on the served source so
    // the client can place a camera and its monitor plane with zero sampling.
    const capped = joinGroundHeights(
      allocation.sources,
      loadGroundHeights(sourceRoot),
    );
    const trimmed = allocation.packs.filter((pack) => pack.kept < pack.offered);
    // Each pack's own nearest-first cap and the shared catalog cap both trim.
    const trimmedPacks = packs
      .map((pack, index) => ({
        pack: pack.name,
        available: Math.max(pack.available, allocation.packs[index].offered),
        served: allocation.packs[index].kept,
        // Where the pack's cameras are, including those not served.
        region: pack.region ?? cameraRegion(pack.sources),
      }))
      .filter((pack) => pack.served < pack.available);
    if (trimmed.length) {
      const detail = trimmed
        .map((pack) => `${pack.name} ${pack.kept}/${pack.offered}`)
        .join(', ');
      console.warn(
        `[CCTV] source catalog exceeds cap ${maxCount}; shared round-robin across packs (${detail}). Raise CCTV_MAX_SOURCES or lower a per-pack cap to change the mix.`,
      );
    }
    if (capped.length > 0 || _cctvSourceCache.length === 0) {
      _cctvSourceCache = capped;
      _cctvTrimmedPacks.set(capped, trimmedPacks);
    } else {
      // Every source came back empty (all live packs timed out / upstream outage)
      // but a good catalog is already cached — serve it stale rather than blanking
      // every CCTV route. Advancing the timestamp waits one TTL before retrying,
      // which (with single-flight) bounds load on a persistently-down upstream.
      console.warn(
        `[CCTV] source refresh returned empty; serving ${_cctvSourceCache.length} stale cameras`,
      );
    }
    _cctvSourceCacheAt = Date.now();
    return _cctvSourceCache;
  }

  /** Packs serving fewer cameras than they offer in `sources` (by default the
   * current catalog). Pass the list a request was served to keep the two in
   * step while a background refresh swaps the catalog. */
  getCctvSources.trimmedPacks = (sources = _cctvSourceCache) =>
    _cctvTrimmedPacks.get(sources) ?? [];
  return getCctvSources;
}

/** Which live packs would fetch for `env` (defaults to the process env). */
export function cctvLivePackStates(env = process.env) {
  return LIVE_PACKS.map((pack) => ({
    name: pack.name,
    enabled: Boolean(pack.enabled(env)),
  }));
}
