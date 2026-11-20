import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createEventLog,
  eventLogResponse,
  eventsRoute,
  ingest,
  installEventLog,
  loadEventLog,
  resetEventLogWarnings,
  runEventSweep,
  saveEventLog,
  settle,
  summarize,
  warnOnce,
} from './eventLog.js';
import {
  altitudeText,
  coastGuardType,
  hurricaneCategory,
  isWaterEmergency,
  roadsIn,
  vipLabel,
  vipWhere,
} from './eventSources.js';

const NOW = Date.parse('2026-11-18T15:00:00Z'); // 10:00 AM Eastern
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const RIO_GRANDE = { lat: 39.0145, lon: -74.8818 };
const NORTH_WILDWOOD = { lat: 39.0001, lon: -74.7993 };
const KPHL = { lat: 39.8719, lon: -75.2411 };

let fetchTick = 1;
const env = (features = [], extra = {}) => ({
  status: 'live',
  fetchedAt: fetchTick++,
  note: null,
  features,
  ...extra,
});
const outagesEnv = (out = 0, towns = []) =>
  env(towns, {
    summary: { counties: [{ county: 'Cape May', out, served: 113760 }] },
  });

/** A whole-county snapshot; anything not given answers live and empty. */
function snap(parts = {}) {
  const { military, storms, faa, ...envs } = parts;
  return {
    envelopes: {
      calls: envs.calls ?? env(),
      traffic: envs.traffic ?? env(),
      reports: envs.reports ?? env(),
      gauges: envs.gauges ?? env(),
      alerts: envs.alerts ?? env(),
      outages: envs.outages ?? outagesEnv(0),
    },
    military: military ?? { ok: true, at: NOW, aircraft: [] },
    storms: storms ?? { ok: true, at: NOW, storms: [] },
    faa: faa ?? { ok: true, at: NOW, local: [] },
  };
}

const point = (p) => ({ type: 'Point', lat: p.lat, lon: p.lon });
const north = (p, miles) => ({ lat: p.lat + miles / 69.05, lon: p.lon });

const call = (id, p, at, extra = {}) => ({
  id: `call:${id}`,
  kind: 'public-safety-call',
  geometry: point(p),
  title: 'Structure Fire',
  location: '',
  municipality: 'Rio Grande',
  priority: 'high',
  summary: '',
  observedAt: iso(at),
  ...extra,
});

const traffic = (id, p, at, extra = {}) => ({
  id: `tomtom:${id}`,
  kind: 'traffic-incident',
  geometry: point(p),
  title: 'Road closed',
  road: 'NJ-47',
  from: 'Indian Trail Rd',
  to: 'Railroad Ave',
  description: 'Closed',
  startTime: iso(at),
  observedAt: iso(at),
  ...extra,
});

const gauge = (category, extra = {}) => ({
  id: 'nwps:CAPN4',
  kind: 'flood-gauge',
  geometry: point({ lat: 38.948, lon: -74.889 }),
  title: 'Cape May Harbor at Cape May Harbor',
  tidal: true,
  datum: 'ft above MLLW',
  status: 'observed',
  observed: { value: 6.4, unit: 'ft', time: iso(NOW - 6 * MIN), category },
  forecast: null,
  floodStages: { minor: 6.2, moderate: 7.2, major: 8.2 },
  worstCategory: category,
  ...extra,
});

const alert = (extra = {}) => ({
  id: 'nws:https://api.weather.gov/alerts/1',
  kind: 'alert',
  title: 'Coastal Flood Warning',
  severity: 'Moderate',
  expires: '2026-11-19T03:00:00Z', // 10:00 PM Eastern
  observedAt: iso(NOW - 30 * MIN),
  matchedPlaces: ['Cape May', 'Wildwood'],
  ...extra,
});

const cgHelo = (p, extra = {}) => ({
  hex: 'adf9a1',
  flight: 'C6031   ',
  t: 'H60',
  r: '6031',
  lat: p.lat,
  lon: p.lon,
  alt_baro: 800,
  gs: 90,
  seen: 0.5,
  ...extra,
});

const storm = (extra = {}) => ({
  id: 'al052026',
  basin: 'AL',
  name: 'Ernesto',
  classification: 'HU',
  position: { latitude: 31.5, longitude: -71.0 },
  issuedAt: iso(NOW - 60 * MIN),
  advisoryNumber: '12',
  windKt: 75,
  movement: { directionDegrees: 0, speedKt: 10 },
  ...extra,
});

