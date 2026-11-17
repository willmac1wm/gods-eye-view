/**
 * Manager-controlled Cape ops defaults: viewability, poll intervals, globe
 * strip/layer visibility, source prefs, AI prompt overrides.
 * Pages and the strip clamp against INTERVAL_CLAMP_MS so operators cannot
 * freeze upstream APIs or leave desks permanently stale.
 */

export const CONFIG_VERSION = 1;

/** Hard clamps applied on every read/write (milliseconds). */
export const INTERVAL_CLAMP_MS = Object.freeze({
  min: 15_000,
  max: 30 * 60_000,
  placeMin: 60_000,
  stripMin: 30_000,
});

/** Default poll intervals per desk / surface. */
export const DEFAULT_INTERVALS_MS = Object.freeze({
  place: 5 * 60_000,
  hydrants: 5 * 60_000,
  timeline: 10 * 60_000,
  incidents: 60_000,
  scanners: 60_000,
  flood: 60_000,
  board: 60_000,
  social: 60_000,
  news: 90_000,
  aviation: 120_000,
  atc: 15_000,
  firewire: 60_000,
  cameras: 120_000,
  reconstruct: 120_000,
  whales: 5 * 60_000,
  intel: 5 * 60_000,
  messages: 15_000,
  strip: 60_000,
});

/** Which ops desks appear in nav / hub (Managers always visible when unlocked). */
export const DEFAULT_VIEWABILITY = Object.freeze({
  hub: true,
  place: true,
  hydrants: true,
  timeline: true,
  incidents: true,
  scanners: true,
  flood: true,
  board: true,
  social: true,
  news: true,
  aviation: true,
  atc: true,
  firewire: true,
  cameras: true,
  reconstruct: true,
  scenes: true,
  intel: true,
  whales: true,
  messages: true,
  ai: true,
  managers: true,
});

/** Place panel sections — code enforcement + city maps are first-class. */
export const DEFAULT_PLACE_SECTIONS = Object.freeze({
  parcel: true,
  occupancy: true,
  construction: true,
  flood: true,
  hydrant: true,
  codeEnforcement: true,
  cityMaps: true,
});

/** Board / social feed source toggles. */
export const DEFAULT_SOURCES = Object.freeze({
  social: Object.freeze({
    board: true,
    social: true,
    news: true,
    wire: true,
  }),
  place: Object.freeze({
    /** native = NJ GIS parcel compile; firewire = prefer Cape place if present */
    format: 'native',
    /** Opt-in anonymized permits/code fixtures when Fire Wire has no cases. */
    demoFixtures: false,
  }),
  board: Object.freeze({
    official: true,
    newsWire: true,
    county: true,
    outages: true,
  }),
  /**
   * LiveATC: in-app Icecast proxy on /ops/atc (old Cape program).
   * `links` keeps aviation external link-outs; `proxy` enables stream proxy;
   * `mounts` toggles individual allowlisted mounts.
   */
  liveatc: Object.freeze({
    links: true,
    proxy: true,
    mounts: Object.freeze({
      kacy_a_twr: true,
      kwwd_twr: true,
      kmiv_awos: true,
    }),
  }),
});

/**
 * Globe visibility matrix — strip chrome + DATA LAYERS Cape May feeds.
 * Strip-only surfaces (board chips, ops links) are not Cesium layers.
 */
export const DEFAULT_GLOBE = Object.freeze({
  stripEnabled: true,
  stripSections: Object.freeze({
    health: true,
    boardChips: true,
    tide: true,
    flood: true,
    nws: true,
    county: true,
    outages: true,
    radio: true,
    cad: true,
    tomtom: true,
    marine: true,
    sar: true,
    storms: true,
    newsWire: true,
    opsLinks: true,
  }),
  layers: Object.freeze({
    'cape-cad': true,
    'cape-cameras': true,
    'cape-webcams': true,
    'cape-flood': true,
    'cape-nws': true,
    'cape-outages': true,
    'cape-radio': true,
    'cape-whales': true,
    'cape-tomtom': true,
    'cape-buoys': true,
    'cape-airports': true,
    'cape-tfrs': true,
    'cape-wind': true,
  }),
});

