import assert from 'node:assert/strict';
import test from 'node:test';
import { createCountyRiskLayer } from './index.js';

function harness(source) {
  const events = [];
  const visible = [];
  const cleared = [];
  const layer = createCountyRiskLayer({
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
  layer.init({});
  layer.enable({});
  return { layer, events, visible, cleared };
}

const snapshot = {
  score: 52,
  band: { level: 3, label: 'Elevated' },
  components: {
    weather: { available: true, value: 70, rules: ['NWS warning active'], stale: false, updatedAtMs: 1000 },
    power: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
    hazards: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
    lightning: { available: false, value: null, rules: [], stale: false, updatedAtMs: null },
    space: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
  },
  missingInputs: ['lightning'],
  stale: false,
  computedAtMs: 1000,
  inputs: null,
};

test('update publishes the summary label plus one label per component', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update({}), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'county-risk');
  const entries = h.events[0][1];
  assert.equal(entries.length, 5); // summary + 4 available components
  assert.match(entries[0].title, /Elevated 52\/100/);
  assert.match(entries[1].title, /Weather 70/);
  assert.equal(h.layer.getStats().score, 52);
  assert.equal(h.layer.getStats().band, 'Elevated');
  h.layer.destroy({});
});

test('a band change is logged as a transition with component values', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  const first = h.layer.getStats().lastTransition;
  assert.equal(first.from, null);
  assert.equal(first.to, 'Elevated');
  assert.equal(first.score, 52);
  assert.equal(first.components.weather, 70);
  assert.equal(first.components.lightning, null);
  // A second update at the same band records no new transition.
  await h.layer.update({});
  assert.equal(h.layer.getStats().lastTransition, first);
  // A different band records a new transition from the old one.
  const severe = { ...snapshot, score: 85, band: { level: 5, label: 'Severe' } };
  const h2 = harness({ getSnapshot: async () => severe });
  await h2.layer.update({});
  assert.equal(h2.layer.getStats().lastTransition.from, null);
  h2.layer.destroy({});
  h.layer.destroy({});
});

test('a failed refresh keeps the last error and returns false', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new Error('fetch failed');
    },
  });
  assert.equal(await h.layer.update({}), false);
  assert.match(h.layer.getStats().error, /fetch failed/);
  h.layer.destroy({});
});

test('row controls list the components and the band legend', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.equal(controls.chips.length, 0);
  assert.match(controls.info, /Elevated 52\/100/);
  assert.match(controls.info, /Lightning/);
  assert.equal(controls.legend.length, 5);
  assert.deepEqual(
    controls.legend.map((l) => l.label),
    ['Severe', 'High', 'Elevated', 'Guarded', 'Low'],
  );
  assert.equal(controls.list.items.length, 5);
  assert.equal(controls.list.items[0].lead, 'Weather');
  assert.match(controls.list.items[0].text, /Weather 70/);
  h.layer.destroy({});
});

test('analyst records carry one row for the current score', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  await h.layer.update({});
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].score, 52);
  assert.equal(records[0].band, 'Elevated');
  h.layer.destroy({});
});