/** Destination point, for "34 nm NE of KPHL". */
function destination(from, bearingDeg, nm) {
  const R = 3440.065;
  const d = nm / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lon1 = (from.lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

const byKind = (events, kind) => events.filter((e) => e.kind === kind);

// ------------------------------------------------------------------ change detection

test('traffic: new, update on type change, cleared after two missed answers', () => {
  const log = createEventLog();
  const p = { lat: 39.03, lon: -74.87 };
  const [first] = ingest(
    log,
    snap({
      traffic: env([
        traffic('t1', p, NOW - 130 * MIN, { title: 'Lane closed' }),
      ]),
    }),
    NOW,
  );
  assert.equal(first.change, 'new');
  assert.equal(first.kind, 'traffic');
  assert.equal(first.title, 'Lane closed');
  assert.equal(first.place, 'Route 47');
  assert.equal(first.at, NOW - 130 * MIN, 'at is the source start time');
  assert.equal(first.seenAt, NOW);
  assert.equal(first.layer, 'traffic-incidents');
  assert.equal(first.threadId, first.id);
  assert.equal(first.key, 'traffic:tomtom:t1');

  // Same answer again: nothing new.
  assert.deepEqual(
    ingest(
      log,
      snap({
        traffic: env([
          traffic('t1', p, NOW - 130 * MIN, { title: 'Lane closed' }),
        ]),
      }),
      NOW + 2 * MIN,
    ),
    [],
  );

  const [update] = ingest(
    log,
    snap({ traffic: env([traffic('t1', p, NOW - 130 * MIN)]) }),
    NOW + 4 * MIN,
  );
  assert.equal(update.change, 'update');
  assert.equal(update.title, 'Now: road closed');
  assert.equal(update.threadId, first.id);
  assert.deepEqual(update.related, [{ id: first.id, reason: 'update' }]);
  assert.deepEqual(first.related, [{ id: update.id, reason: 'update' }]);

  // Gone once: not yet (one missed answer could be a blip).
  assert.deepEqual(ingest(log, snap(), NOW + 6 * MIN), []);
  const [cleared] = ingest(log, snap(), NOW + 8 * MIN);
  assert.equal(cleared.change, 'cleared');
  assert.equal(cleared.title, 'Route 47 reopened');
  assert.match(
    cleared.detail,
    /^Closed about 2 h 18 min · no longer listed by TomTom$/,
  );
  assert.equal(cleared.threadId, first.id);
  assert.deepEqual(cleared.related, [{ id: update.id, reason: 'cleared' }]);
  assert.equal(cleared.severity, 'info');
});

test('an unchanged cached envelope never counts as a missed answer', () => {
  const log = createEventLog();
  const p = { lat: 39.03, lon: -74.87 };
  ingest(log, snap({ traffic: env([traffic('t1', p, NOW)]) }), NOW);
  const empty = env([]);
  assert.deepEqual(ingest(log, snap({ traffic: empty }), NOW + 2 * MIN), []);
  // The same empty answer (same fetchedAt) again holds nothing new.
  assert.deepEqual(ingest(log, snap({ traffic: empty }), NOW + 4 * MIN), []);
  assert.equal(log.items['traffic:tomtom:t1'].status, 'active');
  const [cleared] = ingest(log, snap({ traffic: env([]) }), NOW + 6 * MIN);
  assert.equal(cleared.change, 'cleared');
});

test('a failing source never floods the log with cleared events', () => {
  const log = createEventLog();
  const calls = [
    call(1, RIO_GRANDE, NOW - 5 * MIN),
    call(2, NORTH_WILDWOOD, NOW - 4 * MIN),
  ];
  const alerts = [alert()];
  assert.equal(
    ingest(log, snap({ calls: env(calls), alerts: env(alerts) }), NOW).length,
    3,
  );
  for (let i = 1; i <= 4; i++) {
    const events = ingest(
      log,
      snap({
        calls: { status: 'unavailable', fetchedAt: null, features: [] },
        alerts: env([], {
          note: 'Some areas could not be checked: Cape May: HTTP 500',
        }),
        military: { ok: false, at: NOW, aircraft: [] },
      }),
      NOW + i * 2 * MIN,
    );
    assert.deepEqual(events, [], `sweep ${i} emitted nothing`);
  }
  const res = eventLogResponse(log, { now: NOW + 8 * MIN });
  const sources = Object.fromEntries(res.sources.map((s) => [s.id, s.ok]));
  assert.equal(sources.calls, false);
  assert.equal(sources.alerts, true);
  assert.equal(sources.aircraft, false);
  // The loader itself failing (no envelopes at all) is also not "gone".
  assert.deepEqual(ingest(log, { envelopes: {} }, NOW + 10 * MIN), []);
  assert.equal(log.items['call:firewire:1'].status, 'active');
});

test('NWS alert: new, extended, ended', () => {
  const log = createEventLog();
  const [first] = ingest(log, snap({ alerts: env([alert()]) }), NOW);
  assert.equal(first.kind, 'alert');
  assert.equal(first.title, 'Coastal Flood Warning until 10:00 PM');
  assert.equal(first.place, 'Cape May, Wildwood');
  assert.equal(first.severity, 'warn');
  assert.equal(first.layer, 'nws-alerts');
  assert.equal(first.lat, null);
  assert.equal(first.at, NOW - 30 * MIN);
  const [extended] = ingest(
    log,
    snap({
      alerts: env([alert({ id: 'nws:2', expires: '2026-11-19T15:00:00Z' })]),
    }),
    NOW + 2 * MIN,
  );
  assert.equal(extended.change, 'update');
  assert.equal(
    extended.title,
    'Coastal Flood Warning extended until Thu 10:00 AM',
  );
  assert.equal(extended.threadId, first.id);
  ingest(log, snap(), NOW + 4 * MIN);
  const [ended] = ingest(log, snap(), NOW + 6 * MIN);
  assert.equal(ended.title, 'Coastal Flood Warning ended');
  assert.equal(ended.change, 'cleared');
  assert.equal(ended.threadId, first.id);
});

test('flooding: forecast to observed is an update; back below minor clears; not reporting holds', () => {
  const log = createEventLog();
  const forecastOnly = gauge('no_flooding', {
    observed: {
      value: 5.1,
      unit: 'ft',
      time: iso(NOW - 6 * MIN),
      category: 'no_flooding',
    },
    forecast: {
      value: 6.5,
      unit: 'ft',
      time: iso(NOW + 5 * 60 * MIN),
      category: 'minor',
    },
    worstCategory: 'minor',
  });
  const [first] = ingest(log, snap({ gauges: env([forecastOnly]) }), NOW);
  assert.equal(first.title, 'Minor flooding forecast');
  assert.equal(first.place, 'Cape May Harbor');
  assert.equal(first.at, NOW, 'a forecast has no observed time: seenAt');
  const [observed] = ingest(
    log,
    snap({ gauges: env([gauge('minor')]) }),
    NOW + 2 * MIN,
  );
  assert.equal(observed.title, 'Minor flooding now observed');
  const [up] = ingest(
    log,
    snap({ gauges: env([gauge('moderate')]) }),
    NOW + 4 * MIN,
  );
  assert.equal(up.title, 'Flooding up to moderate (observed)');
  assert.equal(up.severity, 'warn');
  // Not reporting: neither flooding nor proof it went down.
  assert.deepEqual(
    ingest(
      log,
      snap({
        gauges: env([
          gauge(null, {
            status: 'not-reporting',
            observed: null,
            worstCategory: null,
          }),
        ]),
      }),
      NOW + 6 * MIN,
    ),
    [],
  );
  const [down] = ingest(
    log,
    snap({ gauges: env([gauge('no_flooding')]) }),
    NOW + 8 * MIN,
  );
  assert.equal(down.change, 'cleared');
  assert.equal(down.title, 'Back below minor flood stage');
  assert.match(down.detail, /^Latest reading 6\.4 ft above MLLW at 9:54 AM$/);
});

test('power outages: events only when Cape May County crosses 100 / 500 / 1,000 / 5,000', () => {
  const log = createEventLog();
  const towns = [
    {
      id: 'ace:CAPE MAY:OCEAN CITY',
      county: 'Cape May',
      title: 'Ocean City',
      customersOut: 80,
      geometry: point({ lat: 39.2776, lon: -74.5746 }),
    },
  ];
  assert.deepEqual(
    ingest(log, snap({ outages: outagesEnv(99, towns) }), NOW),
    [],
  );
  const [first] = ingest(
    log,
    snap({ outages: outagesEnv(120, towns) }),
    NOW + 2 * MIN,
  );
  assert.equal(first.title, 'Power out for 120 customers in Cape May County');
  assert.equal(first.detail, 'Most in Ocean City (80)');
  assert.equal(first.lat, 39.2776);
  assert.deepEqual(
    ingest(log, snap({ outages: outagesEnv(480, towns) }), NOW + 4 * MIN),
    [],
  );
  const [rise] = ingest(
    log,
    snap({ outages: outagesEnv(1240, towns) }),
    NOW + 6 * MIN,
  );
  assert.equal(
    rise.title,
    'Power outages rising: 1,240 customers out in Cape May County',
  );
  assert.equal(rise.severity, 'warn');
  ingest(log, snap({ outages: outagesEnv(60, towns) }), NOW + 8 * MIN);
  const [cleared] = ingest(
    log,
    snap({ outages: outagesEnv(40, towns) }),
    NOW + 10 * MIN,
  );
  assert.equal(
    cleared.title,
    'Power outages in Cape May County under 100 customers',
  );
  assert.equal(cleared.detail, '40 customers out now');
});

test('point items older than 6 hours on first sight are ignored, and never "cleared"', () => {
  const log = createEventLog();
  const old = traffic(
    'roadworks',
    { lat: 39.1, lon: -74.8 },
    NOW - 3 * 24 * 60 * MIN,
    { title: 'Road works' },
  );
  assert.deepEqual(ingest(log, snap({ traffic: env([old]) }), NOW), []);
  assert.deepEqual(ingest(log, snap(), NOW + 2 * MIN), []);
  assert.deepEqual(ingest(log, snap(), NOW + 4 * MIN), []);
  assert.equal(log.items['traffic:tomtom:roadworks'], undefined);
});

test('FAA ground stop at PHL: new then ended', () => {
  const log = createEventLog();
  const faa = {
    ok: true,
    at: NOW,
    local: [
      {
        airport: 'PHL',
        category: 'ground-stop',
        reason: 'WX:Thunderstorms',
        endTime: '3:45 pm EST',
        startMs: null,
      },
      {
        airport: 'ACY',
        category: 'closure',
        reason: '!ACY AD AP CLSD',
        startMs: NOW,
      },
    ],
  };
  const events = ingest(log, snap({ faa }), NOW);
  assert.equal(events.length, 1, 'closures (NOTAM-style) are not events');
  assert.equal(events[0].title, 'Ground stop at KPHL');
  assert.equal(events[0].place, 'Philadelphia Intl (KPHL)');
  assert.equal(events[0].layer, 'faa-status');
  assert.match(
    events[0].detail,
    /weather, thunderstorms \(FAA: WX:Thunderstorms\) · until 3:45 pm EST/,
  );
  ingest(log, snap(), NOW + 2 * MIN);
  const [ended] = ingest(log, snap(), NOW + 4 * MIN);
  assert.equal(ended.title, 'Ground stop at KPHL ended');
});

// ------------------------------------------------------------------ correlation

test('rule (a): close in place and time, with the distance and time in the reason', () => {
  const log = createEventLog();
  const t = traffic('crash', RIO_GRANDE, NOW - 30 * MIN, {
    title: 'Crash',
    road: 'CR-626',
    from: 'Delsea Dr',
    to: '',
  });
  const [tEv] = ingest(log, snap({ traffic: env([t]) }), NOW);
  const c = call('c1', north(RIO_GRANDE, 0.4), NOW - 18 * MIN, {
    title: 'Motor Vehicle Accident',
    location: 'Delsea Dr',
  });
  const [cEv] = ingest(
    log,
    snap({ traffic: env([t]), calls: env([c]) }),
    NOW + 2 * MIN,
  );
  assert.deepEqual(cEv.related, [
    { id: tEv.id, reason: '0.4 mi and 12 min apart' },
  ]);
  assert.deepEqual(tEv.related, [
    { id: cEv.id, reason: '0.4 mi and 12 min apart' },
  ]);
  assert.equal(
    cEv.threadId,
    tEv.threadId,
    'the new event joins the earlier thread',
  );
});

test('rule (a) links calls of any type close together, and nothing over 1 mi / 3 h', () => {
  const log = createEventLog();
  const a = call('a', RIO_GRANDE, NOW - 10 * MIN, {
    title: 'Medical Emergency',
  });
  // A fire and a medical call at almost the same spot: the strongest case.
  const b = call('b', north(RIO_GRANDE, 0.2), NOW - 5 * MIN, {
    title: 'Structure Fire',
  });
  const far = call('c', north(RIO_GRANDE, 1.5), NOW - 5 * MIN, {
    title: 'Medical Emergency',
  });
  const late = call(
    'd',
    north(RIO_GRANDE, 0.1),
    NOW - 4 * 60 * MIN + 30 * MIN,
    { title: 'Medical Emergency' },
  );
  const events = ingest(log, snap({ calls: env([a, b, far, late]) }), NOW);
  assert.equal(events.length, 4);
  const ev = (id) => events.find((e) => e.key === `call:firewire:${id}`);
  assert.deepEqual(ev('b').related, [
    { id: ev('a').id, reason: '0.2 mi and 5 min apart' },
  ]);
  assert.deepEqual(ev('a').related, [
    { id: ev('b').id, reason: '0.2 mi and 5 min apart' },
  ]);
  assert.equal(ev('b').threadId, ev('a').threadId);
  // 1.3 mi from b: too far. d is 0.1 mi from a but 3 h 20 min earlier.
  assert.equal(ev('d').at, NOW - 210 * MIN);
  assert.deepEqual(ev('c').related, []);
  assert.deepEqual(ev('d').related, []);
});

test('rule (a) includes aircraft: a Coast Guard aircraft near a call that is not a water emergency', () => {
  const log = createEventLog();
  const crash = call('mva', NORTH_WILDWOOD, NOW - 20 * MIN, {
    title: 'Motor Vehicle Accident',
    municipality: 'North Wildwood',
  });
  const events = ingest(
    log,
    snap({
      calls: env([crash]),
      military: {
        ok: true,
        at: NOW,
        aircraft: [cgHelo(north(NORTH_WILDWOOD, 0.5))],
      },
    }),
    NOW,
  );
  const callEv = byKind(events, 'call')[0];
  const airEv = byKind(events, 'aircraft')[0];
  assert.deepEqual(airEv.related, [
    { id: callEv.id, reason: '0.5 mi and 20 min apart' },
  ]);
  // Already linked: no "approach" update follows on the next sweeps.
  for (let i = 1; i <= 3; i++)
    assert.deepEqual(
      ingest(
        log,
        snap({
          calls: env([crash]),
          military: {
            ok: true,
            at: NOW,
            aircraft: [cgHelo(north(NORTH_WILDWOOD, 0.3))],
          },
        }),
        NOW + i * 2 * MIN,
      ),
      [],
    );
});

test('rule (b): the same numbered road, written different ways', () => {
  assert.deepEqual(roadsIn('Rt 47 and Railroad Ave'), ['Route 47']);
  assert.deepEqual(roadsIn('NJ-47'), ['Route 47']);
  assert.deepEqual(roadsIn('State Highway 47 at mile 3'), ['Route 47']);
  assert.deepEqual(roadsIn('crash on CR 626'), ['CR 626']);
  assert.deepEqual(roadsIn('County Road 626'), ['CR 626']);
  assert.deepEqual(roadsIn('GSP southbound'), ['Garden State Pkwy']);
  assert.deepEqual(roadsIn('Garden State Pkwy exit 4'), ['Garden State Pkwy']);
  assert.deepEqual(roadsIn('Route 9 at Shell Bay Ave'), ['US 9']);
  assert.deepEqual(roadsIn('send us 2 more units'), []);

  const log = createEventLog();
  const t = traffic('closure', RIO_GRANDE, NOW - 40 * MIN);
  const [tEv] = ingest(log, snap({ traffic: env([t]) }), NOW);
  const c = call('c47', north(RIO_GRANDE, 2.2), NOW - 20 * MIN, {
    title: 'Motor Vehicle Accident',
    location: 'Rt 47 and Railroad Ave',
    municipality: 'Middle Twp',
  });
  const [cEv] = ingest(
    log,
    snap({ traffic: env([t]), calls: env([c]) }),
    NOW + 2 * MIN,
  );
  assert.deepEqual(cEv.related, [
    { id: tEv.id, reason: 'same road: Route 47' },
  ]);
  assert.equal(cEv.threadId, tEv.id);
});

test('rule (c): Coast Guard aircraft near a water emergency', () => {
  assert.equal(isWaterEmergency('Water Rescue · swimmer in distress'), true);
  assert.equal(isWaterEmergency('Structure Fire'), false);
  const log = createEventLog();
  const rescue = call('w1', NORTH_WILDWOOD, NOW - 10 * MIN, {
    title: 'Water Rescue',
    municipality: 'North Wildwood',
    summary: 'Swimmer in distress off 2nd Ave',
  });
  const events = ingest(
    log,
    snap({
      calls: env([rescue]),
      military: {
        ok: true,
        at: NOW,
        aircraft: [cgHelo(north(NORTH_WILDWOOD, 0.3))],
      },
    }),
    NOW,
  );
  const callEv = byKind(events, 'call')[0];
  const airEv = byKind(events, 'aircraft')[0];
  assert.equal(airEv.title, 'Coast Guard MH-60T over North Wildwood, 800 ft');
  assert.equal(airEv.layer, 'military');
  assert.deepEqual(airEv.related, [
    { id: callEv.id, reason: 'Coast Guard aircraft nearby' },
  ]);
  assert.deepEqual(callEv.related, [
    { id: airEv.id, reason: 'Coast Guard aircraft nearby' },
  ]);
  assert.equal(airEv.threadId, callEv.threadId);
});

test('rule (c): an aircraft closing on an earlier water call emits an update carrying the link', () => {
  const log = createEventLog();
  const farOff = { lat: 39.25, lon: -74.6 }; // off Ocean City
  ingest(
    log,
    snap({ military: { ok: true, at: NOW, aircraft: [cgHelo(farOff)] } }),
    NOW,
  );
  const rescue = call('w2', NORTH_WILDWOOD, NOW + 1 * MIN, {
    title: 'Boat Overturned',
    municipality: 'North Wildwood',
  });
  const second = ingest(
    log,
    snap({
      calls: env([rescue]),
      military: { ok: true, at: NOW, aircraft: [cgHelo(farOff)] },
    }),
    NOW + 2 * MIN,
  );
  assert.deepEqual(
    second.map((e) => e.kind),
    ['call'],
  );
  assert.deepEqual(second[0].related, []);
  const third = ingest(
    log,
    snap({
      calls: env([rescue]),
      military: {
        ok: true,
        at: NOW,
        aircraft: [cgHelo(north(NORTH_WILDWOOD, 0.5), { alt_baro: 300 })],
      },
    }),
    NOW + 4 * MIN,
  );
  assert.equal(third.length, 1);
  assert.equal(third[0].change, 'update');
  assert.equal(
    third[0].title,
    'Coast Guard MH-60T over North Wildwood, 300 ft',
  );
  assert.deepEqual(third[0].related.map((r) => r.reason).sort(), [
    'Coast Guard aircraft nearby',
    'update',
  ]);
  // Linked once: the next sweep does not repeat it.
  assert.deepEqual(
    ingest(
      log,
      snap({
        calls: env([rescue]),
        military: {
          ok: true,
          at: NOW,
          aircraft: [cgHelo(north(NORTH_WILDWOOD, 0.4), { alt_baro: 300 })],
        },
      }),
      NOW + 6 * MIN,
    ),
    [],
  );
});

test('NWS alerts and storms are never linked by distance', () => {
  const log = createEventLog();
  const atCall = { lat: 39.0, lon: -74.88 };
  const events = ingest(
    log,
    snap({
      calls: env([call('x', atCall, NOW - 5 * MIN)]),
      alerts: env([alert()]),
      storms: {
        ok: true,
        at: NOW,
        storms: [
          storm({
            classification: 'TS',
            windKt: 45,
            position: { latitude: atCall.lat, longitude: atCall.lon },
          }),
        ],
      },
    }),
    NOW,
  );
  assert.equal(events.length, 3);
  for (const e of events)
    assert.deepEqual(e.related, [], `${e.kind} not linked`);
});

test('threads: a new event joins the earliest thread it links to; older events keep theirs', () => {
  const log = createEventLog();
  const a = traffic('a', RIO_GRANDE, NOW - 100 * MIN, {
    title: 'Crash',
    road: '',
    from: '',
  });
  const [evA] = ingest(log, snap({ traffic: env([a]) }), NOW);
  // b is 1.8 mi from a: its own thread.
  const b = traffic('b', north(RIO_GRANDE, 1.8), NOW - 60 * MIN, {
    title: 'Crash',
    road: '',
    from: '',
  });
  const evB = ingest(log, snap({ traffic: env([a, b]) }), NOW + 2 * MIN)[0];
  assert.notEqual(evB.threadId, evA.threadId);
  // c sits between them, under 1 mi from each: it links both, joins a's (earlier).
  const c = call('mid', north(RIO_GRANDE, 0.9), NOW - 20 * MIN, {
    title: 'Motor Vehicle Accident',
  });
  const [evC] = ingest(
    log,
    snap({ traffic: env([a, b]), calls: env([c]) }),
    NOW + 4 * MIN,
  );
  assert.equal(evC.threadId, evA.threadId);
  assert.deepEqual(
    evC.related.map((r) => r.id).sort(),
    [evA.id, evB.id].sort(),
  );
  assert.equal(evB.threadId, evB.id, 'emitted events are immutable');
  assert.ok(
    evB.related.some((r) => r.id === evC.id),
    'related may grow',
  );
});

test('related is capped at 6 per event', () => {
  const log = createEventLog();
  const many = Array.from({ length: 9 }, (_, i) =>
    traffic(`t${i}`, north(RIO_GRANDE, i * 0.05), NOW - 30 * MIN, {
      title: 'Crash',
      road: '',
      from: '',
    }),
  );
  ingest(log, snap({ traffic: env(many) }), NOW);
  for (const e of log.events)
    assert.ok(e.related.length <= 6, `${e.key} has ${e.related.length}`);
  assert.equal(log.events.at(-1).related.length, 6);
});

// ------------------------------------------------------------------ aircraft

test('VIP naming: AF1 only for callsign AF1; a VC-25A under another callsign by tail', () => {
  assert.equal(
    vipLabel({ flight: 'AF1     ', t: 'VC25', r: '82-8000' }),
    'AF1',
  );
  assert.equal(
    vipLabel({ flight: 'SAM28000', t: 'VC25', r: '82-8000' }),
    'VC-25A 28000 (callsign SAM28000)',
  );
  assert.equal(
    vipLabel({ flight: '', t: 'VC25', r: '92-9000' }),
    'VC-25A 29000',
  );
  assert.equal(
    vipLabel({ flight: 'SAM834  ', t: 'B737', r: '01-0040' }),
    'SAM834 (C-40)',
  );
  assert.equal(vipLabel({ flight: 'AF2', t: 'B752' }), 'AF2');
});

test('VIP position text: near an airport when low, else nm and bearing from the nearest', () => {
  assert.deepEqual(vipWhere({ lat: 38.83, lon: -76.88 }, 2000), {
    near: true,
    text: 'near Joint Base Andrews (KADW)',
    place: 'Joint Base Andrews (KADW)',
  });
  const ne = destination(KPHL, 45, 34);
  assert.equal(vipWhere(ne, 35000).text, '34 nm NE of KPHL at FL350');
  // Low but more than 10 nm out: not "near".
  assert.equal(
    vipWhere(destination(KPHL, 270, 20), 3000).text,
    '20 nm W of KPHL at 3,000 ft',
  );
  assert.equal(altitudeText(17_950), '18,000 ft');
  assert.equal(altitudeText(18_000), 'FL180');
});

test('AF1 airborne, on the ground, and no longer reported', () => {
  const log = createEventLog();
  const af1 = {
    hex: 'adfdf8',
    flight: 'AF1',
    t: 'VC25',
    r: '82-8000',
    lat: 38.83,
    lon: -76.88,
    alt_baro: 2000,
    gs: 160,
    seen: 1,
  };
  const [up] = ingest(
    log,
    snap({ military: { ok: true, at: NOW, aircraft: [af1] } }),
    NOW,
  );
  assert.equal(up.title, 'AF1 airborne near Joint Base Andrews (KADW)');
  assert.equal(up.kind, 'aircraft');
  const ground = { ...af1, alt_baro: 'ground', lat: 38.811, lon: -76.867 };
  // Three answered sweeps without it airborne (about 6 minutes).
  for (const t of [2, 4])
    assert.deepEqual(
      ingest(
        log,
        snap({ military: { ok: true, at: NOW, aircraft: [ground] } }),
        NOW + t * MIN,
      ),
      [],
    );
  const [down] = ingest(
    log,
    snap({ military: { ok: true, at: NOW, aircraft: [ground] } }),
    NOW + 6 * MIN,
  );
  assert.equal(down.change, 'cleared');
  assert.equal(down.title, 'AF1 on the ground near Joint Base Andrews (KADW)');

  const log2 = createEventLog();
  const cruise = { ...af1, ...destination(KPHL, 45, 34), alt_baro: 35000 };
  const [first] = ingest(
    log2,
    snap({ military: { ok: true, at: NOW, aircraft: [cruise] } }),
    NOW,
  );
  assert.equal(first.title, 'AF1 airborne, 34 nm NE of KPHL at FL350');
  ingest(log2, snap(), NOW + 2 * MIN);
  // A failed adsb.lol answer in between is not a miss.
  assert.deepEqual(
    ingest(
      log2,
      snap({ military: { ok: false, at: NOW, aircraft: [] } }),
      NOW + 3 * MIN,
    ),
    [],
  );
  ingest(log2, snap(), NOW + 4 * MIN);
  const [gone] = ingest(log2, snap(), NOW + 6 * MIN);
  assert.equal(gone.title, 'AF1 no longer reported');
  assert.equal(gone.threadId, first.id);
  // Seen again within 6 hours: an update in the same thread.
  const [again] = ingest(
    log2,
    snap({ military: { ok: true, at: NOW, aircraft: [cruise] } }),
    NOW + 30 * MIN,
  );
  assert.equal(again.change, 'update');
  assert.equal(again.title, 'AF1 airborne again, 34 nm NE of KPHL at FL350');
  assert.equal(again.threadId, first.id);
});

test('SAM flights only within 150 nm of Cape May; AF1 and the VC-25As nationwide', () => {
  const far = { lat: 39.4, lon: -104.1, alt_baro: 41000, gs: 545, seen: 1 };
  const sam = { hex: 'ae0ff1', flight: 'SAM745', t: 'GLF5', r: '06-0500' };
  const log = createEventLog();
  // A routine SAM flight over Colorado is not county news.
  assert.deepEqual(
    ingest(
      log,
      snap({ military: { ok: true, at: NOW, aircraft: [{ ...sam, ...far }] } }),
      NOW,
    ),
    [],
  );
  // Near Andrews (about 105 nm from Cape May) it is.
  const near = { lat: 38.83, lon: -76.88, alt_baro: 3000, gs: 200, seen: 1 };
  const [up] = ingest(
    log,
    snap({ military: { ok: true, at: NOW, aircraft: [{ ...sam, ...near }] } }),
    NOW + 2 * MIN,
  );
  assert.equal(up.kind, 'aircraft');
  assert.match(up.title, /^SAM745 \(C-37\) airborne/);
  // Out of range for three answered sweeps: it left the area, not "landed".
  const out = {
    military: { ok: true, at: NOW, aircraft: [{ ...sam, ...far }] },
  };
  ingest(log, snap(out), NOW + 4 * MIN);
  ingest(log, snap(out), NOW + 6 * MIN);
  const [left] = ingest(log, snap(out), NOW + 8 * MIN);
  assert.equal(left.change, 'cleared');
  assert.equal(left.title, 'SAM745 (C-37) left the Cape May area');
  assert.equal(left.threadId, up.id);

  // AF1 and a VC-25A under another callsign are followed anywhere.
  const log2 = createEventLog();
  const vc = {
    hex: 'adfdf9',
    flight: 'SAM29000',
    t: 'VC25',
    r: '92-9000',
    ...far,
  };
  const af1 = { hex: 'adfdf8', flight: 'AF1', t: 'VC25', r: '82-8000', ...far };
  const events = ingest(
    log2,
    snap({ military: { ok: true, at: NOW, aircraft: [vc, af1] } }),
    NOW,
  );
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => /^AF1 airborne/.test(e.title)));
  assert.ok(
    events.some((e) =>
      /^VC-25A 29000 \(callsign SAM29000\) airborne/.test(e.title),
    ),
  );
});

