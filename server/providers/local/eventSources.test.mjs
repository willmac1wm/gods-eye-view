/**
 * The event-log adapters against the shapes the real feeds send. Every
 * record below is a trimmed copy of a live answer (adsb.lol /v2/mil, the
 * site's airport-weather, tide-gauges and power-outages envelopes) taken
 * on 2026-11-19; nothing here touches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HPA_PER_INHG,
  aircraftObservations,
  aircraftPoint,
  vipWhere,
  altimeterFor,
  altimeterStations,
  altitudeText,
  capeMayOutages,
  coastGuardType,
  faaDelayText,
  faaObservations,
  floodObservations,
  indicatedAltitude,
  outageObservations,
  roadsIn,
} from './eventSources.js';

/** adsb.lol /v2/mil "now" for the records below (2026-11-19 13:39 ET). */
const MIL_NOW = 1795113547501;

const MIL = {
  // Two Coast Guard MH-65s hovering off Ocean City on a 30.40 day: their
  // pressure altitude (alt_baro) is below zero.
  c6605: {
    hex: 'ae26bc',
    type: 'adsb_icao',
    flight: 'C6605   ',
    r: '6605',
    t: 'AS65',
    dbFlags: 1,
    alt_baro: -400,
    alt_geom: -100,
    gs: 2.9,
    track: 225,
    squawk: '4432',
    category: 'A7',
    lat: 39.268954,
    lon: -74.540771,
    seen: 0,
    seen_pos: 0.005,
  },
  c6542: {
    hex: 'ae2683',
    type: 'adsb_icao',
    flight: 'C6542   ',
    r: '6542',
    t: 'AS65',
    dbFlags: 1,
    alt_baro: -325,
    alt_geom: 0,
    gs: 2.9,
    track: 135,
    squawk: '4441',
    category: 'A7',
    lat: 39.297258,
    lon: -74.520691,
    seen: 0,
    seen_pos: 0.718,
  },
  // An Army National Guard Black Hawk: H60, but a fiscal-year serial.
  armyH60: {
    hex: 'ae4792',
    type: 'adsb_icao',
    flight: 'G20132  ',
    r: '08-20132',
    t: 'H60',
    dbFlags: 1,
    alt_baro: 200,
    alt_geom: 225,
    gs: 25.6,
    nav_qnh: 1013.6,
    lat: 44.920303,
    lon: -123.007311,
    seen: 0.2,
    seen_pos: 0.372,
  },
  // A Coast Guard HC-27J still carrying its old Air Force serial: the
  // callsign is what says Coast Guard.
  c2702: {
    hex: 'ae2126',
    type: 'adsb_icao',
    flight: 'C2702   ',
    r: '07-27011',
    t: 'C27J',
    dbFlags: 1,
    alt_baro: 23000,
    gs: 234,
    nav_qnh: 1013.6,
    lat: 37.496979,
    lon: -120.158873,
    seen: 0,
    seen_pos: 0.333,
  },
  sam837: {
    hex: 'ae11f8',
    type: 'mlat',
    flight: 'SAM837  ',
    r: '02-0042',
    t: 'B737',
    dbFlags: 1,
    alt_baro: 34000,
    gs: 426,
    track: 212,
    squawk: '6020',
    lat: 42.187372,
    lon: -70.020903,
    seen: 0.1,
    seen_pos: 3.028,
  },
  // On the ramp at Air Station Boston (ground flag), far outside the county.
  c6031Ground: {
    hex: 'ae290e',
    type: 'adsb_icao',
    flight: 'C6031   ',
    r: '6031',
    t: 'H60',
    dbFlags: 1,
    alt_baro: 'ground',
    gs: 0,
    lat: 42.336433,
    lon: -71.106793,
    seen: 0.9,
    seen_pos: 0.921,
  },
  // Coast Guard by type and 4-digit tail, heard but with only a stale
  // (62 s old) last position: no position to judge.
  cg6036NoPosition: {
    hex: 'ae2913',
    type: 'adsb_icao',
    r: '6036',
    t: 'H60',
    dbFlags: 1,
    alt_baro: -50,
    alt_geom: -50,
    category: 'A7',
    seen: 3.1,
    lastPosition: {
      lat: 27.791794,
      lon: -82.561427,
      nic: 10,
      rc: 25,
      seen_pos: 62.364,
    },
  },
  // From the same feed earlier that day.
  norwayC30J: {
    hex: '478116',
    type: 'adsb_icao',
    flight: '105629  ',
    r: '5629',
    t: 'C30J',
    dbFlags: 1,
    alt_baro: 4125,
    nav_qnh: 987.2,
    lat: 60.277267,
    lon: 11.112103,
    seen: 0,
    seen_pos: 0.191,
  },
  usmcKC130J: {
    hex: 'ae6c24',
    type: 'adsb_icao',
    flight: 'HRCLS88 ',
    r: '170288',
    t: 'C30J',
    dbFlags: 1,
    alt_baro: 23000,
    lat: 21.681565,
    lon: -158.92512,
    seen: 0.1,
    seen_pos: 0.134,
  },
  sam834: {
    hex: 'ae0945',
    type: 'mlat',
    flight: 'SAM834  ',
    r: '01-0040',
    t: 'B737',
    dbFlags: 1,
    alt_baro: 34975,
    gs: 518,
    lat: 38.889899,
    lon: -102.856651,
    seen: 1,
    seen_pos: 1.028,
  },
};