export const DEFAULT_APPROVALS = Object.freeze({
  /** When true, posting messages requires manager Bearer token. */
  requireManagerForMessages: false,
  /** When true, AI prompt overrides require explicit save confirmation UI. */
  requireConfirmAiOverrides: true,
});

export const DEFAULT_PERMISSIONS = Object.freeze({
  canPostMessages: true,
  canEditAiPrompts: true,
  canToggleGlobeLayers: true,
});

export const DEFAULT_ATC_AI = Object.freeze({
  enabled: true,
  emergencyLexicon: Object.freeze([
    'mayday',
    'pan-pan',
    'pan pan',
    'emergency',
    'declaring an emergency',
  ]),
  squawkCodes: Object.freeze(['7700', '7600', '7500']),
  phraseology: Object.freeze([
    'go around',
    'missed approach',
    'fuel emergency',
    'minimum fuel',
  ]),
  callSigns: Object.freeze([]),
  promptOverride: '',
  cooldownSec: 60,
});

export const DEFAULT_AI = Object.freeze({
  /** Appended to Cape/GEV situation brief context when present. */
  briefOverride: '',
  /** Optional HUD / ask preamble override (GEV-local). */
  askOverride: '',
  /** ATC transcript alert detector (Managers-editable). */
  atc: DEFAULT_ATC_AI,
  notes:
    'GEV Voice / Chat / HUD read ai.briefOverride + ai.askOverride from this config on each session mint (fail open to stock instructions.js when empty). ATC desk uses ai.atc for squawk/emergency/phraseology/callsign detection. Fire Wire doctrine / review prompts stay upstream under /api/manager/doctrine — Managers can view them via the Fire Wire tools panel, not edit them here.',
});

export function defaultManagerConfig() {
  return {
    version: CONFIG_VERSION,
    viewability: { ...DEFAULT_VIEWABILITY },
    placeSections: { ...DEFAULT_PLACE_SECTIONS },
    intervalsMs: { ...DEFAULT_INTERVALS_MS },
    sources: {
      social: { ...DEFAULT_SOURCES.social },
      place: { ...DEFAULT_SOURCES.place },
      board: { ...DEFAULT_SOURCES.board },
      liveatc: {
        links: DEFAULT_SOURCES.liveatc.links,
        proxy: DEFAULT_SOURCES.liveatc.proxy,
        mounts: { ...DEFAULT_SOURCES.liveatc.mounts },
      },
    },
    globe: {
      stripEnabled: DEFAULT_GLOBE.stripEnabled,
      stripSections: { ...DEFAULT_GLOBE.stripSections },
      layers: { ...DEFAULT_GLOBE.layers },
    },
    approvals: { ...DEFAULT_APPROVALS },
    permissions: { ...DEFAULT_PERMISSIONS },
    ai: {
      briefOverride: DEFAULT_AI.briefOverride,
      askOverride: DEFAULT_AI.askOverride,
      notes: DEFAULT_AI.notes,
      atc: {
        ...DEFAULT_ATC_AI,
        emergencyLexicon: [...DEFAULT_ATC_AI.emergencyLexicon],
        squawkCodes: [...DEFAULT_ATC_AI.squawkCodes],
        phraseology: [...DEFAULT_ATC_AI.phraseology],
        callSigns: [...DEFAULT_ATC_AI.callSigns],
      },
    },
    updatedAt: null,
  };
}

function clampInterval(key, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_INTERVALS_MS[key] ?? 60_000;
  let min = INTERVAL_CLAMP_MS.min;
  if (key === 'place' || key === 'hydrants') min = INTERVAL_CLAMP_MS.placeMin;
  if (key === 'strip') min = INTERVAL_CLAMP_MS.stripMin;
  return Math.min(INTERVAL_CLAMP_MS.max, Math.max(min, Math.round(n)));
}