test('Coast Guard: by callsign or a Coast Guard type with a 4-digit tail, only over the county area', () => {
  assert.equal(
    coastGuardType({ hex: 'adf9a1', flight: 'C6031', t: 'H60', r: '6031' }),
    'MH-60T',
  );
  assert.equal(
    coastGuardType({ hex: 'adf9a1', flight: '', t: 'H60', r: '6031' }),
    'MH-60T',
  );
  assert.equal(
    coastGuardType({
      hex: 'ae6497',
      flight: 'CARD60',
      t: 'H60',
      r: '19-21069',
    }),
    null,
    'an Army Black Hawk',
  );
  assert.equal(
    coastGuardType({
      hex: 'ae4afe',
      flight: 'RCH5085',
      t: 'C30J',
      r: '08-5693',
    }),
    null,
    'a USAF C-130J',
  );
  assert.equal(
    coastGuardType({ hex: 'ae2005', flight: 'C2005', t: 'C30J', r: '2005' }),
    'HC-130J',
  );
  assert.equal(
    coastGuardType({ hex: 'ae2237', flight: '', t: 'H65', r: '' }),
    'MH-65',
  );
  assert.equal(
    coastGuardType({ hex: 'ae0c35', flight: 'COAST01', t: 'CN35' }),
    'HC-144',
  );
  assert.equal(
    coastGuardType({ hex: '3b9bf7', flight: '', t: 'AS65', r: '' }),
    null,
    'a French Navy Dauphin is not the Coast Guard',
  );
  assert.equal(
    coastGuardType({ hex: '3b75ec', flight: 'CTM2041', t: 'CN35', r: '1234' }),
    null,
    'a foreign CN-235 is not an HC-144',
  );

  const log = createEventLog();
  const outside = cgHelo({ lat: 39.6, lon: -74.3 }); // north of the county area
  const army = {
    ...cgHelo(NORTH_WILDWOOD),
    hex: 'ae6497',
    flight: 'CARD60',
    r: '19-21069',
  };
  assert.deepEqual(
    ingest(
      log,
      snap({ military: { ok: true, at: NOW, aircraft: [outside, army] } }),
      NOW,
    ),
    [],
  );
  const [over] = ingest(
    log,
    snap({
      military: { ok: true, at: NOW, aircraft: [cgHelo(NORTH_WILDWOOD)] },
    }),
    NOW + 2 * MIN,
  );
  assert.equal(over.title, 'Coast Guard MH-60T over North Wildwood, 800 ft');
  assert.equal(over.place, 'North Wildwood');
  for (const t of [4, 6])
    ingest(
      log,
      snap({ military: { ok: true, at: NOW, aircraft: [outside] } }),
      NOW + t * MIN,
    );
  const [left] = ingest(
    log,
    snap({ military: { ok: true, at: NOW, aircraft: [outside] } }),
    NOW + 8 * MIN,
  );
  assert.equal(left.change, 'cleared');
  assert.equal(left.title, 'Coast Guard MH-60T no longer over Cape May County');
});

