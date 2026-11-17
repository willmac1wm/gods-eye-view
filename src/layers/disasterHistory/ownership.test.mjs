import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisasterLayer } from './index.js';
import { STORM_EVENTS_SNAPSHOT } from './records.js';

function harness(source) {
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
  const layer = createDisasterLayer({
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
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events, visible, cleared };
}

const snapshot = {
  fetchedAt: 1,
  stale: false,
  declarations: [
    {
      id: 'DR-4614-NJ',
      disasterNumber: 4614,
      declarationType: 'DR',
      declarationDate: '2021-09-05T00:00:00.000Z',
      incidentType: 'Hurricane',
      declarationTitle: 'REMNANTS OF HURRICANE IDA',
      incidentBeginDate: '2021-09-01T00:00:00.000Z',
      incidentEndDate: '2021-09-03T00:00:00.000Z',
      programs: {
        publicAssistance: true,
        individualAssistance: false,
        hazardMitigation: true,
      },
    },
    {
      id: 'DR-205-NJ',
      disasterNumber: 205,
      declarationType: 'DR',
      declarationDate: '1965-08-18T00:00:00.000Z',
      incidentType: 'Drought',
      declarationTitle: 'WATER SHORTAGE',
      incidentBeginDate: '1965-08-18T00:00:00.000Z',
      incidentEndDate: null,
      programs: {
        publicAssistance: true,
        individualAssistance: false,
        hazardMitigation: false,
      },
    },
  ],
  declarationCount: 34,
  stormEvents: {
    source: STORM_EVENTS_SNAPSHOT.source,
    sourceFiles: STORM_EVENTS_SNAPSHOT.sourceFiles,
    generated: STORM_EVENTS_SNAPSHOT.generated,
    years: STORM_EVENTS_SNAPSHOT.years,
    summary: {},
  },
};

test('late refresh cannot publish after disable, re-enable, or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve(snapshot);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('update publishes one history label and stats carry the count', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'disaster-history');
  assert.equal(h.events[0][1].length, 1);
  assert.match(h.events[0][1][0].title, /34/);
  assert.match(h.events[0][1][0].title, /1965/);
  assert.match(h.events[0][1][0].subtitle, /Remnants of hurricane ida/);
  assert.match(h.events[0][1][0].subtitle, /2021/);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.declarationCount, 34);
  assert.equal(stats.latestDeclaration, 'DR-4614-NJ');
  assert.equal(stats.latestIncidentType, 'Hurricane');
  assert.equal(stats.earliestDeclaration, 'DR-205-NJ');
  assert.deepEqual(stats.stormEventYears, ['2012', '2021', '2024', '2025']);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['disaster-history']);
  assert.deepEqual(h.visible.at(-1), ['disaster-history', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per declaration', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  const ida = records.find((record) => record.id === 'DR-4614-NJ');
  assert.equal(ida.incidentType, 'Hurricane');
  assert.equal(ida.publicAssistance, true);
  assert.equal(ida.timeMs, Date.parse('2021-09-05T00:00:00.000Z'));
  h.layer.destroy(h.viewer);
});
