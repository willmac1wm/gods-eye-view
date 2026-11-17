/**
 * Voice manifest for every data layer the application catalog constructs.
 *
 * One plain-data entry per layer declares each voice capability separately:
 * the spoken aliases the action runner accepts, `toggle` (set_layer_visibility),
 * `context` (registers in-view entity context), `track` (track_entity), and
 * `query` — the analyst_query fields with type and unit — or `noQuery`, the
 * reason it has none. No layer has a voice timeline yet.
 *
 * Both the server tool builder (`actionSchemas.js` → the Realtime tool JSON)
 * and the browser runner (`gevActions.js`) derive their layer enums and alias
 * tables from here, so a new layer is reachable by voice as soon as it has an
 * entry. `layerManifest.test.mjs` fails when a catalog layer is neither listed
 * nor named in `VOICE_OFF_LAYERS`.
 *
 * Pure data: no Cesium, DOM or Node imports (the server imports this module).
 * @module voice/layerManifest
 */

/**
 * Field type shorthands: n = number, t = text, f = flag (boolean),
 * ms = epoch-milliseconds time (filters also accept ISO strings).
 * A second array element is the unit.
 */
const AIRCRAFT_FIELDS = {
  altitudeM: ['n', 'm'],
  speedMps: ['n', 'm/s'],
  verticalRateMps: ['n', 'm/s'],
  heading: ['n', 'deg'],
  callsign: ['t'],
  icao24: ['t'],
  originCountry: ['t'],
  operator: ['t'],
  aircraftClass: ['t'],
  military: ['f'],
  onGround: ['f'],
  squawk: ['t'],
  emergency: ['f'],
  emergencyKind: ['t'],
  emergencySource: ['t'],
  emergencyBroadcast: ['t'],
  lastContactAtMs: ['ms'],
};

