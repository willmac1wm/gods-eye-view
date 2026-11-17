import assert from 'node:assert/strict';
import test from 'node:test';
import { createVdl2Layer } from './index.js';
import { normalizeVdl2Snapshot } from './records.js';

const T0 = 1_793_123_456_789;

const maydayRow = {
  id: '8135359152',
  stableId: 'vdl2:8135359152',
  flight: 'MX501',
  tail: 'N219BZ',
  fromHex: 'A12345',
  label: 'H1',
  mode: '2',
  frequency: 136.65,
  stationIdent: 'PhillyRox-VDLM',
  stationAirport: 'KPHL',
  category: 'mayday',
  severity: 'critical',
  undecoded: false,
  hasPosition: true,
  lat: 39.5,
  lon: -74.9,
  timeMs: T0 - 60_000,
  url: 'https://api.airframes.io/v1/messages/8135359152',
};

const undecodedRow = {
  id: '8135359153',
  stableId: 'vdl2:8135359153',
  flight: 'BAW123',
  tail: 'G-XLEA',
  fromHex: '400123',
  label: null,
  mode: null,
  frequency: 136.65,
  stationIdent: 'PhillyRox-VDLM',
  stationAirport: 'KPHL',
  category: 'undecoded',
  severity: 'info',
  undecoded: true,
  hasPosition: false,
  lat: null,
  lon: null,
  timeMs: T0 - 30_000,
  url: 'https://api.airframes.io/v1/messages/8135359153',
};

const payload = {
  fetchedAt: T0,
  stale: false,
  heardLocal: 100,
  heardTruncated: true,
  stationFlagged: true,
  stationFlagReason: 'Rate anomaly detected',
  rows: [maydayRow, undecodedRow],
};

const snapshot = () => normalizeVdl2Snapshot(payload);

function harness(getSnapshot) {
  const sources = [];
  const events = [];
  const visible = [];
  const cleared = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createVdl2Layer({
    source: {
      async getSnapshot(...args) {
        return getSnapshot(...args);
      },
    },
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
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events, visible, cleared };
}

test('createVdl2Layer requires a snapshot source and an overlay host, and single init', () => {
  assert.throws(() => createVdl2Layer({}), /snapshot source/);
  assert.throws(() => createVdl2Layer(), /snapshot source/);
  assert.throws(
    () => createVdl2Layer({ source: { getSnapshot: async () => ({}) } }),
    /overlay host/,
  );
  const h = harness(snapshot);
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
});

test('update pins only positioned rows and lists the rest', async () => {
  const h = harness(snapshot);
  assert.equal(await h.layer.update(), true);
  const entities = h.sources[0].entities.values;
  assert.equal(entities.length, 1);
  assert.equal(entities[0].id, 'vdl2:8135359152');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'vdl2');
  assert.equal(h.events[0][1].length, 1);
  assert.equal(h.events[0][1][0].title, 'MX501 · Mayday call');
  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.categorized, 1);
  assert.equal(stats.undecoded, 1);
  assert.equal(stats.pinned, 1);
  assert.equal(stats.listOnly, 1);
  assert.equal(stats.heardLocal, 100);
  assert.equal(stats.heardTruncated, true);
  assert.equal(stats.stationFlagged, true);
  assert.equal(stats.stationFlagReason, 'Rate anomaly detected');
  assert.equal(stats.stale, false);
  assert.equal(stats.fallback, false);
  assert.equal(stats.error, null);
});

test('row controls lead with the last-hour counts and the feeder flag', async () => {
  const h = harness(snapshot);
  const before = h.layer.getRowControls();
  assert.match(before.info, /not loaded yet/);
  assert.deepEqual(before.legend, []);
  assert.equal(await h.layer.update(), true);
  const controls = h.layer.getRowControls();
  assert.match(controls.info, /Last hour · 2 messages \(1 categorized, 1 undecoded\)/);
  assert.match(controls.info, /heard locally: 100\+/);
  assert.match(controls.info, /feeder flagged by airframes\.io/);
  assert.match(controls.infoTitle, /Only the category is shown/);
  assert.match(controls.infoTitle, /not presented as a CPDLC feed/);
  assert.match(controls.infoTitle, /a stale fix is not pinned/);
  assert.deepEqual(
    controls.legend.map((entry) => entry.label),
    ['Mayday call', 'Undecoded frame'],
  );
  assert.deepEqual(
    controls.legend.map((entry) => entry.count),
    [1, 1],
  );
  assert.match(controls.legend[0].blurb, /raw text is never shown/);
  assert.match(controls.legend[0].blurb, /local-only/);
  assert.equal(controls.legend[1].blurb, undefined);
});

test('analyst records cover every row, and are empty while disabled', async () => {
  const h = harness(snapshot);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  assert.equal(await h.layer.update(), true);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'vdl2:8135359153');
  assert.equal(records[0].category, 'undecoded');
  assert.equal(records[0].hasPosition, false);
  assert.equal(records[1].id, 'vdl2:8135359152');
  assert.equal(records[1].category, 'mayday');
  assert.equal(records[1].hasPosition, true);
  assert.equal('text' in records[0], false);
  assert.deepEqual(
    h.layer.getAnalystRecords(1).map((row) => row.id),
    ['vdl2:8135359153'],
  );
  h.layer.disable();
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('a failed update keeps the last rows and reports the error', async () => {
  let fail = false;
  const h = harness(async () => {
    if (fail) throw new Error('VDL2 HTTP 502');
    return snapshot();
  });
  assert.equal(await h.layer.update(), true);
  assert.equal(h.layer.getStats().count, 2);
  fail = true;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getStats().error, 'VDL2 HTTP 502');
  assert.match(h.layer.getRowControls().info, /Last hour/);
});

test('disable hides the data source and clears the overlay; destroy removes it', async () => {
  const h = harness(snapshot);
  assert.equal(await h.layer.update(), true);
  assert.equal(h.sources[0].show, true);
  h.layer.disable();
  assert.equal(h.sources[0].show, false);
  assert.deepEqual(h.cleared[h.cleared.length - 1], ['vdl2']);
  h.layer.destroy(h.viewer);
  assert.equal(h.sources.length, 0);
  assert.equal(h.layer.getStats().count, 0);
});
