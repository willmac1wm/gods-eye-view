import assert from 'node:assert/strict';
import test from 'node:test';
import { createNwsAlertCardLayer } from './index.js';

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
  const layer = createNwsAlertCardLayer({
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
  fetchedAt: '2026-11-14T05:56:00.000Z',
  stale: false,
  alerts: [
    {
      id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
      event: 'Freeze Warning',
      headline: 'Freeze Warning issued November 14 at 12:56AM EST',
      area: 'Cape May',
      severity: 'Severe',
      severityWords: 'serious — act now',
      plain: 'Hard freeze tonight',
      means: 'Temperatures below freezing long enough to kill plants.',
      action: 'Cover plants.',
      instruction: 'Take steps now to protect tender plants from the cold.',
      description: null,
      effective: '2026-11-14T05:56:00+00:00',
      expires: '2026-11-14T14:00:00+00:00',
      onset: '2026-11-14T05:56:00+00:00',
      senderName: 'NWS Mount Holly NJ',
    },
  ],
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

test('update publishes one alert label with the plain gloss', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'nws-alert-card');
  assert.match(h.events[0][1][0].title, /1 active NWS alert/);
  assert.equal(h.events[0][1][0].subtitle, 'Hard freeze tonight');
  assert.equal(h.layer.getStats().count, 1);
  assert.deepEqual(h.layer.getStats().events, ['Freeze Warning']);
  h.layer.destroy(h.viewer);
});

test('an empty snapshot publishes the all-clear label', async () => {
  const h = harness({
    getSnapshot: async () => ({ fetchedAt: 1, stale: false, alerts: [] }),
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.match(h.events[0][1][0].title, /No active NWS alerts/);
  assert.equal(h.layer.getStats().count, 0);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['nws-alert-card']);
  assert.deepEqual(h.visible.at(-1), ['nws-alert-card', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per alert', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'Freeze Warning');
  assert.equal(records[0].plain, 'Hard freeze tonight');
  // The official instruction text rides the analyst record (D9 reads it for
  // evacuation guidance: official sources only, quoted).
  assert.equal(
    records[0].instruction,
    'Take steps now to protect tender plants from the cold.',
  );
  h.layer.destroy(h.viewer);
});