const layers = [
  {
    id: 'gnss-integrity',
    aliases: [
      'gnss integrity',
      'navigation integrity',
      'low navigation accuracy',
      'gnss interference',
      'gps interference',
      'gps jamming',
      'gnss',
    ],
    context: false,
    noQuery: 'navigation-integrity cells; no countable analyst records',
  },
  {
    id: 's2-ghostmaps',
    aliases: [
      's2 ghostmaps',
      'ghost maps',
      'ghostmaps',
      's2 underground',
      's2 intel',
      'intel picture',
      'common intelligence picture',
    ],
    context: false,
    noQuery: 'published third-party intel placemarks; not analyst records',
  },
  {
    id: 'sea-marks',
    aliases: ['seamarks', 'nautical charts', 'buoys', 'openseamap'],
    context: false,
    noQuery: 'raster tile overlay; no countable records',
  },
  {
    id: 'ski-pistes',
    aliases: ['ski slopes', 'ski runs', 'snow map', 'opensnowmap'],
    context: false,
    noQuery: 'raster tile overlay; no countable records',
  },
  {
    id: 'flights',
    track: true,
    aliases: ['planes', 'aircraft', 'air traffic'],
    context: false,
    query: {
      fields: {
        ...AIRCRAFT_FIELDS,
        routeOrigin: ['t'],
        routeDestination: ['t'],
      },
      viewportLoaded: true,
    },
  },
  {
    id: 'military',
    track: true,
    aliases: ['military flights', 'military aircraft', 'military planes'],
    context: false,
    query: { fields: AIRCRAFT_FIELDS },
  },
  {
    id: 'local-adsb',
    aliases: [
      'my receiver',
      'local adsb',
      'local ads-b',
      'my antenna',
      'my sdr',
    ],
    context: true,
    query: {
      fields: {
        altitudeM: ['n', 'm'],
        speedKts: ['n', 'kn'],
        heading: ['n', 'deg'],
        callsign: ['t'],
        icao24: ['t'],
        onGround: ['f'],
      },
    },
  },
  {
    id: 'ais-live-vessels',
    track: true,
    aliases: ['ships', 'vessels', 'boats', 'ais', 'live vessels'],
    context: true,
    query: {
      fields: {
        speedKts: ['n', 'kn'],
        courseDeg: ['n', 'deg'],
        name: ['t'],
        mmsi: ['t'],
        shipType: ['t'],
        destination: ['t'],
      },
    },
  },
  {
    id: 'satellites',
    track: true,
    aliases: ['satellite', 'sats'],
    context: false,
    query: {
      fields: {
        altitudeM: ['n', 'm'],
        speedMps: ['n', 'm/s'],
        name: ['t'],
        noradId: ['t'],
        satelliteClass: ['t'],
        group: ['t'],
      },
      caveat: 'distance is ground distance, not overhead',
    },
  },
  {
    id: 'rocket-launches',
    aliases: [
      'rocket launches',
      'launches',
      'space missions',
      'space mission',
      'missions',
    ],
    context: false,
    query: {
      fields: {
        name: ['t'],
        provider: ['t'],
        status: ['t'],
        launchSite: ['t'],
        missionName: ['t'],
        launchTimeMs: ['ms'],
        hoursUntil: ['n', 'h'],
      },
      window: 'past 30 d and upcoming',
    },
  },
  {
    id: 'nws-alerts',
    aliases: ['weather alerts', 'nws alerts', 'warnings', 'advisories'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'tide-gauges',
    aliases: ['tide gauges', 'flood gauges', 'tides', 'water levels'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'power-outages',
    aliases: ['power outages', 'outages', 'blackouts'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'traffic-incidents',
    aliases: ['traffic incidents', 'crashes', 'road closures', 'accidents'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'emergency-facilities',
    aliases: [
      'hospitals',
      'fire stations',
      'police stations',
      'emergency facilities',
    ],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'marine-buoys',
    aliases: ['marine buoys', 'ndbc buoys', 'wave height'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'airport-weather',
    aliases: ['airport weather', 'metar', 'metars'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'whale-zones',
    aliases: ['whale zones', 'right whale zones', 'speed zones'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'military-areas',
    aliases: ['military areas', 'coast guard areas', 'uscg areas'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'community-reports',
    aliases: ['community reports', 'resident reports'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'predicted-flooding',
    aliases: ['predicted flooding', 'flood estimate', 'flood prediction'],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'sar-flood',
    aliases: ['flood map', 'radar flood', 'flooding', 'sentinel', 'new water'],
    context: false,
    noQuery: 'map overlay; one radar pass image',
  },
  {
    id: 'airport-radio',
    aliases: [
      'airport radio',
      'atc',
      'air traffic control',
      'tower radio',
      'kacy',
    ],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'scanner-calls',
    aliases: [
      'scanner',
      '911 calls',
      'dispatch calls',
      'police scanner',
      'fire calls',
      'ems calls',
    ],
    context: false,
    query: {
      fields: {
        title: ['t'],
        status: ['t'],
        source: ['t'],
        observedAt: ['t'],
      },
    },
  },
  {
    id: 'earthquakes',
    aliases: ['quakes', 'seismic'],
    context: false,
    query: {
      fields: {
        magnitude: ['n'],
        depthKm: ['n', 'km'],
        place: ['t'],
        timeMs: ['ms'],
      },
      timeField: 'timeMs',
      window: 'last 24 h',
    },
  },
  {
    id: 'faa-status',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per local airport
    // event) is built and tested; flip toggle on and add aliases when
    // headroom is reclaimed.
    noQuery:
      'airport ground stops, delays and closures; local events shown on the panel and map, only local airport events are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'tides',
    // Voice reaches tides through the local Tide & Flood Gauges layer
    // (tide-gauges), which owns these words. This CO-OPS layer stays an
    // analyst source, without a second toggle for the same thing.
    aliases: [],
    toggle: false,
    context: false,
    query: {
      fields: {
        observedFtMllw: ['n', 'ft'],
        predictedFtMllw: ['n', 'ft'],
        residualFt: ['n', 'ft'],
        floodStage: ['t'],
        trend: ['t'],
        station: ['t'],
        timeMs: ['ms'],
      },
      timeField: 'timeMs',
      window: 'last 30 min',
    },
  },
  {
    id: 'outages',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per outage area)
    // is built and tested; flip toggle on and add aliases when headroom
    // is reclaimed.
    noQuery:
      'power outages by municipality; area counts shown on the panel and map, only outage areas are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'fuel-prices',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per fuel series)
    // is built and tested; flip toggle on and add aliases when headroom
    // is reclaimed.
    noQuery:
      'weekly fuel prices by series; ticker values shown on the panel and map, only price series are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'water-gauges',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per gauge
    // reading) is built and tested; flip toggle on and add aliases when
    // headroom is reclaimed.
    noQuery:
      'river gauge readings; heights and flows shown on the panel and map, only gauge readings are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'surveillance-cameras',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per camera) is
    // built and tested; flip toggle on and add aliases when headroom is
    // reclaimed.
    noQuery:
      'surveillance camera locations; positions and types shown on the panel and map, only camera locations are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'disaster-history',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per declaration)
    // is built and tested; flip toggle on and add aliases when headroom
    // is reclaimed.
    noQuery:
      'federal disaster declarations and past storm events; declarations and storm history shown on the panel and map, only declarations are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'traffic-cameras',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per camera) is
    // built and tested; flip toggle on and add aliases when headroom is
    // reclaimed.
    noQuery:
      'live traffic camera stills; camera positions and stills shown on the panel and map, only camera positions are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'nws-alert-card',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per alert) is
    // built and tested; flip toggle on and add aliases when headroom is
    // reclaimed.
    noQuery:
      'National Weather Service alerts in plain English; alert types, plain-language glosses and NWS instructions shown on the panel and map, only alerts are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'space-weather',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per Kp reading)
    // is built and tested; flip toggle on and add aliases when headroom
    // is reclaimed.
    noQuery:
      'space weather and Kp index; current Kp, forecast and solar wind shown on the panel and map, only Kp readings are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'drought',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record for the county)
    // is built and tested; flip toggle on and add aliases when headroom
    // is reclaimed.
    noQuery:
      'drought conditions; the county drought category shown on the panel and map, only the county reading is a countable analyst record — no room in the prompt budget',
  },
  {
    id: 'radiation',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per monitor) is
    // built and tested; flip toggle on and add aliases when headroom is
    // reclaimed.
    noQuery:
      'regional radiation background; the nearest EPA monitor readings shown on the panel and map, only monitor readings are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'sanctions-watch',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per flagged
    // vessel) is built and tested; flip toggle on and add aliases when
    // headroom is reclaimed.
    noQuery:
      'sanctions and dark-vessel watch; flagged vessels with AIS dark-vessel signals and ArcNautical screening outcomes shown on the panel and map, only flagged vessels are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'fishing-activity',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per fishing
    // vessel present) is built and tested; flip toggle on and add
    // aliases when headroom is reclaimed.
    noQuery:
      'fishing-vessel presence; fishing vessels present in the county box from AIS, plus the Global Fishing Watch map link-out, only fishing vessels present are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'gdacs-hazards',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per GDACS event)
    // is built and tested; flip toggle on and add aliases when headroom
    // is reclaimed.
    noQuery:
      'global disaster alerts; GDACS earthquakes, cyclones, floods, droughts, wildfires, volcanoes and tsunamis with GDACS alert levels, only GDACS events are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'internet-outages',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per IODA alert or
    // summary row) is built and tested; flip toggle on and add aliases
    // when headroom is reclaimed.
    noQuery:
      'internet outages; IODA outage alerts and summaries for the US, New Jersey and worldwide, only IODA alerts and summaries are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'hifld-installations',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per MIRTA site)
    // is built and tested; flip toggle on and add aliases when headroom
    // is reclaimed.
    noQuery:
      'military installations; HIFLD MIRTA DoD sites snapshot (frozen August 25, 2023, not live), only MIRTA sites are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'outbreaks',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per ArboNET row
    // or WHO DON item) is built and tested; flip toggle on and add
    // aliases when headroom is reclaimed.
    noQuery:
      'outbreaks; CDC ArboNET West Nile state and New Jersey county rows plus WHO Disease Outbreak News headlines, only ArboNET rows and DON items are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'fallout-plume',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per plume wind
    // row or path node) is built and tested; flip toggle on and add
    // aliases when headroom is reclaimed.
    noQuery:
      'fallout plume; NWS wind plume from Salem/Hope Creek (advection only, not a HYSPLIT run), only plume wind rows and path nodes are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'vessel-info',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per vessel
    // background) is built and tested; flip toggle on and add aliases
    // when headroom is reclaimed.
    noQuery:
      'vessel background; identity fields from AIS plus Equasis and Maritime Database reference links for vessels in the feed, only vessel backgrounds are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'navarea-warnings',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per warning) is
    // built and tested; flip toggle on and add aliases when headroom is
    // reclaimed.
    noQuery:
      'navigational warnings; NAVAREA IV warnings in force from NGA, only warnings in force are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'ports',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per port or
    // chokepoint) is built and tested; flip toggle on and add aliases
    // when headroom is reclaimed.
    noQuery:
      'ports and chokepoints; Mid-Atlantic ports from the NGA World Port Index snapshot plus nine global chokepoints, only ports and chokepoints are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'aprs-weather',
    aliases: ['aprs', 'cwop', 'weather stations', 'station weather'],
    context: false,
    // No analyst_query coverage: the Realtime prompt ceiling (55,500 chars,
    // "a new tool or rule has to fit under this ceiling") had 59 chars of
    // headroom when this layer landed, and a queryable layer costs ~205
    // (field hint + layer enums). Six stations' readings are panel/map
    // data; the analyst seam (mapAnalystRecord / getAnalystRecords) is
    // built and tested, so the query can be added if headroom is reclaimed.
    // Toggle and aliases still work: the layer is voice-toggleable.
    noQuery:
      'six weather stations; readings shown on the panel and map, no countable analyst records — no room in the prompt budget',
  },
  {
    id: 'marine-warnings',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when this
    // layer landed, and even a bare toggle costs 36 (the layer id in two
    // tool enums) — a noQuery toggle + aliases entry costs 76 and breaks
    // integrationContract's budget test. The layer stays in the manifest
    // (not VOICE_OFF_LAYERS) so the analyst seam (mapAnalystRecord /
    // getAnalystRecords, positioned rows only) is built and tested; flip
    // toggle on and add aliases when headroom is reclaimed. Same bind as
    // drone-airspace / sigmet in VOICE_OFF_LAYERS, kept here because the
    // seam exists.
    noQuery:
      'coast guard broadcast notices to mariners; list-first panel data, only positioned warnings are countable analyst records — no room in the prompt budget',
  },
  {
    id: 'satnogs',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per observation,
    // positioned at its ground station) is built and tested; flip toggle
    // on and add aliases when headroom is reclaimed. Same bind as
    // marine-warnings above.
    noQuery:
      'satellite observations heard by nearby ground stations; station-first panel data, one analyst record per observation — no room in the prompt budget',
  },
  {
    id: 'gpsjam-daily',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per H3 cell,
    // positioned at its centroid) is built and tested; flip toggle on
    // and add aliases when headroom is reclaimed. Same bind as
    // marine-warnings / satnogs above.
    noQuery:
      'daily published GNSS interference aggregate; one analyst record per H3 cell, positioned at its centroid — no room in the prompt budget',
  },
  {
    id: 'vdl2',
    aliases: [],
    toggle: false,
    context: false,
    // No voice toggle, aliases, or analyst_query coverage: the Realtime
    // prompt ceiling (55,500 chars) had 11 chars of headroom when the
    // marine-warnings layer landed, and even a bare toggle costs 36 (the
    // layer id in two tool enums) — a noQuery toggle + aliases entry
    // costs 76 and breaks integrationContract's budget test. The layer
    // stays in the manifest (not VOICE_OFF_LAYERS) so the analyst seam
    // (mapAnalystRecord / getAnalystRecords, one record per categorized
    // message or local undecoded frame, positioned at its flight fix
    // when the fix falls over local airspace) is built and tested; flip
    // toggle on and add aliases when headroom is reclaimed. Same bind
    // as marine-warnings / satnogs / gpsjam-daily above.
    noQuery:
      'categorized VDL2 datalink messages heard by the Philadelphia feeder; one analyst record per categorized message or local undecoded frame — no room in the prompt budget',
  },
  {
    id: 'local-firms',
    aliases: ['fires', 'wildfires', 'active fires', 'firms'],
    context: true,
    query: {
      fields: {
        frp: ['n', 'MW'],
        confidence: ['n', '0-1'],
        satellite: ['t'],
        sensor: ['t'],
        acqTime: ['ms'],
      },
      timeField: 'acqTime',
      window: 'last 24 h',
    },
  },
  {
    id: 'fire-perimeters',
    aliases: [
      'fire perimeters',
      'wildfire perimeters',
      'burn areas',
      'perimeters',
    ],
    context: false,
    query: {
      fields: {
        acres: ['n', 'acres'],
        containedPct: ['n', '%'],
        personnel: ['n'],
        costToDate: ['n', 'USD'],
        name: ['t'],
        state: ['t'],
        county: ['t'],
        cause: ['t'],
        behavior: ['t'],
        complexity: ['t'],
        discoveredTime: ['ms'],
      },
      timeField: 'discoveredTime',
    },
  },
  {
    id: 'weather-cyclones',
    aliases: ['cyclones', 'hurricanes', 'typhoons', 'tropical storms'],
    context: false,
    query: {
      fields: {
        name: ['t'],
        classification: ['t'],
        basin: ['t'],
        windKt: ['n', 'kn'],
        pressureHpa: ['n', 'hPa'],
      },
    },
  },
  {
    id: 'weather-radar',
    aliases: ['weather radar', 'radar', 'rain', 'weather'],
    context: false,
    noQuery: 'map overlay; no countable records',
  },
  {
    id: 'weather-satellite',
    aliases: ['weather satellite', 'clouds', 'cloud imagery'],
    context: false,
    noQuery: 'map overlay; no countable records',
  },
  {
    id: 'weather-lightning',
    aliases: ['lightning', 'lightning strikes'],
    context: false,
    noQuery: 'map overlay; no countable records',
  },
  {
    id: 'wind',
    aliases: ['winds', 'wind map'],
    context: false,
    noQuery: 'map overlay; no countable records',
  },
  {
    id: 'air-quality',
    aliases: ['air quality', 'aqhi', 'smog', 'air pollution'],
    context: false,
    query: {
      fields: {
        value: ['n', 'AQHI'],
        band: ['t'],
        scale: ['t'],
        provider: ['t'],
        name: ['t'],
        zone: ['t'],
        risk: ['t'],
        observedMs: ['ms'],
      },
      timeField: 'observedMs',
    },
  },
  {
    id: 'traffic',
    aliases: ['street traffic', 'road traffic', 'congestion'],
    context: false,
    noQuery: 'road-speed overlay; no countable records',
  },
  {
    id: 'transit',
    aliases: ['buses', 'trains', 'public transit', 'trams', 'subway'],
    context: false,
    query: {
      fields: {
        mode: ['t'],
        routeId: ['t'],
        speedMps: ['n', 'm/s'],
        courseDeg: ['n', 'deg'],
        status: ['t'],
        occupancy: ['t'],
      },
    },
  },
  {
    id: 'bikeshare',
    aliases: ['bike share', 'bikes', 'bike stations'],
    context: false,
    query: {
      fields: {
        bikesAvailable: ['n'],
        docksAvailable: ['n'],
        capacity: ['n'],
        name: ['t'],
        city: ['t'],
        renting: ['f'],
      },
    },
  },
  {
    id: 'cctv',
    aliases: ['traffic cameras', 'cameras', 'webcams'],
    context: false,
    noQuery: 'use control_cctv',
  },
  {
    id: 'alpr-cameras',
    aliases: [
      'flock cameras',
      'license plate readers',
      'alpr',
      'alpr cameras',
      'license plate cameras',
      'plate readers',
    ],
    context: true,
    query: {
      fields: {
        operator: ['t'],
        manufacturer: ['t'],
        cameraType: ['t'],
        directionDeg: ['n', 'deg'],
      },
    },
  },
  {
    id: 'radio',
    aliases: ['internet radio', 'radio stations'],
    context: false,
    noQuery: 'use control_radio',
  },
  {
    id: 'street-level',
    aliases: ['street level', 'street-level imagery', 'mapillary'],
    context: false,
    noQuery: 'street-level imagery; no countable records',
  },
  {
    id: 'recent-imagery',
    aliases: [
      'recent satellite imagery',
      'recent imagery',
      'latest imagery',
      'new imagery',
    ],
    context: false,
    noQuery: 'imagery tiles; no countable records',
  },
  {
    id: 'directions',
    aliases: ['driving directions', 'directions panel'],
    context: false,
    noQuery: 'use annotate_map type=route',
  },
  {
    id: 'military-installations',
    aliases: ['military bases', 'bases', 'installations'],
    context: true,
    query: { fields: { name: ['t'], class: ['t'], kind: ['t'] } },
  },
  {
    id: 'local-datacenters',
    aliases: ['datacenters', 'data centers', 'data centres'],
    context: true,
    query: {
      fields: { name: ['t'], operator: ['t'], capacity: ['t'] },
    },
  },
  {
    id: 'local-dams',
    aliases: ['dams'],
    context: true,
    query: {
      fields: {
        name: ['t'],
        operator: ['t'],
        river: ['t'],
        output: ['t'],
      },
    },
  },
  {
    id: 'telegeography-submarine-cables',
    aliases: ['submarine cables', 'undersea cables', 'cables', 'telegeography'],
    context: false,
    noQuery: 'cable records are not loaded for queries',
  },
  {
    // Results of the last osm_query ("hospitals in Kathmandu").
    id: 'osm-places',
    aliases: ['osm places', 'map search results', 'search results'],
    context: false,
    query: {
      fields: {
        name: ['t'],
        kind: ['t'],
        operator: ['t'],
        emergency: ['t'],
        wheelchair: ['t'],
        openingHours: ['t'],
        city: ['t'],
      },
    },
  },
  {
    // Global Context owns this layer; voice reaches it through
    // set_context_mode, never a bare toggle.
    id: 'military-awareness',
    aliases: [],
    toggle: false,
    context: false,
    noQuery: 'use set_context_mode contacts',
  },
];

/**
 * Catalog layers deliberately outside voice, with the reason. The Bhote Koshi
 * pair belong to a scripted scene and are driven by `control_scene`.
 */
export const VOICE_OFF_LAYERS = Object.freeze({
  'bhote-koshi-2026': 'scene-driven event layer (control_scene)',
  'bhote-koshi-locator': 'scene-driven event layer (control_scene)',
  // The Realtime prompt is at its 55,500-character budget; voice toggle and
  // query for this layer wait until there is room.
  'drone-airspace':
    'informational airspace layer; no room in the prompt budget',
  'wildlife-sightings':
    'community observation layer; no room in the prompt budget',
  sigmet: 'informational SIGMET polygons; no room in the prompt budget',
  'cape-airports': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-buoys': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-cad': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-cameras': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-flood': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-nws': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-outages': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-radio': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-tfrs': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-tomtom': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-webcams': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-whales': 'Cape May Dispatch feed; regional status, not a voice tool',
  'cape-wind': 'Cape May Dispatch feed; regional status, not a voice tool',
});

const TYPE_NAMES = Object.freeze({
  n: 'number',
  t: 'text',
  f: 'flag',
  ms: 'time',
});

function normalizeEntry(entry) {
  const fields = entry.query
    ? Object.fromEntries(
        Object.entries(entry.query.fields).map(([name, [type, unit]]) => [
          name,
          Object.freeze({
            type: TYPE_NAMES[type],
            ...(unit ? { unit } : {}),
          }),
        ]),
      )
    : null;
  return Object.freeze({
    id: entry.id,
    aliases: Object.freeze([...entry.aliases]),
    toggle: entry.toggle !== false,
    context: entry.context === true,
    track: entry.track === true,
    noQuery: entry.noQuery || null,
    query: fields
      ? Object.freeze({
          fields: Object.freeze(fields),
          timeField: entry.query.timeField || null,
          window: entry.query.window || null,
          caveat: entry.query.caveat || null,
          viewportLoaded: entry.query.viewportLoaded === true,
        })
      : null,
  });
}

/** Every voice-reachable layer, in the order the tool enums list them. */
export const VOICE_LAYER_MANIFEST = Object.freeze(layers.map(normalizeEntry));

const byId = new Map(VOICE_LAYER_MANIFEST.map((entry) => [entry.id, entry]));

/**
 * The manifest entry for one layer id.
 * @param {string} id Layer id.
 * @returns {object|null} Entry, or null for an unknown or voice-off layer.
 */
export function voiceLayer(id) {
  return byId.get(id) || null;
}

/** Layer ids `set_layer_visibility` and `show_data_layers_menu` accept. */
export const VOICE_TOGGLE_LAYER_IDS = Object.freeze(
  VOICE_LAYER_MANIFEST.filter((entry) => entry.toggle).map((entry) => entry.id),
);

/** Layers that register in-view entity context (`get_entity_context.layerId`). */
export const VOICE_CONTEXT_LAYER_IDS = Object.freeze(
  VOICE_LAYER_MANIFEST.filter((entry) => entry.context).map(
    (entry) => entry.id,
  ),
);

/** Layers `analyst_query` can count, filter and rank. */
export const VOICE_QUERY_LAYER_IDS = Object.freeze(
  VOICE_LAYER_MANIFEST.filter((entry) => entry.query).map((entry) => entry.id),
);

/**
 * Spoken name → layer id, for the browser runner. Ids map to themselves and
 * each alias to its layer; the first layer to claim an alias keeps it.
 * @returns {Map<string, string>} Lower-case phrase → layer id.
 */
export function voiceLayerAliasMap() {
  const map = new Map();
  for (const entry of VOICE_LAYER_MANIFEST) {
    map.set(entry.id, entry.id);
    map.set(entry.id.replace(/-/g, ' '), entry.id);
  }
  for (const entry of VOICE_LAYER_MANIFEST) {
    for (const alias of entry.aliases) {
      const key = alias.toLowerCase();
      if (!map.has(key)) map.set(key, entry.id);
    }
  }
  return map;
}

/** Plain-word ids the model already maps from speech without a hint. */
const SELF_EVIDENT_IDS = new Set([
  'flights',
  'military',
  'satellites',
  'earthquakes',
  'traffic',
  'radio',
  'wind',
  'directions',
]);

/** Lower case with spaces and hyphens removed: "Data centers" → "datacenters". */
const spelled = (text) => text.toLowerCase().replace(/[\s-]+/g, '');

/**
 * Compact model-facing alias hint: "alias/alias→id; …" for toggleable layers
 * whose id is not already the spoken word. At most two aliases per layer keep
 * the tool JSON small; the runner accepts the full alias list. Of those two,
 * an alias the id already spells ("dams"→local-dams, "weather radar"→
 * weather-radar) is left out, and a layer with neither left gets no hint.
 * @returns {string} One line for the layerId description.
 */
export function voiceLayerAliasHint() {
  return VOICE_LAYER_MANIFEST.filter(
    (entry) => entry.toggle && !SELF_EVIDENT_IDS.has(entry.id),
  )
    .map((entry) => ({
      id: entry.id,
      aliases: entry.aliases
        .slice(0, 2)
        .filter((alias) => !spelled(entry.id).includes(spelled(alias))),
    }))
    .filter((entry) => entry.aliases.length)
    .map((entry) => `${entry.aliases.join('/')}→${entry.id}`)
    .join(';');
}

/** Field names that already carry their unit (altitudeM, speedKts, …). */
const UNIT_SUFFIX = /(M|Mps|Kts|Kt|Km|Deg|Hpa)$/;

/**
 * Compact field list for the analyst_query description:
 * "flights: altitudeM,speedMps,…,confidence(0-1)". Units appear only where
 * the field name does not already say them.
 * @returns {string} One clause per queryable layer.
 */
export function voiceQueryFieldHint() {
  const printed = [];
  return VOICE_LAYER_MANIFEST.filter((entry) => entry.query)
    .map((entry) => {
      const names = Object.keys(entry.query.fields);
      // A layer whose fields are a subset of an earlier one's points at it.
      const parent = printed.find((prior) =>
        names.every((name) => prior.names.includes(name)),
      );
      printed.push({ id: entry.id, names });
      if (parent) {
        const minus = parent.names.filter((name) => !names.includes(name));
        return `${entry.id}: as ${parent.id}${minus.length ? ` minus ${minus.join(',')}` : ''}`;
      }
      const fields = Object.entries(entry.query.fields)
        .map(([name, spec]) =>
          spec.unit && !UNIT_SUFFIX.test(name) ? `${name}(${spec.unit})` : name,
        )
        .join(',');
      return `${entry.id}: ${fields}`;
    })
    .join('; ');
}
