import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmergencyCompositeLayer } from './index.js';
import { EMERGENCY_COMPOSITE_LINKS } from './policy.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');

function harness(source, openUrl = () => {}) {
  const events = [];
  const visible = [];
  const cleared = [];
  const layer = createEmergencyCompositeLayer({
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
    openUrl,
  });
  layer.init({});
  layer.enable({});
  return { layer, events, visible, cleared };
}

const SNAPSHOT = {
  alerts: {
    available: true,
    updatedAtMs: NOW - 60_000,
    stale: false,
    active: 6,
    warnings: 3,
    watches: 0,
    advisories: 3,
    topEvents: ['Freeze Warning', 'Coastal Flood Advisory'],
    topAlerts: [
      {
        id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
        event: 'Freeze Warning',
        severity: 'Severe',
        timeMs: NOW - 3600_000,
      },
    ],
  },
  incidents: {
    available: true,
    updatedAtMs: NOW - 60_000,
    stale: false,
    activeIncidents: 0,
    quiet: true,
    error: null,
  },
  hazmat: {
    available: true,
    updatedAtMs: NOW - 60_000,
    stale: false,
    ipaws: {
      available: true,
      delayedByH: 24,
      items: [],
      newestAtMs: null,
    },
    plume: {
      available: true,
      active: false,
      nodes: 0,
      updatedAtMs: NOW - 60_000,
      stale: false,
    },
  },
  evacuation: { guidance: null },
  fetchedAt: NOW,
};

test('update publishes one summary label for the composite', async () => {
  const h = harness({ getSnapshot: async () => SNAPSHOT });
  assert.equal(await h.layer.update({}), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'emergency-composite');
  assert.equal(h.events[0][1].length, 1);
  assert.match(h.events[0][1][0].info, /Alerts: 6 active/);
  assert.equal(h.layer.getStats().alertsActive, 6);
  assert.equal(h.layer.getStats().incidentsActive, 0);
  h.layer.destroy({});
});

test('row controls list the four quadrants', async () => {
  const h = harness({ getSnapshot: async () => SNAPSHOT });
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.equal(controls.list.items.length, 4);
  assert.deepEqual(
    controls.list.items.map((i) => i.lead),
    ['Alerts', 'Incidents', 'Hazmat', 'Shelter + evacuation'],
  );
  assert.match(controls.list.items[0].text, /6 active/);
  assert.match(controls.list.items[1].text, /Quiet/);
  assert.match(controls.list.items[2].text, /24 h delayed/);
  assert.match(controls.list.items[3].text, /No evacuation order in effect/);
  assert.match(controls.infoTitle, /Official sources only/);
  h.layer.destroy({});
});

test('one chip per shelter/evacuation link-out, and a chip opens its URL', async () => {
  const opened = [];
  const h = harness(
    { getSnapshot: async () => SNAPSHOT },
    (url) => opened.push(url),
  );
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.equal(controls.chips.length, EMERGENCY_COMPOSITE_LINKS.length);
  assert.equal(controls.chips.length, 6);
  controls.chips[0].onClick();
  assert.equal(
    opened[0],
    'https://www.redcross.org/get-help/disaster-relief-and-recovery/find-an-open-shelter.html',
  );
  h.layer.destroy({});
});

test('evacuation guidance is quoted in the shelter quadrant', async () => {
  const h = harness({
    getSnapshot: async () => ({
      ...SNAPSHOT,
      evacuation: {
        guidance: {
          text: 'Evacuate the barrier islands before the storm surge arrives.',
          event: 'Hurricane Warning',
          source: 'National Weather Service',
          url: 'https://api.weather.gov/alerts/NWS-IDP-PROD-9',
        },
      },
    }),
  });
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.match(
    controls.list.items[3].text,
    /Evacuate the barrier islands before the storm surge arrives/,
  );
  assert.equal(h.layer.getStats().evacuationGuidance.event, 'Hurricane Warning');
  h.layer.destroy({});
});

test('a failed refresh keeps the last error and returns false', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new Error('Emergency composite HTTP 503');
    },
  });
  assert.equal(await h.layer.update({}), false);
  assert.match(h.layer.getStats().error, /503/);
  assert.equal(h.events.length, 0);
  h.layer.destroy({});
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => SNAPSHOT });
  assert.throws(() => h.layer.init({}), /already initialized/);
  h.layer.destroy({});
  assert.deepEqual(h.cleared.at(-1), ['emergency-composite']);
  assert.deepEqual(h.visible.at(-1), ['emergency-composite', false]);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per alert and IPAWS item', async () => {
  const h = harness({
    getSnapshot: async () => ({
      ...SNAPSHOT,
      hazmat: {
        ...SNAPSHOT.hazmat,
        ipaws: {
          available: true,
          delayedByH: 24,
          items: [
            {
              id: 'ipaws-1',
              title: 'Tornado Warning',
              severity: 'critical',
              seenAtMs: NOW - 86_400_000,
            },
          ],
          newestAtMs: NOW - 86_400_000,
        },
      },
    }),
  });
  await h.layer.update({});
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  assert.equal(records[0].event, 'Freeze Warning');
  assert.equal(records[1].event, 'Tornado Warning');
  h.layer.destroy({});
});