// ------------------------------------------------------------------ storms

test('Saffir-Simpson category from sustained wind in knots', () => {
  const cases = [
    [63, null],
    [64, 1],
    [82, 1],
    [83, 2],
    [95, 2],
    [96, 3],
    [112, 3],
    [113, 4],
    [136, 4],
    [137, 5],
    [160, 5],
  ];
  for (const [kt, cat] of cases)
    assert.equal(hurricaneCategory(kt), cat, `${kt} kt`);
});

test('storms: new, category change, class change, removed; Pacific storms skipped', () => {
  const log = createEventLog();
  const [first] = ingest(
    log,
    snap({
      storms: {
        ok: true,
        at: NOW,
        storms: [
          storm(),
          storm({ id: 'ep102026', basin: 'EP', name: 'Pacific' }),
        ],
      },
    }),
    NOW,
  );
  assert.equal(first.title, 'Hurricane Ernesto (Category 1) · 75 kt');
  assert.match(first.place, /^[\d,]+ mi (S|SSE|SE) of Cape May$/);
  assert.equal(first.layer, 'weather-cyclones');
  assert.equal(first.at, NOW - 60 * MIN);
  const [cat2] = ingest(
    log,
    snap({ storms: { ok: true, at: NOW, storms: [storm({ windKt: 85 })] } }),
    NOW + 15 * MIN,
  );
  assert.equal(cat2.title, 'Hurricane Ernesto upgraded to Category 2 · 85 kt');
  const [ts] = ingest(
    log,
    snap({
      storms: {
        ok: true,
        at: NOW,
        storms: [storm({ classification: 'TS', windKt: 60 })],
      },
    }),
    NOW + 30 * MIN,
  );
  assert.equal(
    ts.title,
    'Hurricane Ernesto downgraded to Tropical Storm · 60 kt',
  );
  // Not fetched this sweep (undefined): nothing happens.
  assert.deepEqual(
    ingest(
      log,
      { envelopes: snap().envelopes, storms: undefined },
      NOW + 32 * MIN,
    ),
    [],
  );
  const [gone] = ingest(
    log,
    snap({ storms: { ok: true, at: NOW, storms: [] } }),
    NOW + 45 * MIN,
  );
  assert.equal(gone.title, 'NHC no longer lists Tropical Storm Ernesto');
});