/** The site's airport-weather envelope (METARs), two of its 18 stations. */
const AIRPORT_WEATHER = {
  status: 'live',
  fetchedAt: MIL_NOW - 20 * 60_000,
  features: [
    {
      id: 'metar:KACY',
      kind: 'airport-weather',
      geometry: { type: 'Point', lat: 39.452, lon: -74.567 },
      title: 'KACY · Atlantic City Intl',
      icao: 'KACY',
      status: 'observed',
      observedAt: '2026-11-19T17:54:00.000Z',
      altimeterInHg: 30.4,
    },
    {
      id: 'metar:KWWD',
      kind: 'airport-weather',
      geometry: { type: 'Point', lat: 39.0108, lon: -74.9079 },
      title: 'KWWD · Wildwood/Cape May Cnty',
      icao: 'KWWD',
      status: 'observed',
      observedAt: '2026-11-19T17:56:00.000Z',
      altimeterInHg: 30.41,
    },
  ],
};

test('real /v2/mil records: Coast Guard by callsign or type + 4-digit tail, U.S. addresses only', () => {
  assert.equal(coastGuardType(MIL.c6605), 'MH-65');
  assert.equal(coastGuardType(MIL.c2702), 'HC-27J');
  assert.equal(coastGuardType(MIL.c6031Ground), 'MH-60T');
  assert.equal(coastGuardType(MIL.cg6036NoPosition), 'MH-60T');
  assert.equal(coastGuardType(MIL.armyH60), null, 'Army Black Hawk');
  assert.equal(coastGuardType(MIL.usmcKC130J), null, 'Marine KC-130J');
  assert.equal(
    coastGuardType(MIL.norwayC30J),
    null,
    'a 4-digit tail on a non-U.S. address',
  );
  assert.equal(coastGuardType(MIL.sam837), null);
  // A last position older than a minute is not a position.
  assert.equal(aircraftPoint(MIL.cg6036NoPosition), null);
  assert.deepEqual(aircraftPoint(MIL.c6605), {
    lat: 39.268954,
    lon: -74.540771,
  });
});

