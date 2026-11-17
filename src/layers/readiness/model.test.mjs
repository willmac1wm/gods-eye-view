import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadinessSummaryEntry, mapAnalystRecord } from './model.js';

function snapshot(over = {}) {
  return {
    drivers: {
      flood: { active: true, reason: 'Coastal Flood Advisory' },
      storm: { active: false, reason: null },
      cold: { active: false, reason: null },
      power: { active: false, reason: null },
      drought: { active: false, reason: null },
      space: { active: false, reason: null },
    },
    unavailable: [],
    dueCount: 4,
    ...over,
  };
}

test('summary entry carries the due count, the go-bag, and the driver reason', () => {
  const entry = createReadinessSummaryEntry({
    snapshot: snapshot(),
    householdSize: 4,
  });
  assert.match(entry.title, /Readiness: 4 items due now/);
  assert.ok(entry.details.some((d) => d.includes('12 gal water')));
  assert.ok(entry.details.some((d) => d.includes('Coastal Flood Advisory')));
  assert.equal(entry.id, 'readiness');
});

test('a quiet week shows the baseline kit, never "all clear" as a score', () => {
  const entry = createReadinessSummaryEntry({
    snapshot: snapshot({
      drivers: Object.fromEntries(
        ['flood', 'storm', 'cold', 'power', 'drought', 'space'].map(
          (name) => [name, { active: false, reason: null }],
        ),
      ),
      dueCount: 0,
    }),
    householdSize: 2,
  });
  assert.match(entry.title, /baseline kit/);
  assert.ok(entry.details.some((d) => d.includes('6 gal water')));
  assert.ok(
    entry.details.some((d) => d.includes('No live driver active')),
  );
});

test('an unavailable driver layer is labeled, never hidden', () => {
  const entry = createReadinessSummaryEntry({
    snapshot: snapshot({ dueCount: 0, unavailable: ['nws', 'tides'] }),
    householdSize: 4,
  });
  assert.ok(
    entry.details.some((d) => d.includes('Live status unavailable')),
  );
  assert.ok(entry.details.some((d) => d.includes('nws, tides')));
});

test('analyst record carries one row per checklist item', () => {
  const record = mapAnalystRecord({
    id: 'basic-kit:maps',
    checklistId: 'basic-kit',
    checklistTitle: 'Basic disaster supplies kit',
    text: 'Local maps',
    drivers: ['flood', 'space'],
    due: true,
    dueReasons: ['Coastal Flood Advisory'],
    done: false,
  });
  assert.equal(record.id, 'basic-kit:maps');
  assert.equal(record.due, true);
  assert.deepEqual(record.drivers, ['flood', 'space']);
  assert.equal(record.done, false);
});