test('a depression that is named on upgrade keeps its thread and says both names', () => {
  const log = createEventLog();
  ingest(
    log,
    snap({
      storms: {
        ok: true,
        at: NOW,
        storms: [storm({ classification: 'TD', name: 'Five', windKt: 30 })],
      },
    }),
    NOW,
  );
  const [named] = ingest(
    log,
    snap({
      storms: {
        ok: true,
        at: NOW,
        storms: [storm({ classification: 'TS', name: 'Ernesto', windKt: 40 })],
      },
    }),
    NOW + 15 * MIN,
  );
  assert.equal(
    named.title,
    'Tropical Depression Five upgraded to Tropical Storm Ernesto · 40 kt',
  );
});

// ------------------------------------------------------------------ summary

test('summary: quiet', () => {
  const log = createEventLog();
  ingest(log, snap(), NOW);
  assert.deepEqual(log.summary, {
    at: NOW,
    lines: [
      {
        text: 'Quiet: no NWS alerts, no open incidents in the last 2 hours.',
        tone: 'ok',
        source: 'NWS · Fire Wire scanner · TomTom traffic · Community reports',
        eventId: null,
      },
    ],
  });
});

test('summary: quiet does not claim "no incidents" when the incident feeds are down', () => {
  const log = createEventLog();
  ingest(
    log,
    snap({
      calls: { status: 'unavailable', fetchedAt: null, features: [] },
      traffic: { status: 'unavailable', fetchedAt: null, features: [] },
    }),
    NOW,
  );
  assert.equal(log.summary.lines.length, 1);
  assert.equal(
    log.summary.lines[0].text,
    'No NWS alerts. No open incidents in the last 2 hours from the feeds answering; scanner calls and traffic incidents are not answering.',
  );
});