test('pressure altitude is read with the local altimeter, the way ATC shows Mode C', () => {
  const hpa = 30.4 * HPA_PER_INHG;
  assert.equal(Math.round(indicatedAltitude(-400, hpa)), 40);
  assert.equal(Math.round(indicatedAltitude(-325, hpa)), 115);
  // Standard day: no change. Low pressure reads lower (29.42: about 450 ft).
  assert.equal(Math.round(indicatedAltitude(5000, 1013.25)), 5000);
  assert.equal(
    Math.round(indicatedAltitude(5000, 29.42 * HPA_PER_INHG) / 10) * 10,
    4550,
  );
  // No (or a nonsense) setting: the pressure altitude as sent.
  assert.equal(indicatedAltitude(800, null), 800);
  assert.equal(indicatedAltitude(800, 500), 800);
  assert.equal(altitudeText(-400, hpa), 'below 100 ft');
  assert.equal(altitudeText(-325, hpa), '100 ft');
  assert.equal(altitudeText(-400), 'below 100 ft');
  assert.equal(altitudeText(2500, hpa), '2,900 ft');
  // Flight levels stay on 29.92 whatever the local setting.
  assert.equal(altitudeText(34000, hpa), 'FL340');
  assert.equal(altitudeText(18000, 28.9 * HPA_PER_INHG), 'FL180');
});

test('altimeter settings: recent METARs only; nearest within 60 nm, else the crew setting', () => {
  const stations = altimeterStations(AIRPORT_WEATHER, MIL_NOW);
  assert.deepEqual(
    stations.map((s) => [s.icao, s.inHg]),
    [
      ['KACY', 30.4],
      ['KWWD', 30.41],
    ],
  );
  // Older than 3 hours, no geometry, or an impossible value: left out.
  assert.deepEqual(
    altimeterStations(AIRPORT_WEATHER, MIL_NOW + 4 * 3600_000),
    [],
  );
  assert.deepEqual(
    altimeterStations(
      {
        features: [
          { ...AIRPORT_WEATHER.features[0], geometry: null },
          { ...AIRPORT_WEATHER.features[1], altimeterInHg: 3.04 },
        ],
      },
      MIL_NOW,
    ),
    [],
  );
  assert.deepEqual(altimeterStations(null, MIL_NOW), []);

  const p6542 = aircraftPoint(MIL.c6542);
  assert.equal(altimeterFor(MIL.c6542, p6542, stations).icao, 'KACY');
  // Off Cape May Point, KWWD is nearer.
  assert.equal(
    altimeterFor({}, { lat: 38.93, lon: -74.96 }, stations).icao,
    'KWWD',
  );
  // Far from every station: the setting the crew report, if any.
  assert.deepEqual(
    altimeterFor(MIL.armyH60, aircraftPoint(MIL.armyH60), stations),
    { hpa: 1013.6, icao: null },
  );
  assert.equal(
    altimeterFor(MIL.sam837, aircraftPoint(MIL.sam837), stations),
    null,
  );
});

