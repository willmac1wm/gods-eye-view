import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadinessLayer } from './index.js';
import { createReadinessStore, memoryStorage } from './store.js';

function harness(source, store) {
  const events = [];
  const visible = [];
  const cleared = [];
  const layer = createReadinessLayer({
    source,
    store: store ?? createReadinessStore({ storage: memoryStorage() }),
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
  drivers: {
    flood: { active: true, reason: 'Coastal Flood Advisory' },
    storm: { active: false, reason: null },
    cold: { active: false, reason: null },
    power: { active: true, reason: '1,200 customers out' },
    drought: { active: false, reason: null },
    space: { active: false, reason: null },
  },
  unavailable: [],
  fetchedAt: 1,
  stale: false,
};

test('update publishes one summary label with the due count', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update({}), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'readiness');
  assert.equal(h.events[0][1].length, 1);
  assert.match(h.events[0][1][0].title, /items due now/);
  assert.equal(h.layer.getStats().dueCount, 9);
  assert.equal(h.layer.getStats().count, 27);
  h.layer.destroy({});
});

test('row controls list all 27 items, due first, with household chips', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.match(controls.info, /12 gal water/);
  assert.match(controls.info, /items due now/);
  assert.match(controls.info, /0\/27 checked/);
  assert.equal(controls.list.items.length, 27);
  assert.equal(controls.list.items[0].id, 'basic-kit:radio');
  assert.match(controls.list.items[0].text, /Due now/);
  const chips = controls.chips.map((c) => c.id);
  assert.deepEqual(chips, [
    'household-1',
    'household-2',
    'household-3',
    'household-4',
    'household-5',
    'household-6',
    'reset-checks',
  ]);
  assert.equal(
    controls.chips.find((c) => c.id === 'household-4').disabled,
    true,
  );
  h.layer.destroy({});
});

test('clicking a list item toggles its done-state with no network call', async () => {
  const storage = memoryStorage();
  const store = createReadinessStore({ storage });
  const h = harness({ getSnapshot: async () => snapshot }, store);
  await h.layer.update({});
  assert.equal(h.layer.setParams({ toggleItem: 'basic-kit:water' }), true);
  assert.equal(store.isDone('basic-kit:water'), true);
  assert.equal(storage.getItem('cape-dispatch:readiness:done:v1').includes('basic-kit:water'), true);
  const controls = h.layer.getRowControls();
  assert.match(controls.info, /1\/27 checked/);
  const water = controls.list.items.find((i) => i.id === 'basic-kit:water');
  assert.match(water.lead, /^✓ /);
  assert.equal(h.layer.setParams({ toggleItem: 'basic-kit:water' }), true);
  assert.equal(store.isDone('basic-kit:water'), false);
  // An unknown item id toggles nothing.
  assert.equal(h.layer.setParams({ toggleItem: 'nope:nope' }), false);
  h.layer.destroy({});
});

test('household chips resize the go-bag and the reset chip clears checks', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  h.layer.setParams({ toggleItem: 'basic-kit:food' });
  assert.equal(h.layer.setParams({ householdSize: 2 }), true);
  assert.match(h.layer.getRowControls().info, /6 gal water/);
  assert.equal(h.layer.getStats().householdSize, 2);
  const reset = h.layer
    .getRowControls()
    .chips.find((c) => c.id === 'reset-checks');
  assert.equal(reset.disabled, false);
  reset.onClick();
  assert.equal(h.layer.getStats().doneCount, 0);
  assert.match(h.layer.getRowControls().info, /0\/27 checked/);
  h.layer.destroy({});
});

test('done-state survives a layer rebuild from the same storage', async () => {
  const storage = memoryStorage();
  const first = harness(
    { getSnapshot: async () => snapshot },
    createReadinessStore({ storage }),
  );
  await first.layer.update({});
  first.layer.setParams({ toggleItem: 'basic-kit:radio' });
  first.layer.destroy({});
  const second = harness(
    { getSnapshot: async () => snapshot },
    createReadinessStore({ storage }),
  );
  await second.layer.update({});
  const radio = second.layer
    .getRowControls()
    .list.items.find((i) => i.id === 'basic-kit:radio');
  assert.match(radio.lead, /^✓ /);
  second.layer.destroy({});
});

test('a failed refresh keeps the last error and returns false', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new Error('Readiness HTTP 503');
    },
  });
  assert.equal(await h.layer.update({}), false);
  assert.match(h.layer.getStats().error, /503/);
  assert.equal(h.events.length, 0);
  h.layer.destroy({});
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init({}), /already initialized/);
  h.layer.destroy({});
  assert.deepEqual(h.cleared.at(-1), ['readiness']);
  assert.deepEqual(h.visible.at(-1), ['readiness', false]);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per checklist item', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 27);
  assert.equal(records.find((r) => r.id === 'basic-kit:maps').due, true);
  h.layer.destroy({});
});
