import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtWhen } from './ui.js';

test('fmtWhen reads a zoneless ISO date-time as UTC, as Fire Wire writes it', () => {
  const expected = new Date('2026-11-16T11:59:00Z').toLocaleString();
  assert.equal(fmtWhen('2026-11-16T11:59:00'), expected);
  assert.equal(fmtWhen('2026-11-16 11:59:00'), expected);
  assert.equal(
    fmtWhen('2026-11-16T11:59:00.529993'),
    new Date('2026-11-16T11:59:00.529Z').toLocaleString(),
  );
});

test('fmtWhen keeps an explicit zone, epoch numbers and odd text', () => {
  assert.equal(
    fmtWhen('2026-11-16T06:59:00-05:00'),
    new Date('2026-11-16T11:59:00Z').toLocaleString(),
  );
  assert.equal(fmtWhen(0), new Date(0).toLocaleString());
  assert.equal(fmtWhen('soon'), 'soon');
  assert.equal(fmtWhen(''), null);
  assert.equal(fmtWhen(null), null);
});