test('real /v2/mil records through the aircraft adapter', () => {
  const all = Object.values(MIL);
  const stations = altimeterStations(AIRPORT_WEATHER, MIL_NOW);
  const { active, hold, ctx } = aircraftObservations(all, { stations });
  const byKey = Object.fromEntries(active.map((o) => [o.key, o]));
  assert.deepEqual(Object.keys(byKey).sort(), [
    'aircraft:uscg:ae2683',
    'aircraft:uscg:ae26bc',
  ]);
  // Routine SAM flights more than 150 nm from Cape May are not county news.
  for (const key of ['aircraft:vip:ae0945', 'aircraft:vip:ae11f8'])
    assert.equal(ctx.get(key).outside, true, key);
  const c6605 = byKey['aircraft:uscg:ae26bc'];
  assert.equal(
    c6605.text.title,
    'Coast Guard MH-65 2 mi E of Ocean City, below 100 ft',
  );
  assert.equal(c6605.text.place, 'Ocean City');
  assert.equal(
    c6605.text.detail,
    'callsign C6605 · tail 6605 · 3 kt ground speed · altitude for local pressure (KACY 30.40 inHg)',
  );
  assert.equal(c6605.layer, 'military');
  assert.equal(c6605.meta.coastGuard, true);
  assert.equal(
    byKey['aircraft:uscg:ae2683'].text.title,
    'Coast Guard MH-65 3 mi NE of Ocean City, 100 ft',
  );
  // Where they would be described, if they were followed.
  assert.equal(
    vipWhere(aircraftPoint(MIL.sam837), MIL.sam837.alt_baro).text,
    '193 nm NE of KLGA at FL340',
  );
  assert.equal(
    vipWhere(aircraftPoint(MIL.sam834), MIL.sam834.alt_baro).text,
    'at FL350 over 38.9°N 102.9°W',
  );
  // Heard without a usable position: cannot be judged, never cleared.
  assert.deepEqual([...hold], ['aircraft:uscg:ae2913']);
  // Listed but on the ground / outside the county: what a "cleared" can say.
  assert.deepEqual(ctx.get('aircraft:uscg:ae290e'), {
    ground: true,
    label: 'Coast Guard MH-60T',
    point: { lat: 42.336433, lon: -71.106793 },
    outside: true,
  });
  // The HC-27J over California is Coast Guard but not over the county.
  assert.equal(ctx.get('aircraft:uscg:ae2126').outside, true);

  // Without METARs the hovering pair still never reads "0 ft".
  const bare = aircraftObservations([MIL.c6542]);
  assert.equal(
    bare.active[0].text.title,
    'Coast Guard MH-65 3 mi NE of Ocean City, below 100 ft',
  );
  assert.ok(!/altitude for local pressure/.test(bare.active[0].text.detail));
});

test('real tide-gauges and power-outages envelopes: quiet county, nothing active', () => {
  const capeMayHarbor = {
    id: 'nwps:CAPN4',
    kind: 'flood-gauge',
    geometry: { type: 'Point', lat: 38.9483, lon: -74.8889 },
    title: 'Cape May Harbor at Cape May Harbor',
    lid: 'CAPN4',
    tidal: true,
    datum: 'ft above MLLW',
    status: 'observed',
    observedAt: '2026-11-19T17:06:00Z',
    observed: {
      value: 2.73,
      unit: 'ft',
      time: '2026-11-19T17:06:00Z',
      category: 'no_flooding',
    },
    forecast: {
      value: 5.2,
      unit: 'ft',
      time: '2026-11-21T10:00:00Z',
      category: 'no_flooding',
    },
    floodStages: { action: null, minor: 6.2, moderate: 7.2, major: 8.2 },
    worstCategory: 'no_flooding',
  };
  const tideStation = {
    id: 'coops:8536110',
    kind: 'tide-station',
    geometry: { type: 'Point', lat: 38.9683, lon: -74.96 },
    title: 'Cape May, NJ',
    observed: { value: 3.48, unit: 'ft', time: '2026-11-19T18:12:00.000Z' },
    status: 'observed',
  };
  // A river gauge with no flood stages: category null.
  const absecon = {
    id: 'nwps:ABSN4',
    kind: 'flood-gauge',
    geometry: { type: 'Point', lat: 39.430277777778, lon: -74.520555555556 },
    title: 'Absecon Creek at Absecon',
    status: 'observed',
    observed: {
      value: 2.35,
      unit: 'ft',
      time: '2026-11-19T17:40:00Z',
      category: null,
    },
    forecast: null,
    floodStages: { action: null, minor: null, moderate: null, major: null },
    worstCategory: null,
  };
  const flood = floodObservations(
    { status: 'live', features: [capeMayHarbor, tideStation, absecon] },
    MIL_NOW,
  );
  assert.deepEqual(flood.active, []);
  assert.deepEqual(
    [...flood.gone.keys()],
    ['flooding:nwps:CAPN4', 'flooding:nwps:ABSN4'],
  );
  assert.equal(flood.gone.get('flooding:nwps:CAPN4').place, 'Cape May Harbor');

  const outages = {
    status: 'live',
    summary: {
      counties: [
        { county: 'Cumberland', out: 1, served: 36964 },
        { county: 'Atlantic', out: 7, served: 140355 },
        { county: 'Cape May', out: 3, served: 113760 },
      ],
    },
    features: [
      {
        id: 'ace:CAPE MAY:MIDDLE TWP',
        kind: 'outage-town',
        geometry: { type: 'Point', lat: 39.1190651, lon: -74.8458744 },
        title: 'Middle Township',
        county: 'Cape May',
        customersOut: 3,
      },
      {
        id: 'ace:CAPE MAY:WEST WILDWOOD BORO',
        kind: 'outage-town',
        geometry: { type: 'Point', lat: 39.0017652, lon: -74.8240036 },
        title: 'West Wildwood Borough',
        county: 'Cape May',
        customersOut: 0,
      },
      {
        id: 'ace:ATLANTIC:EGG HARBOR TWP',
        kind: 'outage-town',
        geometry: { type: 'Point', lat: 39.3820672, lon: -74.6171489 },
        title: 'Egg Harbor Township',
        county: 'Atlantic',
        customersOut: 4,
      },
    ],
  };
  assert.deepEqual(capeMayOutages(outages), {
    out: 3,
    served: 113760,
    towns: [
      {
        name: 'Middle Township',
        out: 3,
        point: { lat: 39.1190651, lon: -74.8458744 },
      },
    ],
  });
  // Under 100 customers: no event, and it can clear an earlier one.
  const obs = outageObservations(outages);
  assert.deepEqual(obs.active, []);
  assert.deepEqual([...obs.gone.keys()], ['outage:ace:cape-may']);
  // No Cape May row at all: cannot judge (hold), not "cleared".
  assert.deepEqual(
    [...outageObservations({ summary: { counties: [] } }).hold],
    ['outage:ace:cape-may'],
  );
});