function mergeBoolMap(defaults, incoming) {
  const out = { ...defaults };
  if (!incoming || typeof incoming !== 'object') return out;
  for (const key of Object.keys(defaults)) {
    if (typeof incoming[key] === 'boolean') out[key] = incoming[key];
  }
  return out;
}

/**
 * Normalize a partial config into a full clamped document.
 * Unknown keys are dropped; missing keys fill from defaults.
 */
export function normalizeManagerConfig(raw = {}) {
  const base = defaultManagerConfig();
  const src = raw && typeof raw === 'object' ? raw : {};

  const intervalsMs = { ...base.intervalsMs };
  if (src.intervalsMs && typeof src.intervalsMs === 'object') {
    for (const key of Object.keys(base.intervalsMs)) {
      if (src.intervalsMs[key] != null) {
        intervalsMs[key] = clampInterval(key, src.intervalsMs[key]);
      }
    }
  }

  const sources = {
    social: mergeBoolMap(base.sources.social, src.sources?.social),
    place: {
      format: src.sources?.place?.format === 'firewire' ? 'firewire' : 'native',
      demoFixtures:
        typeof src.sources?.place?.demoFixtures === 'boolean'
          ? src.sources.place.demoFixtures
          : base.sources.place.demoFixtures,
    },
    board: mergeBoolMap(base.sources.board, src.sources?.board),
    liveatc: {
      links:
        typeof src.sources?.liveatc?.links === 'boolean'
          ? src.sources.liveatc.links
          : base.sources.liveatc.links,
      proxy:
        typeof src.sources?.liveatc?.proxy === 'boolean'
          ? src.sources.liveatc.proxy
          : base.sources.liveatc.proxy,
      mounts: mergeBoolMap(
        base.sources.liveatc.mounts,
        src.sources?.liveatc?.mounts,
      ),
    },
  };

  const atcIn = src.ai?.atc && typeof src.ai.atc === 'object' ? src.ai.atc : {};
  const listOr = (value, fallback) =>
    Array.isArray(value)
      ? value
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 200)
      : [...fallback];

  const ai = {
    briefOverride:
      typeof src.ai?.briefOverride === 'string'
        ? src.ai.briefOverride.slice(0, 8_000)
        : '',
    askOverride:
      typeof src.ai?.askOverride === 'string'
        ? src.ai.askOverride.slice(0, 8_000)
        : '',
    notes: base.ai.notes,
    atc: {
      enabled: atcIn.enabled !== false,
      emergencyLexicon: listOr(
        atcIn.emergencyLexicon,
        base.ai.atc.emergencyLexicon,
      ),
      squawkCodes: listOr(atcIn.squawkCodes, base.ai.atc.squawkCodes),
      phraseology: listOr(atcIn.phraseology, base.ai.atc.phraseology),
      callSigns: listOr(atcIn.callSigns, base.ai.atc.callSigns),
      promptOverride:
        typeof atcIn.promptOverride === 'string'
          ? atcIn.promptOverride.slice(0, 8_000)
          : '',
      cooldownSec: Math.min(
        3600,
        Math.max(5, Number(atcIn.cooldownSec) || base.ai.atc.cooldownSec),
      ),
    },
  };

  return {
    version: CONFIG_VERSION,
    viewability: mergeBoolMap(base.viewability, src.viewability),
    placeSections: mergeBoolMap(base.placeSections, src.placeSections),
    intervalsMs,
    sources,
    globe: {
      stripEnabled:
        typeof src.globe?.stripEnabled === 'boolean'
          ? src.globe.stripEnabled
          : base.globe.stripEnabled,
      stripSections: mergeBoolMap(
        base.globe.stripSections,
        src.globe?.stripSections,
      ),
      layers: mergeBoolMap(base.globe.layers, src.globe?.layers),
    },
    approvals: mergeBoolMap(base.approvals, src.approvals),
    permissions: mergeBoolMap(base.permissions, src.permissions),
    ai,
    updatedAt:
      typeof src.updatedAt === 'string' ? src.updatedAt : base.updatedAt,
    clamps: { ...INTERVAL_CLAMP_MS },
  };
}