test('summary: busy, worst first, each line with its source', () => {
  const log = createEventLog();
  ingest(
    log,
    snap({
      alerts: env([alert()]),
      calls: env([
        call('f', RIO_GRANDE, NOW - 20 * MIN),
        call('r', NORTH_WILDWOOD, NOW - 10 * MIN, {
          title: 'Water Rescue',
          municipality: 'North Wildwood',
          priority: 'medium',
        }),
      ]),
      traffic: env([traffic('t', { lat: 39.12, lon: -74.79 }, NOW - 15 * MIN)]),
      gauges: env([gauge('moderate')]),
      outages: outagesEnv(1240, [
        {
          id: 'x',
          county: 'Cape May',
          title: 'Ocean City',
          customersOut: 800,
          geometry: point({ lat: 39.27, lon: -74.57 }),
        },
      ]),
      faa: {
        ok: true,
        at: NOW,
        local: [
          {
            airport: 'PHL',
            category: 'ground-stop',
            reason: 'WX:Thunderstorms',
          },
        ],
      },
      storms: {
        ok: true,
        at: NOW,
        storms: [
          storm({ windKt: 100, position: { latitude: 33, longitude: -72 } }),
        ],
      },
      military: { ok: true, at: NOW, aircraft: [cgHelo(NORTH_WILDWOOD)] },
    }),
    NOW,
  );
  const lines = log.summary.lines;
  const texts = lines.map((l) => l.text);
  assert.deepEqual(texts, [
    'Hurricane Ernesto (Category 3) · 100 kt · 441 mi SSE of Cape May',
    'Coastal Flood Warning until 10:00 PM',
    '3 open: water rescue in North Wildwood, road closed on Route 47, structure fire in Rio Grande',
    'Moderate flooding observed at Cape May Harbor',
    'Power out for 1,240 customers in Cape May County',
    'Ground stop at KPHL',
    'Coast Guard MH-60T over North Wildwood, 800 ft',
  ]);
  assert.deepEqual(
    lines.map((l) => l.tone),
    ['danger', 'warn', 'warn', 'warn', 'warn', 'warn', 'ok'],
  );
  assert.deepEqual(
    lines.map((l) => l.source),
    [
      'NHC',
      'NWS',
      'Fire Wire scanner · TomTom traffic',
      'NOAA water gauges',
      'Atlantic City Electric',
      'FAA',
      'adsb.lol',
    ],
  );
  for (const l of lines)
    assert.ok(
      log.events.some((e) => e.id === l.eventId),
      l.text,
    );
  // Incidents older than 2 hours are no longer "open".
  const later = summarize(log, NOW + 3 * 60 * MIN);
  assert.ok(!later.lines.some((l) => /open:/.test(l.text)));
});

// ------------------------------------------------------------------ persistence, route, sweep

test('persistence round-trip: atomic 0600 file; missing or corrupt file starts empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-events-'));
  const file = path.join(dir, 'nested', 'event-log.json');
  const log = createEventLog();
  ingest(
    log,
    snap({
      alerts: env([alert()]),
      calls: env([call('p', RIO_GRANDE, NOW - 5 * MIN)]),
      military: { ok: true, at: NOW, aircraft: [cgHelo(NORTH_WILDWOOD)] },
    }),
    NOW,
  );
  saveEventLog(log, file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)),
    ['event-log.json'],
    'no temp file left behind',
  );
  const back = loadEventLog(file);
  assert.deepEqual(back.events, log.events);
  assert.deepEqual(back.items, log.items);
  assert.deepEqual(back.summary, log.summary);
  assert.deepEqual(back.sources, log.sources);
  // The restored log carries on: the same items are not "new" again.
  const again = ingest(
    back,
    snap({
      alerts: env([alert()]),
      calls: env([call('p', RIO_GRANDE, NOW - 5 * MIN)]),
      military: { ok: true, at: NOW, aircraft: [cgHelo(NORTH_WILDWOOD)] },
    }),
    NOW + 2 * MIN,
  );
  assert.deepEqual(again, []);

  assert.deepEqual(
    loadEventLog(path.join(dir, 'missing.json')),
    createEventLog(),
  );
  fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
  assert.deepEqual(loadEventLog(path.join(dir, 'bad.json')), createEventLog());
  fs.writeFileSync(
    path.join(dir, 'odd.json'),
    JSON.stringify({ version: 1, events: [{ id: 1 }, null], items: [] }),
  );
  assert.deepEqual(loadEventLog(path.join(dir, 'odd.json')).events, []);
});

test('route: shape, since filter, validation, newest first, at most 200', () => {
  const log = createEventLog();
  ingest(
    log,
    snap({ calls: env([call('a', RIO_GRANDE, NOW - 50 * MIN)]) }),
    NOW,
  );
  ingest(
    log,
    snap({
      calls: env([
        call('a', RIO_GRANDE, NOW - 50 * MIN),
        call('b', NORTH_WILDWOOD, NOW - 1 * MIN, {
          title: 'Medical Emergency',
        }),
      ]),
    }),
    NOW + 2 * MIN,
  );
  const [status, all] = eventsRoute(new URLSearchParams(''), {
    log,
    now: NOW + 3 * MIN,
  });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(all), [
    'generatedAt',
    'summary',
    'sources',
    'events',
  ]);
  assert.equal(all.generatedAt, NOW + 3 * MIN);
  assert.deepEqual(
    all.events.map((e) => e.key),
    ['call:firewire:b', 'call:firewire:a'],
  );
  assert.deepEqual(Object.keys(all.events[0]), [
    'id',
    'key',
    'kind',
    'change',
    'title',
    'place',
    'detail',
    'at',
    'seenAt',
    'lat',
    'lon',
    'layer',
    'severity',
    'source',
    'threadId',
    'related',
  ]);
  assert.equal(all.sources.length, 9);
  assert.deepEqual(Object.keys(all.sources[0]), ['id', 'name', 'ok', 'at']);

  const [, since] = eventsRoute(new URLSearchParams(`since=${NOW}`), {
    log,
    now: NOW + 3 * MIN,
  });
  assert.deepEqual(
    since.events.map((e) => e.key),
    ['call:firewire:b'],
  );
  for (const bad of ['abc', '-5', 'Infinity', '1e400'])
    assert.equal(
      eventsRoute(new URLSearchParams(`since=${bad}`), { log })[0],
      400,
      bad,
    );

  const big = createEventLog();
  big.events = Array.from({ length: 450 }, (_, i) => ({
    id: `e${i}`,
    key: `call:firewire:${i}`,
    kind: 'call',
    change: 'new',
    title: 'x',
    place: '',
    detail: '',
    at: NOW - i * MIN,
    seenAt: NOW,
    lat: null,
    lon: null,
    layer: 'scanner-calls',
    severity: 'info',
    source: 'Fire Wire scanner',
    threadId: `e${i}`,
    related: [],
  }));
  const res = eventLogResponse(big, { now: NOW });
  assert.equal(res.events.length, 200);
  assert.equal(res.events[0].id, 'e0');
  // Events older than 48 hours are not served.
  assert.equal(
    eventLogResponse(big, { now: NOW + 49 * 60 * MIN }).events.length,
    0,
  );
});