test('FAA delays: a ground delay program gives average and maximum; other delays a range', () => {
  assert.equal(
    faaDelayText({
      category: 'ground-delay',
      avg: '1 hour and 2 minutes',
      max: '2 hours and 41 minutes',
    }),
    'average 1 hour and 2 minutes, maximum 2 hours and 41 minutes',
  );
  assert.equal(
    faaDelayText({
      category: 'arrival-departure',
      avg: '16 minutes',
      max: '30 minutes',
    }),
    '16 minutes to 30 minutes',
  );
  assert.equal(
    faaDelayText({
      category: 'arrival-departure',
      avg: '15 minutes',
      max: '15 minutes',
    }),
    '15 minutes',
  );
  assert.equal(faaDelayText({ category: 'ground-stop' }), '');
  const [gdp] = faaObservations({
    local: [
      {
        airport: 'EWR',
        category: 'ground-delay',
        reason: 'VOL:Volume',
        avg: '45 minutes',
        max: '1 hour and 30 minutes',
        startMs: null,
      },
    ],
  }).active;
  assert.equal(gdp.text.title, 'Ground delay program at KEWR');
  assert.equal(gdp.text.place, 'Newark Liberty Intl (KEWR)');
  assert.equal(
    gdp.text.detail,
    'volume (FAA: VOL:Volume) · average 45 minutes, maximum 1 hour and 30 minutes',
  );
});

test('road names the way TomTom and Fire Wire write them', () => {
  assert.deepEqual(roadsIn('NJ-47 Delsea Dr'), ['Route 47']);
  assert.deepEqual(roadsIn('US-9'), ['US 9']);
  assert.deepEqual(roadsIn('CR-626'), ['CR 626']);
  assert.deepEqual(roadsIn('G.S.P. southbound at exit 10'), [
    'Garden State Pkwy',
  ]);
  assert.deepEqual(roadsIn('Garden State Parkway'), ['Garden State Pkwy']);
  assert.deepEqual(roadsIn('Rte 147 and Route 9'), ['Route 147', 'US 9']);
  assert.deepEqual(roadsIn('2nd Ave and Ocean Dr'), []);
});
