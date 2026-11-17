import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryLayer } from './index.js';

const T0 = 1794772800000;
const HOUR = 3600 * 1000;

const status = {
  aircraftRows: 3,
  feedRows: 2,
  oldestMs: T0 - 30 * HOUR,
  newestMs: T0 + 30 * 60_000,
};

const aircraftRows = [
  { hex: 'a1', kind: 'air', flight: 'N123', lat: 39.0, lon: -74.9, alt: 5000, speed: 200, track: 90, seenAt: T0 },
  { hex: 'a1', kind: 'air', flight: 'N123', lat: 39.01, lon: -74.89, alt: 5100, speed: 201, track: 91, seenAt: T0 + 10 * 60_000 },
  { hex: 'a2', kind: 'mil', flight: 'RCH1', lat: 39.1, lon: -74.8, alt: 20000, speed: 400, track: 270, seenAt: T0 + 30 * 60_000 },
];

const feedRows = [
  { id: 'f1', source: 'firewire', sourceLabel: 'Fire Wire', cat: 'fire', type: 'DISPATCH', title: 'Structure fire', lat: 39.0, lng: -74.9, pubMs: T0 + 2 * 60_000 },
  { id: 'f2', source: 'nws', sourceLabel: 'NWS', cat: 'weather', type: 'ALERT', title: 'Freeze Warning', lat: 39.0, lng: -74.9, pubMs: T0 + 20 * 60_000 },
];

function harness({ timers = null } = {}) {
  const events = [];
  const visible = [];
  const cleared = [];
  let now = 0;
  const scheduled = new Map();
  let nextId = 1;
  const setTimeoutImpl =
    timers?.setTimeoutImpl ??
    ((fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, at: now + ms });
      return id;
    });
  const clearTimeoutImpl =
    timers?.clearTimeoutImpl ??
    ((id) => {
      scheduled.delete(id);
    });
  const source = {
    getStatus: async () => status,
    getWindow: async () => ({
      aircraft: { count: 3, fromMs: T0 - 30 * 60_000, untilMs: T0 + 30 * 60_000, rows: aircraftRows },
      feed: { count: 2, fromMs: T0 - 30 * 60_000, untilMs: T0 + 30 * 60_000, rows: feedRows },
      fromMs: T0 - 30 * 60_000,
      untilMs: T0 + 30 * 60_000,
    }),
  };
  const layer = createHistoryLayer({
    source,
    overlayHost: {
      setEntries(...args) {
        events.push(args);
      },
      setVisible(...args) {
        visible.push(args);
      },
      clearSource(...args) {
        cleared.push(args);
      },
    },
    setTimeoutImpl,
    clearTimeoutImpl,
  });
  layer.init({});
  layer.enable({});
  const runTimers = (ms) => {
    now += ms;
    for (const [id, timer] of [...scheduled.entries()]) {
      if (timer.at <= now) {
        scheduled.delete(id);
        timer.fn();
      }
    }
  };
  return { layer, events, visible, cleared, runTimers, scheduled };
}

test('update fetches the newest hour and starts the cursor at newest', async () => {
  const h = harness();
  assert.equal(await h.layer.update({}), true);
  const state = h.layer.getReplayState();
  assert.equal(state.untilMs, T0 + 30 * 60_000);
  assert.equal(state.cursorMs, T0 + 30 * 60_000);
  assert.equal(state.aircraftRows, 3);
  assert.equal(state.feedRows, 2);
  assert.equal(h.events.length, 1);
  const entries = h.events[0][1];
  assert.equal(entries.length, 4); // summary + 2 aircraft + 1 feed (f2 in lookback)
  assert.match(entries[0].title, /2 aircraft · 1 feed/);
});

test('stepBy moves the cursor and re-renders; setParams jumps', async () => {
  const h = harness();
  await h.layer.update({});
  assert.equal(h.layer.stepBy(-15 * 60_000), true);
  assert.equal(h.layer.getReplayState().cursorMs, T0 + 15 * 60_000);
  // At T0+15m only a1 shows (f1 in lookback).
  const entries = h.events.at(-1)[1];
  assert.equal(entries.length, 3);
  assert.equal(h.layer.setParams({ replayMs: T0 }), true);
  assert.equal(h.layer.getReplayState().cursorMs, T0);
  assert.equal(h.layer.setParams({ replayMs: 'nope' }), false);
  // The cursor clamps to the fetched window.
  assert.equal(h.layer.setReplayTime(T0 + 10 * HOUR), true);
  assert.equal(h.layer.getReplayState().cursorMs, T0 + 30 * 60_000);
});

test('play advances 5 minutes per tick and stops at the window end', async () => {
  const h = harness();
  await h.layer.update({});
  h.layer.setReplayTime(T0);
  assert.equal(h.layer.play(), true);
  assert.equal(h.layer.getReplayState().playing, true);
  h.runTimers(1000);
  assert.equal(h.layer.getReplayState().cursorMs, T0 + 5 * 60_000);
  h.runTimers(1000);
  assert.equal(h.layer.getReplayState().cursorMs, T0 + 10 * 60_000);
  assert.equal(h.layer.pause(), true);
  assert.equal(h.layer.getReplayState().playing, false);
  h.runTimers(5000);
  assert.equal(h.layer.getReplayState().cursorMs, T0 + 10 * 60_000);
  // Play to the end: it stops by itself at untilMs, never past it.
  assert.equal(h.layer.play(), true);
  for (let i = 0; i < 10; i++) h.runTimers(1000);
  const state = h.layer.getReplayState();
  assert.equal(state.cursorMs, T0 + 30 * 60_000);
  assert.equal(state.playing, false);
  assert.equal(h.layer.play(), false);
});

test('row controls carry rewind, play, forward, latest and buckets', async () => {
  const h = harness();
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.deepEqual(
    controls.chips.map((c) => c.id),
    ['rewind-15', 'play', 'forward-15', 'latest'],
  );
  assert.match(controls.info, /aircraft/);
  assert.equal(controls.list.items.length, 4);
  assert.equal(controls.list.items[0].params.replayMs, T0 - 30 * 60_000);
  // The bucket list jumps the cursor through setParams.
  controls.list.items[1].params.replayMs = T0 - 15 * 60_000;
  assert.equal(h.layer.setParams(controls.list.items[1].params), true);
  assert.equal(h.layer.getReplayState().cursorMs, T0 - 15 * 60_000);
});

test('update with no stored history reports an empty window', async () => {
  const events = [];
  const layer = createHistoryLayer({
    source: {
      getStatus: async () => ({
        aircraftRows: 0,
        feedRows: 0,
        oldestMs: null,
        newestMs: null,
      }),
      getWindow: async () => {
        throw new Error('must not fetch without a newest instant');
      },
    },
    overlayHost: {
      setEntries(...args) {
        events.push(args);
      },
      setVisible() {},
      clearSource() {},
    },
  });
  layer.init({});
  layer.enable({});
  assert.equal(await layer.update({}), true);
  assert.match(events[0][1][0].title, /History replay/);
  assert.match(events[0][1][0].details[0], /History unavailable/);
});

test('getAnalystRecords returns stored rows while enabled', async () => {
  const h = harness();
  await h.layer.update({});
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 5);
  assert.equal(records[0].id, 'HISTORY-AIR-a1-1794772800000');
  assert.equal(records.at(-1).id, 'HISTORY-FEED-f2');
  h.layer.disable({});
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});
