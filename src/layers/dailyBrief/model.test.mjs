import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailyBriefSummaryEntry, mapAnalystRecord } from './model.js';

function snapshot(over = {}) {
  return {
    brief: {
      id: 2,
      slug: 'daily-brief-2026-11-17',
      date: '2026-11-17',
      dateLabel: 'Nov. 17, 2026',
      headline: 'Cape May County — Daily Brief, Nov. 17, 2026',
      status: 'published',
      confidence: 0.9,
      stale: false,
      sections: [],
    },
    writerEnabled: true,
    ...over,
  };
}

test('summary entry carries the headline, date, and confidence', () => {
  const entry = createDailyBriefSummaryEntry({ snapshot: snapshot() });
  assert.match(entry.title, /Daily Brief, Nov\. 17, 2026/);
  assert.ok(entry.details.some((d) => d.includes('Nov. 17, 2026')));
  assert.ok(entry.details.some((d) => d.includes('90%')));
  assert.equal(entry.id, 'daily-brief');
});

test('a brief in review shows as in review', () => {
  const entry = createDailyBriefSummaryEntry({
    snapshot: snapshot({
      brief: {
        ...snapshot().brief,
        status: 'review',
        confidence: 0.74,
      },
    }),
  });
  assert.ok(entry.details.some((d) => d.includes('in review')));
});

test('a stale brief says so with its date, never as today', () => {
  const entry = createDailyBriefSummaryEntry({
    snapshot: snapshot({
      brief: { ...snapshot().brief, stale: true },
    }),
  });
  assert.ok(entry.details.some((d) => d.includes('stale')));
  assert.ok(entry.details.some((d) => d.includes('Nov. 17, 2026')));
});

test('no brief with the writer off says the writer is not configured', () => {
  const entry = createDailyBriefSummaryEntry({
    snapshot: { brief: null, writerEnabled: false },
  });
  assert.match(entry.title, /writer not configured/);
  assert.ok(entry.details.some((d) => d.includes('GEMINI_API_KEY')));
});

test('no brief with the writer on says the first brief comes at 07:00', () => {
  const entry = createDailyBriefSummaryEntry({
    snapshot: { brief: null, writerEnabled: true },
  });
  assert.match(entry.title, /No daily brief yet/);
  assert.ok(entry.details.some((d) => d.includes('07:00')));
});

test('analyst record carries one row for the latest brief', () => {
  const record = mapAnalystRecord(snapshot());
  assert.equal(record.id, 'DAILY-BRIEF-daily-brief-2026-11-17');
  assert.equal(record.status, 'published');
  assert.equal(record.confidence, 0.9);
  assert.equal(mapAnalystRecord({ brief: null }).id, 'DAILY-BRIEF-0000');
});
