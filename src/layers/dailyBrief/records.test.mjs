import assert from 'node:assert/strict';
import test from 'node:test';
import {
  briefSlugDate,
  briefStatusLabel,
  formatBriefDate,
  normalizeDailyBrief,
  normalizeDailyBriefSnapshot,
  parseBriefSections,
  validateDailyBriefSnapshot,
} from './records.js';

const BODY = [
  'CAPE MAY COURT HOUSE, Nov. 17, 2026 — A freeze warning remains in effect overnight.',
  '',
  '## What happened',
  '',
  'The National Weather Service says a freeze warning is in effect until 9 a.m. Tuesday.',
  '',
  '## Still active',
  '',
  'The freeze warning remains in effect, according to the National Weather Service.',
  '',
  '## What to watch',
  '',
  'The coastal flood advisory runs through Tuesday afternoon, according to the National Weather Service.',
  '',
  'Sources: National Weather Service Mount Holly (https://www.weather.gov/phi/).',
].join('\n');

test('parseBriefSections returns the lede plus the three sections in order', () => {
  const { lede, sections } = parseBriefSections(BODY);
  assert.match(lede, /freeze warning remains in effect overnight/);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ['What happened', 'Still active', 'What to watch'],
  );
  assert.match(sections[0].text, /freeze warning is in effect until 9 a\.m\./);
});

test('parseBriefSections tolerates a missing section and out-of-order headings', () => {
  const { sections } = parseBriefSections(
    '## What to watch\n\nWatch this.\n\n## What happened\n\nThis happened.',
  );
  assert.deepEqual(
    sections.map((s) => s.heading),
    ['What happened', 'What to watch'],
  );
});

test('parseBriefSections with no headings returns the whole body as the lede', () => {
  const { lede, sections } = parseBriefSections('Just a paragraph.');
  assert.equal(lede, 'Just a paragraph.');
  assert.deepEqual(sections, []);
  assert.deepEqual(parseBriefSections(''), { lede: null, sections: [] });
});

test('briefSlugDate and formatBriefDate', () => {
  assert.equal(briefSlugDate('daily-brief-2026-11-17'), '2026-11-17');
  assert.equal(briefSlugDate('daily-brief-2026-11-17-update'), '2026-11-17');
  assert.equal(briefSlugDate('something-else'), null);
  assert.equal(formatBriefDate('2026-11-17'), 'Nov. 17, 2026');
  assert.equal(formatBriefDate('garbage'), null);
  assert.equal(formatBriefDate(null), null);
});

function rawBrief(over = {}) {
  return {
    id: 2,
    slug: 'daily-brief-2026-11-17',
    headline: 'Cape May County — Daily Brief, Nov. 17, 2026',
    dek: 'Freeze warning overnight.',
    dateline: 'CAPE MAY COURT HOUSE, Nov. 17, 2026 —',
    body_md: BODY,
    status: 'published',
    confidence: 0.9,
    updated_at: Math.floor(Date.now() / 1000),
    ...over,
  };
}

test('normalizeDailyBrief fills date, sections, and staleness', () => {
  const brief = normalizeDailyBrief(rawBrief());
  assert.equal(brief.date, '2026-11-17');
  assert.equal(brief.dateLabel, 'Nov. 17, 2026');
  assert.equal(brief.sections.length, 3);
  assert.equal(brief.stale, false);
  assert.equal(briefStatusLabel(brief), 'published');
});

test('normalizeDailyBrief marks a brief older than 24 h stale', () => {
  const brief = normalizeDailyBrief(
    rawBrief({ updated_at: Math.floor(Date.now() / 1000) - 25 * 3600 }),
  );
  assert.equal(brief.stale, true);
  assert.equal(briefStatusLabel(brief), 'stale');
});

test('normalizeDailyBrief returns null without a headline', () => {
  assert.equal(normalizeDailyBrief(rawBrief({ headline: '' })), null);
  assert.equal(normalizeDailyBrief(null), null);
});

test('a review brief labels as in review', () => {
  assert.equal(
    briefStatusLabel(normalizeDailyBrief(rawBrief({ status: 'review' }))),
    'in review',
  );
});

test('snapshot validation: a null brief is valid, a malformed brief is not', () => {
  assert.deepEqual(
    validateDailyBriefSnapshot(
      normalizeDailyBriefSnapshot({ brief: null, writer_enabled: true }),
    ),
    { brief: null, writerEnabled: true },
  );
  assert.equal(
    validateDailyBriefSnapshot(
      normalizeDailyBriefSnapshot({
        brief: rawBrief({ headline: '' }),
        writer_enabled: true,
      }),
    ),
    null,
  );
  // A missing writer_enabled normalizes to false, which is a valid
  // snapshot — the writer is simply off.
  assert.deepEqual(
    validateDailyBriefSnapshot(
      normalizeDailyBriefSnapshot({ brief: rawBrief() }),
    ).writerEnabled,
    false,
  );
  assert.equal(validateDailyBriefSnapshot(null), null);
});