test('route before the first sweep, and when turned off', () => {
  const log = createEventLog();
  const [, body] = eventsRoute(null, { log, now: NOW, env: {} });
  assert.equal(body.summary.lines.length, 1);
  assert.match(body.summary.lines[0].text, /^Starting up/);
  log.summary = {
    at: NOW - 86_400_000,
    lines: [{ text: 'Quiet: stale', tone: 'ok', source: 'x', eventId: null }],
  };
  const [, off] = eventsRoute(null, {
    log,
    now: NOW,
    env: { GEV_EVENT_LOG: '0' },
  });
  assert.equal(
    off.summary.lines[0].text,
    'The county event log is turned off on this server.',
  );
  assert.equal(
    installEventLog({
      env: { GEV_EVENT_LOG: '0' },
      loadEnvelopes: async () => ({}),
    }),
    false,
  );
  assert.equal(installEventLog({ env: {} }), false, 'no loader, no sweep');
});

test('sweep: storms at most every 15 minutes, adsb.lol backs off after a rate limit, file saved', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-sweep-'));
  const file = path.join(dir, 'event-log.json');
  const log = createEventLog();
  const calls = { storms: 0, military: 0, faa: 0 };
  const fetchers = {
    fetchStorms: async () => (
      calls.storms++,
      { ok: true, at: NOW, storms: [] }
    ),
    fetchMilitary: async () => (
      calls.military++,
      { ok: false, at: NOW, status: 429 }
    ),
    fetchFaa: async () => (calls.faa++, { ok: true, at: NOW, local: [] }),
  };
  const loadEnvelopes = async () => snap().envelopes;
  await runEventSweep({ log, loadEnvelopes, fetchers, now: NOW, file });
  await runEventSweep({
    log,
    loadEnvelopes,
    fetchers,
    now: NOW + 2 * MIN,
    file,
  });
  assert.deepEqual(calls, { storms: 1, military: 1, faa: 2 });
  await runEventSweep({
    log,
    loadEnvelopes,
    fetchers,
    now: NOW + 16 * MIN,
    file,
  });
  assert.deepEqual(calls, { storms: 2, military: 2, faa: 3 });
  assert.ok(fs.existsSync(file));
  assert.equal(loadEventLog(file).summary.at, NOW + 16 * MIN);
  // A loader that throws is a failed sweep for those sources, not a crash.
  const events = await runEventSweep({
    log,
    loadEnvelopes: async () => {
      throw new Error('boom');
    },
    fetchers,
    now: NOW + 18 * MIN,
  });
  assert.deepEqual(events, []);
});

// ------------------------------------------------------------------ fixes and resilience

test('a source time in the future is clamped to now', () => {
  const log = createEventLog();
  const planned = traffic('later', RIO_GRANDE, NOW + 3 * 60 * MIN, {
    title: 'Road works',
  });
  const [ev] = ingest(log, snap({ traffic: env([planned]) }), NOW);
  assert.equal(ev.at, NOW);
});

test('an update does not link again to an item its thread already names', () => {
  const log = createEventLog();
  const t = traffic('crash', RIO_GRANDE, NOW - 30 * MIN, {
    title: 'Crash',
    road: '',
    from: '',
  });
  const c = call('c', north(RIO_GRANDE, 0.3), NOW - 25 * MIN);
  const first = ingest(log, snap({ traffic: env([t]), calls: env([c]) }), NOW);
  const tEv = byKind(first, 'traffic')[0];
  const cEv = byKind(first, 'call')[0];
  assert.equal(tEv.related[0].id, cEv.id);
  const [update] = ingest(
    log,
    snap({
      traffic: env([{ ...t, title: 'Road closed' }]),
      calls: env([c]),
    }),
    NOW + 2 * MIN,
  );
  assert.equal(update.change, 'update');
  assert.deepEqual(update.related, [{ id: tEv.id, reason: 'update' }]);
  assert.deepEqual(cEv.related, [
    { id: tEv.id, reason: '0.3 mi and 5 min apart' },
  ]);
});

test('a hurricane advisory without a wind value is not a category change', () => {
  const log = createEventLog();
  ingest(
    log,
    snap({ storms: { ok: true, at: NOW, storms: [storm({ windKt: 90 })] } }),
    NOW,
  );
  const quiet = ingest(
    log,
    snap({ storms: { ok: true, at: NOW, storms: [storm({ windKt: null })] } }),
    NOW + 15 * MIN,
  );
  assert.deepEqual(quiet, []);
  assert.ok(!log.events.some((e) => /null/.test(e.title)));
});

test('warnOnce: once per stage and kind of error (digits masked), again after 6 hours', () => {
  resetEventLogWarnings();
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  assert.equal(warnOnce('feed:military', 'adsb.lol: HTTP 429', NOW, log), true);
  assert.equal(
    warnOnce('feed:military', 'adsb.lol: HTTP 429', NOW + 2 * MIN, log),
    false,
  );
  assert.equal(
    warnOnce('feed:military', 'adsb.lol: HTTP 503', NOW + 4 * MIN, log),
    false,
  );
  assert.equal(warnOnce('feed:storms', 'adsb.lol: HTTP 429', NOW, log), true);
  assert.equal(warnOnce('save', new Error('EACCES'), NOW, log), true);
  assert.equal(warnOnce('feed:military', 'no aircraft list', NOW, log), true);
  assert.equal(
    warnOnce('feed:military', 'adsb.lol: HTTP 429', NOW + 6 * 60 * MIN, log),
    true,
  );
  assert.deepEqual(lines, [
    '[EventLog:feed:military] adsb.lol: HTTP 429',
    '[EventLog:feed:storms] adsb.lol: HTTP 429',
    '[EventLog:save] EACCES',
    '[EventLog:feed:military] no aircraft list',
    '[EventLog:feed:military] adsb.lol: HTTP 429',
  ]);
  // A logger that throws never stops the caller.
  assert.equal(
    warnOnce('x', 'y', NOW, () => {
      throw new Error('logger down');
    }),
    true,
  );
});

test('a bad record is logged once, never cleared, and the rest of the sweep goes on', (t) => {
  resetEventLogWarnings();
  const warn = t.mock.method(console, 'warn', () => {});
  const log = createEventLog();
  const one = call(1, RIO_GRANDE, NOW - 5 * MIN);
  ingest(log, snap({ calls: env([one]) }), NOW);
  // A saved item from an older or damaged file: its snapshot is not a string.
  log.items['call:firewire:1'].snap = { type: 42 };
  const two = call(2, NORTH_WILDWOOD, NOW, { title: 'Medical Emergency' });
  for (let i = 1; i <= 4; i++) {
    const events = ingest(
      log,
      snap({ calls: env(i === 1 ? [one, two] : [one, two]) }),
      NOW + i * 2 * MIN,
    );
    if (i === 1)
      assert.deepEqual(
        events.map((e) => e.key),
        ['call:firewire:2'],
      );
    else assert.deepEqual(events, []);
  }
  assert.equal(log.items['call:firewire:1'].status, 'active');
  assert.equal(log.sources.calls.ok, true);
  assert.deepEqual(
    warn.mock.calls.map((c) => c.arguments[0]),
    ['[EventLog:observe:calls]'],
  );
});

test('an adapter that throws costs only that source the sweep, and is logged once', (t) => {
  resetEventLogWarnings();
  const warn = t.mock.method(console, 'warn', () => {});
  const log = createEventLog();
  ingest(
    log,
    snap({
      calls: env([call(1, RIO_GRANDE, NOW - 5 * MIN)]),
      alerts: env([alert()]),
    }),
    NOW,
  );
  const poisoned = {
    id: 'call:bad',
    get geometry() {
      throw new Error('unexpected record shape');
    },
  };
  for (let i = 1; i <= 5; i++)
    assert.deepEqual(
      ingest(
        log,
        snap({ calls: env([poisoned]), alerts: env([alert()]) }),
        NOW + i * 2 * MIN,
      ),
      [],
    );
  assert.equal(log.sources.calls.ok, false);
  assert.equal(log.sources.alerts.ok, true);
  assert.equal(log.items['call:firewire:1'].status, 'active', 'not cleared');
  assert.deepEqual(
    warn.mock.calls.map((c) => c.arguments.join(' ')),
    ['[EventLog:source:calls] unexpected record shape'],
  );
});

test('settle: a value, a fallback on throw or timeout, and a late rejection is handled', async (t) => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  assert.equal(
    await settle(
      async () => 7,
      50,
      () => 0,
    ),
    7,
  );
  assert.equal(
    await settle(
      () => {
        throw new Error('sync');
      },
      50,
      (e) => e.message,
    ),
    'sync',
  );
  assert.equal(
    await settle(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('late')), 30),
        ),
      5,
      (e) => e.message,
    ),
    'no answer within 5 ms',
  );
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(unhandled, []);
});

test('a sweep never hangs or throws: stalled or failing inputs are "not answering", each logged once', async (t) => {
  resetEventLogWarnings();
  const warn = t.mock.method(console, 'warn', () => {});
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const never = () => new Promise(() => {});
  const lateReject = () =>
    new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 40));
  const fetchers = {
    fetchMilitary: never,
    fetchStorms: lateReject,
    fetchFaa: async () => {
      throw new Error('FAA exploded');
    },
  };
  const log = createEventLog();
  ingest(log, snap({ calls: env([call(1, RIO_GRANDE, NOW - 5 * MIN)]) }), NOW);
  for (let i = 1; i <= 3; i++) {
    const started = Date.now();
    const events = await runEventSweep({
      log,
      loadEnvelopes: never,
      fetchers,
      now: NOW + i * 16 * MIN,
      timeouts: { loaderMs: 20, feedMs: 20 },
    });
    assert.deepEqual(events, []);
    assert.ok(Date.now() - started < 1000, 'settled on its deadlines');
  }
  await new Promise((r) => setTimeout(r, 80)); // let the late rejections land
  assert.deepEqual(unhandled, []);
  const res = eventLogResponse(log, { now: NOW + 50 * MIN });
  assert.ok(res.sources.every((s) => s.ok === false));
  assert.equal(log.items['call:firewire:1'].status, 'active', 'not cleared');
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments.join(' ')).sort(), [
    '[EventLog:envelopes] no answer within 20 ms',
    '[EventLog:feed:faa] FAA NAS Status: FAA exploded',
    '[EventLog:feed:military] adsb.lol /v2/mil: no answer within 20 ms',
    '[EventLog:feed:storms] NHC CurrentStorms.json: no answer within 20 ms',
  ]);

  // A damaged log object and an unwritable file: logged once each, no throw.
  resetEventLogWarnings();
  warn.mock.resetCalls();
  const okFetchers = {
    fetchMilitary: async () => ({ ok: true, at: NOW, aircraft: [] }),
    fetchStorms: async () => ({ ok: true, at: NOW, storms: [] }),
    fetchFaa: async () => ({ ok: true, at: NOW, local: [] }),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-unwritable-'));
  fs.writeFileSync(path.join(dir, 'a-file'), 'x');
  const file = path.join(dir, 'a-file', 'event-log.json'); // parent is a file
  const broken = { ...createEventLog(), events: null };
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      await runEventSweep({
        log: broken,
        loadEnvelopes: async () => snap().envelopes,
        fetchers: okFetchers,
        now: NOW + i * 2 * MIN,
        file,
      }),
      [],
    );
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments[0]).sort(), [
    '[EventLog:ingest]',
    '[EventLog:save]',
  ]);
});

test("the sweep starts once per process (Symbol.for guard) on unref'd timers", (t) => {
  const SWEEP = Symbol.for('gev.eventLog.sweep');
  const SHARED = Symbol.for('gev.eventLog.log');
  const saved = { sweep: globalThis[SWEEP], shared: globalThis[SHARED] };
  // Restore the guard to "started" so nothing later in this file can start
  // a real sweep against the network.
  t.after(() => {
    globalThis[SWEEP] = true;
    globalThis[SHARED] = saved.shared;
  });
  delete globalThis[SWEEP];
  globalThis[SHARED] = createEventLog();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-install-'));
  const timers = () =>
    process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const before = timers();
  const options = {
    env: { GEV_DATA_DIR: dir },
    loadEnvelopes: async () => ({}),
    fetchImpl: async () => {
      throw new Error('offline in tests');
    },
  };
  assert.equal(installEventLog(options), true);
  assert.equal(installEventLog(options), false, 'second install: no new sweep');
  assert.equal(timers(), before, 'the timers do not hold the process open');
});

test('GET /api/local/events through the real /api/local middleware', async (t) => {
  const SWEEP = Symbol.for('gev.eventLog.sweep');
  const SHARED = Symbol.for('gev.eventLog.log');
  const WATCH = Symbol.for('gev.watchList.sweep');
  const saved = {
    sweep: globalThis[SWEEP],
    shared: globalThis[SHARED],
    watch: globalThis[WATCH],
  };
  t.after(() => {
    globalThis[SWEEP] = saved.sweep;
    globalThis[SHARED] = saved.shared;
    globalThis[WATCH] = saved.watch;
  });
  // No background sweeps from installing the plugin in a test.
  globalThis[SWEEP] = true;
  globalThis[WATCH] = true;
  const log = createEventLog();
  const now = Date.now();
  ingest(
    log,
    snap({ calls: env([call('mw', RIO_GRANDE, now - 5 * MIN)]) }),
    now - 4 * MIN,
  );
  ingest(
    log,
    snap({
      calls: env([
        call('mw', RIO_GRANDE, now - 5 * MIN),
        call('mw2', NORTH_WILDWOOD, now - MIN, { title: 'Medical Emergency' }),
      ]),
    }),
    now - 2 * MIN,
  );
  globalThis[SHARED] = log;
  const { localAwarenessProxy } = await import('./index.js');
  const mounted = [];
  localAwarenessProxy().configureServer({
    middlewares: {
      use: (route, handler) =>
        mounted.push(
          typeof route === 'string' ? [route, handler] : ['', route],
        ),
    },
  });
  const handler = mounted.find(([route]) => route === '/api/local')?.[1];
  assert.ok(handler, '/api/local is mounted');
  const get = (url) =>
    new Promise((resolve, reject) => {
      const res = {
        headers: {},
        setHeader(k, v) {
          this.headers[k] = v;
        },
        writeHead(status, headers) {
          this.statusCode = status;
          Object.assign(this.headers, headers);
        },
        end(body) {
          resolve({ status: this.statusCode, headers: this.headers, body });
        },
      };
      Promise.resolve(
        handler(
          { url, method: 'GET', headers: { host: 'localhost:5173' } },
          res,
          () => reject(new Error('fell through')),
        ),
      ).catch(reject);
    });
  const all = await get('/events');
  assert.equal(all.status, 200);
  assert.equal(all.headers['Content-Type'], 'application/json');
  assert.equal(all.headers['Cache-Control'], 'no-store');
  const body = JSON.parse(all.body);
  assert.deepEqual(
    body.events.map((e) => e.key),
    ['call:firewire:mw2', 'call:firewire:mw'],
  );
  const since = JSON.parse((await get(`/events?since=${now - 3 * MIN}`)).body);
  assert.deepEqual(
    since.events.map((e) => e.key),
    ['call:firewire:mw2'],
  );
  assert.equal((await get('/events?since=yesterday')).status, 400);
});

test('saveEventLog sets 0600 even over a temp file left by a crashed write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-mode-'));
  const file = path.join(dir, 'event-log.json');
  fs.writeFileSync(`${file}.${process.pid}.tmp`, 'stale', { mode: 0o644 });
  saveEventLog(createEventLog(), file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['event-log.json']);
});
