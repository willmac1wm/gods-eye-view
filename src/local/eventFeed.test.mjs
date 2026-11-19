import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageText,
  eventCrawlHtml,
  eventIcon,
  eventTarget,
  eventTimeText,
  eventTimelineHtml,
  latestTickerItem,
  loadEvents,
  mergeEvents,
} from './eventFeed.js';

const at = (iso) => Date.parse(iso);
const parse = (html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};
const squash = (value) => value.replace(/\s+/g, ' ').trim();

/* A fire call, its update, a possibly related road closure and the clear. */
const fire = {
  id: 'call:fw:881@1',
  key: 'call:fw:881',
  kind: 'call',
  change: 'new',
  title: 'Fire reported',
  place: 'Rio Grande',
  detail: 'Structure fire · Middle Twp Fire',
  at: at('2026-11-19T01:42:00Z'),
  seenAt: at('2026-11-19T01:43:00Z'),
  lat: 39.0187,
  lon: -74.8774,
  layer: 'scanner-calls',
  severity: 'warn',
  source: 'Fire Wire scanner',
  threadId: 'call:fw:881@1',
  related: [],
};
const fireUpdate = {
  ...fire,
  id: 'call:fw:881@2',
  change: 'update',
  title: 'Second alarm requested',
  detail: '',
  at: at('2026-11-19T01:50:00Z'),
  seenAt: at('2026-11-19T01:50:30Z'),
  lat: null,
  lon: null,
  related: [{ id: 'call:fw:881@1', reason: 'update' }],
};
const roadClosed = {
  id: 'traffic:511nj:12345@1',
  key: 'traffic:511nj:12345',
  kind: 'traffic',
  change: 'new',
  title: 'Road closed',
  place: 'Route 47',
  detail: 'Both directions',
  at: at('2026-11-19T01:54:00Z'),
  seenAt: at('2026-11-19T01:55:00Z'),
  lat: 39.021,
  lon: -74.871,
  layer: 'traffic-incidents',
  severity: 'watch',
  source: '511NJ',
  threadId: 'call:fw:881@1',
  related: [{ id: 'call:fw:881@1', reason: '0.4 mi and 12 min apart' }],
};
const fireCleared = {
  ...fire,
  id: 'call:fw:881@3',
  change: 'cleared',
  title: 'Fire call cleared',
  detail: '',
  severity: 'info',
  at: at('2026-11-19T02:30:00Z'),
  seenAt: at('2026-11-19T02:30:00Z'),
  related: [{ id: 'call:fw:881@1', reason: 'cleared' }],
};
const flood = {
  id: 'alert:nws:cfw@1',
  key: 'alert:nws:cfw',
  kind: 'alert',
  change: 'new',
  title: 'Coastal Flood Warning',
  place: 'Cape May County',
  detail: 'Until 10:00 PM',
  at: at('2026-11-19T02:10:00Z'),
  seenAt: at('2026-11-19T02:11:00Z'),
  lat: null,
  lon: null,
  layer: 'nws-alerts',
  severity: 'danger',
  source: 'National Weather Service',
  threadId: 'alert:nws:cfw@1',
  related: [],
};
const hostile = {
  id: 'report:77@1',
  key: 'report:77',
  kind: 'report',
  change: 'new',
  title: '<img src=x onerror=alert(1)>',
  place: '"Quoted" & <b>bold</b>',
  detail: "it's here",
  at: at('2026-11-19T01:00:00Z'),
  seenAt: at('2026-11-19T01:00:00Z'),
  lat: null,
  lon: null,
  layer: null,
  severity: 'nonsense" onclick="x',
  source: 'Community report (unverified)',
  threadId: 'report:77@1',
  related: [],
};
const NOW = at('2026-11-19T02:35:00Z'); // 9:35 PM EST, Wed Nov 18

const data = {
  generatedAt: NOW,
  summary: {
    at: NOW,
    lines: [
      {
        text: 'Coastal Flood Warning until 10:00 PM',
        tone: 'warn',
        source: 'NWS',
        eventId: 'alert:nws:cfw@1',
      },
      {
        text: 'Fire call cleared in Rio Grande',
        tone: 'ok',
        source: 'Fire Wire scanner',
        eventId: null,
      },
      { text: 'Gone from the list', tone: 'bogus', eventId: 'missing' },
    ],
  },
  sources: [
    { id: 'calls', name: 'Fire Wire scanner calls', ok: true, at: NOW },
    { id: 'uscg', name: 'Coast Guard aircraft feed', ok: false, at: null },
  ],
  events: [fireCleared, flood, roadClosed, fireUpdate, fire, hostile],
};

/* --------------------------------- time ---------------------------------- */

test('eventTimeText reads US Eastern, with the weekday off today', () => {
  const evening = at('2026-11-19T01:47:00Z'); // 8:47 PM EST Wed
  assert.equal(eventTimeText(at('2026-11-19T01:42:00Z'), evening), '8:42 PM');
  // Different UTC dates, same Eastern day: no weekday.
  assert.equal(
    eventTimeText(at('2026-11-18T23:30:00Z'), at('2026-11-19T02:00:00Z')),
    '6:30 PM',
  );
  // Across Eastern midnight.
  const pastMidnight = at('2026-11-19T05:30:00Z'); // 12:30 AM EST Thu
  assert.equal(
    eventTimeText(at('2026-11-19T04:50:00Z'), pastMidnight),
    'Wed 11:50 PM',
  );
  assert.equal(
    eventTimeText(at('2026-11-19T05:10:00Z'), pastMidnight),
    '12:10 AM',
  );
  // Further than a week: the date, not an ambiguous weekday.
  assert.equal(
    eventTimeText(at('2026-11-10T13:00:00Z'), evening),
    'Nov 10, 8:00 AM',
  );
  // An ISO string is read too.
  assert.equal(eventTimeText('2026-11-19T01:42:00Z', evening), '8:42 PM');
});

test('eventTimeText is DST-safe on both change days', () => {
  // Sun Mar 8 2026: 2:00 AM EST becomes 3:00 AM EDT (07:00Z).
  const spring = at('2026-03-08T16:00:00Z');
  assert.equal(eventTimeText(at('2026-03-08T06:30:00Z'), spring), '1:30 AM');
  assert.equal(eventTimeText(at('2026-03-08T07:30:00Z'), spring), '3:30 AM');
  // Sun Nov 1 2026: 2:00 AM EDT becomes 1:00 AM EST (06:00Z); 1:30 twice.
  const fall = at('2026-11-01T16:00:00Z');
  assert.equal(eventTimeText(at('2026-11-01T05:30:00Z'), fall), '1:30 AM');
  assert.equal(eventTimeText(at('2026-11-01T06:30:00Z'), fall), '1:30 AM');
  assert.equal(
    eventTimeText(at('2026-10-31T03:30:00Z'), fall),
    'Fri 11:30 PM',
    'the day before the change, in EDT',
  );
});

test('eventTimeText and ageText return "" for a missing or invalid time', () => {
  for (const bad of [null, undefined, NaN, '', 'garbage', 0, -5, {}]) {
    assert.equal(eventTimeText(bad, NOW), '', String(bad));
    assert.equal(ageText(bad, NOW), '', String(bad));
  }
});

test('ageText reads just now, minutes, hours and days', () => {
  assert.equal(ageText(NOW - 20_000, NOW), 'just now');
  assert.equal(ageText(NOW - 12.6 * 60_000, NOW), '12 min ago');
  assert.equal(ageText(NOW - 59 * 60_000, NOW), '59 min ago');
  assert.equal(ageText(NOW - 130 * 60_000, NOW), '2 h ago');
  assert.equal(ageText(NOW - 3 * 86_400_000, NOW), '3 d ago');
  assert.equal(ageText(NOW + 2 * 60_000, NOW), 'just now', 'a little skew');
  assert.equal(ageText(NOW + 30 * 60_000, NOW), 'in 30 min');
});

/* --------------------------------- fetch --------------------------------- */

const respond = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('loadEvents GETs same-origin, adds ?since= and never throws', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return respond(data);
  };
  const controller = new AbortController();
  const full = await loadEvents({ fetchImpl, signal: controller.signal });
  assert.equal(full.ok, true);
  assert.deepEqual(
    full.data.events.map((event) => event.id),
    [
      'call:fw:881@3',
      'alert:nws:cfw@1',
      'traffic:511nj:12345@1',
      'call:fw:881@2',
      'call:fw:881@1',
      'report:77@1',
    ],
  );
  assert.equal(calls[0].url, '/api/local/events');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.signal, controller.signal);
  await loadEvents({ fetchImpl, since: 1795488000000 });
  assert.equal(calls[1].url, '/api/local/events?since=1795488000000');

  assert.deepEqual(
    await loadEvents({ fetchImpl: async () => respond({}, 503) }),
    { ok: false, data: null, error: 'Events HTTP 503', status: 503 },
  );
  // A server without the events route: the status lets the ticker back off.
  assert.deepEqual(
    await loadEvents({ fetchImpl: async () => respond({}, 404) }),
    { ok: false, data: null, error: 'Events HTTP 404', status: 404 },
  );
  assert.deepEqual(
    await loadEvents({ fetchImpl: async () => null }),
    { ok: false, data: null, error: 'Events HTTP error' },
    'no response at all: no status',
  );
  const thrown = await loadEvents({
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.data, null);
  assert.match(thrown.error, /Failed to fetch/);
  const aborted = await loadEvents({
    fetchImpl: () => {
      throw new DOMException('stop', 'AbortError');
    },
  });
  assert.equal(aborted.error, 'Events request aborted');
  for (const body of [null, [], { events: 'no' }, 'text']) {
    const result = await loadEvents({ fetchImpl: async () => respond(body) });
    assert.equal(result.ok, false, JSON.stringify(body));
  }
  const badJson = await loadEvents({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }),
  });
  assert.equal(badJson.ok, false);
});

/* --------------------------------- merge --------------------------------- */

test('mergeEvents de-duplicates by id, merges related and sorts newest first', () => {
  const first = {
    generatedAt: at('2026-11-19T02:00:00Z'),
    summary: { at: at('2026-11-19T02:00:00Z'), lines: [{ text: 'old' }] },
    sources: [{ id: 'calls', ok: true }],
    events: [fire, roadClosed],
  };
  const grown = {
    ...fire,
    related: [{ id: roadClosed.id, reason: '0.4 mi and 12 min apart' }],
  };
  const second = {
    generatedAt: NOW,
    summary: { at: NOW, lines: [{ text: 'new' }] },
    sources: [{ id: 'calls', ok: false }],
    events: [fireCleared, grown, fireCleared],
  };
  const merged = mergeEvents(first, second);
  assert.deepEqual(
    merged.events.map((event) => event.id),
    [fireCleared.id, roadClosed.id, fire.id],
  );
  assert.deepEqual(
    merged.events.find((event) => event.id === fire.id).related,
    [{ id: roadClosed.id, reason: '0.4 mi and 12 min apart' }],
  );
  assert.equal(merged.generatedAt, NOW);
  assert.equal(merged.summary.lines[0].text, 'new');
  assert.equal(merged.sources[0].ok, false);

  // related[] only grows: an older copy's links are kept.
  const back = mergeEvents(
    { generatedAt: NOW, events: [grown] },
    { generatedAt: NOW, events: [{ ...fire, related: [] }] },
  );
  assert.equal(back.events[0].related.length, 1);

  // A late answer to an older request does not roll the summary back.
  const late = mergeEvents(second, first);
  assert.equal(late.summary.lines[0].text, 'new');
  assert.equal(late.generatedAt, NOW);

  assert.equal(mergeEvents(null, null), null);
  assert.deepEqual(
    mergeEvents(null, second).events.map((event) => event.id),
    [fireCleared.id, fire.id],
  );
});

test('mergeEvents keeps at most 200 events from the last 48 hours', () => {
  const many = (prefix, count, start) =>
    Array.from({ length: count }, (_, i) => ({
      ...fire,
      id: `${prefix}${i}`,
      threadId: `${prefix}${i}`,
      at: start + i * 60_000,
      seenAt: start + i * 60_000,
    }));
  const base = NOW - 10 * 60 * 60_000;
  const merged = mergeEvents(
    { generatedAt: NOW, events: many('a', 150, base) },
    { generatedAt: NOW, events: many('b', 100, base + 150 * 60_000) },
  );
  assert.equal(merged.events.length, 200);
  assert.equal(merged.events[0].id, 'b99');
  assert.equal(merged.events.at(-1).id, 'a50');

  const old = {
    ...fire,
    id: 'old',
    at: NOW - 49 * 3_600_000,
    seenAt: NOW - 49 * 3_600_000,
  };
  const oldButNew = {
    ...fire,
    id: 'seen-late',
    at: NOW - 50 * 3_600_000,
    seenAt: NOW - 3_600_000,
  };
  const pruned = mergeEvents(
    { generatedAt: NOW - 3_600_000, events: [old, oldButNew] },
    { generatedAt: NOW, events: [fireCleared] },
  );
  assert.deepEqual(
    pruned.events.map((event) => event.id),
    [fireCleared.id, 'seen-late'],
  );
});

/* ------------------------------ icon & crawl ----------------------------- */

test('eventIcon gives each kind a glyph in an aria-hidden span', () => {
  const glyphs = {
    call: '🚒',
    traffic: '🚧',
    report: '📣',
    flooding: '🌊',
    alert: '⚠️',
    aircraft: '✈️',
    storm: '🌀',
    outage: '💡',
    airport: '🛫',
  };
  for (const [kind, glyph] of Object.entries(glyphs)) {
    const span = parse(eventIcon(kind)).firstElementChild;
    assert.equal(span.getAttribute('aria-hidden'), 'true', kind);
    assert.equal(span.textContent, glyph, kind);
  }
  assert.equal(parse(eventIcon('constructor')).textContent, '📍');
  assert.equal(parse(eventIcon(undefined)).textContent, '📍');
});

test('the crawl renders the newest events twice, the copy hidden, all escaped', () => {
  const html = eventCrawlHtml([hostile, fire, roadClosed, fire], {
    now: at('2026-11-19T02:00:00Z'),
  });
  const host = parse(html);
  const crawl = host.querySelector('.gev-events-crawl');
  assert.equal(crawl.getAttribute('role'), 'region');
  assert.equal(crawl.getAttribute('aria-label'), 'Latest events');
  const items = [...crawl.querySelectorAll('.gev-events-crawl-track > button')];
  assert.equal(items.length, 6, 'three events (one duplicate dropped), twice');
  assert.deepEqual(
    items.map((item) => item.dataset.id),
    [roadClosed.id, fire.id, hostile.id, roadClosed.id, fire.id, hostile.id],
  );
  items.forEach((item, i) => {
    assert.equal(item.getAttribute('type'), 'button');
    assert.equal(item.dataset.act, 'event');
    assert.ok(item.classList.contains('gev-events-crawl-item'));
    assert.equal(item.getAttribute('aria-hidden'), i < 3 ? null : 'true');
    assert.equal(item.getAttribute('tabindex'), i < 3 ? null : '-1');
  });
  assert.equal(
    squash(items[1].textContent),
    '8:42 PM · 🚒 Fire reported · Rio Grande · Fire Wire scanner',
  );
  assert.ok(items[1].classList.contains('tone-warn'));
  assert.ok(items[2].classList.contains('tone-info'), 'unknown severity');
  assert.equal(host.querySelector('img, b'), null, 'no markup injected');
  assert.match(items[2].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(items[2].textContent, /"Quoted" & <b>bold<\/b>/);

  const two = parse(eventCrawlHtml(data.events, { now: NOW, limit: 2 }));
  assert.equal(two.querySelectorAll('button').length, 4);
  assert.equal(eventCrawlHtml([], { now: NOW }), '');
  assert.equal(eventCrawlHtml(null, { now: NOW }), '');
  assert.equal(
    parse(eventCrawlHtml(data, { now: NOW })).querySelectorAll('button').length,
    12,
    'a whole response works too',
  );
});

test('every crawl item says its source, muted, and its Eastern time in a tooltip', () => {
  const evening = at('2026-11-19T02:00:00Z');
  const sneaky = {
    ...roadClosed,
    id: 'traffic:511nj:999@1',
    threadId: 'traffic:511nj:999@1',
    at: at('2026-11-19T01:30:00Z'),
    source: '"><img src=x onerror=alert(1)> & co',
  };
  const unsourced = {
    ...flood,
    id: 'alert:nws:x@1',
    threadId: 'alert:nws:x@1',
    at: at('2026-11-19T01:20:00Z'),
    source: '   ',
  };
  const untimed = {
    ...fire,
    id: 'call:fw:7@1',
    threadId: 'call:fw:7@1',
    at: null,
    seenAt: null,
  };
  const host = parse(
    eventCrawlHtml([fire, sneaky, unsourced, untimed], { now: evening }),
  );
  const items = [...host.querySelectorAll('.gev-events-crawl-item')];
  assert.equal(items.length, 8);
  const byId = (id) => items.find((item) => item.dataset.id === id);

  const call = byId(fire.id);
  assert.equal(call.title, 'Source: Fire Wire scanner, 8:42 PM ET');
  const source = call.querySelector('.gev-events-crawl-source');
  assert.equal(source.tagName, 'SPAN');
  assert.equal(source.textContent, 'Fire Wire scanner');
  assert.equal(source, call.lastElementChild, 'the source comes last');
  assert.match(squash(call.textContent), / · Fire Wire scanner$/);

  // The source is escaped in the text and in the tooltip.
  const odd = byId(sneaky.id);
  assert.equal(host.querySelector('img'), null, 'no markup injected');
  assert.equal(
    odd.querySelector('.gev-events-crawl-source').textContent,
    '"><img src=x onerror=alert(1)> & co',
  );
  assert.equal(
    odd.title,
    'Source: "><img src=x onerror=alert(1)> & co, 8:30 PM ET',
  );

  // A missing source or time is said, never left blank.
  const plain = byId(unsourced.id);
  assert.equal(
    plain.querySelector('.gev-events-crawl-source').textContent,
    'source not stated',
  );
  assert.equal(plain.title, 'Source: not stated, 8:20 PM ET');
  assert.equal(
    byId(untimed.id).title,
    'Source: Fire Wire scanner, time not stated',
  );

  // The hidden loop copy carries the same source.
  const copies = items.filter((item) => item.dataset.id === fire.id);
  assert.equal(copies.length, 2);
  assert.equal(copies[1].getAttribute('aria-hidden'), 'true');
  assert.equal(copies[1].title, copies[0].title);
  assert.equal(
    copies[1].querySelector('.gev-events-crawl-source').textContent,
    'Fire Wire scanner',
  );

  // Event text reaches only the escaped data-id and title attributes.
  const allowed = new Set([
    'class',
    'type',
    'role',
    'aria-label',
    'aria-hidden',
    'tabindex',
    'title',
    'data-act',
    'data-id',
  ]);
  for (const element of host.querySelectorAll('*'))
    for (const { name } of element.attributes)
      assert.ok(allowed.has(name), `unexpected attribute ${name}`);
});

/* ---------------------------- hostile times ------------------------------ */

test('times no Date can hold are missing, and nothing throws on them', () => {
  const beyond = [
    1e20,
    8.64e15 + 1,
    '100000000000000000000',
    Number.MAX_VALUE,
    Infinity,
    -1e20,
    new Date(NaN),
    '1e20',
  ];
  for (const bad of beyond) {
    const label = String(bad);
    assert.equal(eventTimeText(bad, NOW), '', label);
    assert.equal(ageText(bad, NOW), '', label);
  }
  // The very last time a Date can hold still reads.
  assert.notEqual(eventTimeText(8.64e15, NOW), '');

  // A hostile "now" falls back to the real clock instead of throwing.
  for (const now of [1e20, -1, NaN, 'soon', new Date(NaN)]) {
    const label = String(now);
    assert.equal(
      eventTimeText(fire.at, now),
      eventTimeText(fire.at, Date.now()),
      label,
    );
    assert.equal(typeof ageText(fire.at, now), 'string', label);
    assert.doesNotThrow(() => eventCrawlHtml([fire], { now }), label);
    assert.doesNotThrow(() => eventTimelineHtml(data, { now }), label);
    assert.doesNotThrow(() => latestTickerItem(data, now), label);
  }

  // Events, a summary and a response time out of range: rendered without
  // a time, never a RangeError that would blank the Local panel.
  const wild = {
    generatedAt: 1e20,
    summary: { at: 1e20, lines: [{ text: 'Odd clock', tone: 'ok' }] },
    sources: [],
    events: [
      { id: 'a', at: 1e20, seenAt: 1e20, title: 'Far future', layer: 'x' },
      { id: 'b', at: '9'.repeat(30), title: 'Long digits', layer: 'x' },
      { ...fire, id: 'c', threadId: 'c', at: 8.64e15 + 1 },
    ],
  };
  let crawl = '';
  let timeline = '';
  assert.doesNotThrow(() => {
    crawl = eventCrawlHtml(wild, { now: NOW });
  });
  assert.doesNotThrow(() => {
    timeline = eventTimelineHtml(wild, { now: NOW });
  });
  assert.equal(parse(crawl).querySelectorAll('button').length, 6);
  const rows = parse(timeline);
  assert.match(rows.textContent, /Far future/);
  assert.match(rows.textContent, /Time not stated/);
  assert.equal(
    rows.querySelector(`[data-id="c"] time`).getAttribute('datetime'),
    new Date(fire.seenAt).toISOString(),
    'an impossible "at" falls back to when the server saw it',
  );
  // LATEST skips the far-future events; "c" counts from when it was seen.
  assert.equal(latestTickerItem(wild, NOW).eventId, 'c');
  assert.equal(
    latestTickerItem({ events: wild.events.slice(0, 2) }, NOW),
    null,
  );
  assert.doesNotThrow(() => mergeEvents(wild, data));
  assert.equal(mergeEvents(wild, data).generatedAt, NOW);
});

/* ------------------------------- timeline -------------------------------- */

test('the Right now box shows the summary, its tones and the 911 note', () => {
  const host = parse(eventTimelineHtml(data, { now: NOW }));
  const box = host.querySelector('.gev-events-now');
  assert.equal(
    box.querySelector('.gev-events-now-head').textContent,
    'Right now · 9:35 PM',
  );
  const lines = [...box.querySelectorAll('.gev-events-now-line')];
  assert.equal(lines.length, 3);
  assert.equal(lines[0].tagName, 'BUTTON');
  assert.equal(lines[0].dataset.act, 'event');
  assert.equal(lines[0].dataset.id, 'alert:nws:cfw@1');
  assert.ok(lines[0].classList.contains('tone-warn'));
  assert.equal(
    squash(lines[0].textContent),
    'Coastal Flood Warning until 10:00 PM NWS',
  );
  assert.equal(lines[1].tagName, 'SPAN', 'no eventId: plain text');
  assert.equal(lines[2].tagName, 'SPAN', 'an eventId not in the list');
  assert.ok(lines[2].classList.contains('tone-ok'), 'an unknown tone');
  assert.equal(
    box.lastElementChild.textContent,
    'Unofficial. In an emergency call 911.',
  );
});

test('the timeline groups threads, newest activity first, with relation labels', () => {
  const host = parse(eventTimelineHtml(data, { now: NOW }));
  const threads = [
    ...host.querySelectorAll('.gev-events-timeline > .gev-events-thread'),
  ];
  assert.deepEqual(
    threads.map(
      (thread) => thread.querySelector('.gev-events-main').dataset.id ?? null,
    ),
    [fire.id, flood.id, null],
  );
  const [story, warning, report] = threads;
  assert.ok(story.classList.contains('is-cleared'));
  assert.ok(story.classList.contains('tone-warn'));
  assert.ok(!warning.classList.contains('is-cleared'));

  const main = story.querySelector('.gev-events-main');
  assert.equal(main.tagName, 'BUTTON');
  assert.equal(
    squash(main.textContent),
    '8:42 PM 53 min ago 🚒 Fire reported · Rio Grande Structure fire · Middle Twp Fire Source: Fire Wire scanner',
  );
  assert.equal(
    main.querySelector('time').getAttribute('datetime'),
    '2026-11-19T01:42:00.000Z',
  );
  const children = [...story.querySelectorAll('.gev-events-children > li')];
  assert.deepEqual(
    children.map((li) => li.querySelector('.gev-events-rel').textContent),
    ['Update', 'Possibly related · 0.4 mi and 12 min apart', 'Cleared'],
  );
  assert.deepEqual(
    children.map((li) => li.firstElementChild.dataset.id),
    [fireUpdate.id, roadClosed.id, fireCleared.id],
  );
  assert.equal(
    children[0].firstElementChild.tagName,
    'BUTTON',
    'a layer without a position is still clickable',
  );
  assert.match(
    squash(children[1].textContent),
    /^Possibly related · 0\.4 mi and 12 min apart 8:54 PM 🚧 Road closed · Route 47 Both directions Source: 511NJ$/,
  );

  // No position and no layer: plain text, escaped.
  const plain = report.querySelector('.gev-events-main');
  assert.equal(plain.tagName, 'DIV');
  assert.equal(plain.dataset.id, undefined);
  assert.equal(host.querySelector('img, b'), null);
  assert.match(plain.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(plain.textContent, /it's here/);
  assert.match(plain.textContent, /Source: Community report \(unverified\)/);
  assert.equal(
    host.querySelector('.gev-events-sources').textContent,
    'Not reporting: Coast Guard aircraft feed',
  );
});

test('event text never reaches an attribute other than data-id', () => {
  const host = parse(eventTimelineHtml(data, { now: NOW }));
  const allowed = new Set([
    'class',
    'type',
    'role',
    'aria-label',
    'aria-hidden',
    'data-act',
    'data-id',
    'datetime',
  ]);
  for (const element of host.querySelectorAll('*'))
    for (const { name, value } of element.attributes) {
      assert.ok(allowed.has(name), `unexpected attribute ${name}`);
      if (name === 'class')
        assert.match(value, /^[\w -]+$/, `class "${value}" stays a class`);
    }
});

test('an update of a possibly related item keeps the "possibly related" wording', () => {
  const roadUpdate = {
    ...roadClosed,
    id: 'traffic:511nj:12345@2',
    change: 'update',
    title: 'One lane open',
    at: at('2026-11-19T02:05:00Z'),
    related: [{ id: roadClosed.id, reason: 'update' }],
  };
  const noKeys = {
    ...fireUpdate,
    id: 'call:fw:881@4',
    key: null,
    at: at('2026-11-19T02:06:00Z'),
  };
  const nearby = {
    ...roadClosed,
    id: 'aircraft:ae1234@1',
    key: 'aircraft:ae1234',
    kind: 'aircraft',
    change: 'new',
    at: at('2026-11-19T02:07:00Z'),
    related: [],
  };
  const grown = {
    ...fire,
    related: [{ id: nearby.id, reason: 'Coast Guard aircraft nearby' }],
  };
  const host = parse(
    eventTimelineHtml(
      { ...data, events: [grown, roadClosed, roadUpdate, noKeys, nearby] },
      { now: NOW },
    ),
  );
  assert.deepEqual(
    [...host.querySelectorAll('.gev-events-children .gev-events-rel')].map(
      (label) => label.textContent,
    ),
    [
      'Possibly related · 0.4 mi and 12 min apart',
      'Possibly related · 0.4 mi and 12 min apart · update',
      'Update',
      'Possibly related · Coast Guard aircraft nearby',
    ],
  );
  assert.doesNotMatch(host.textContent, /caused|because|due to/i);
});

test('the timeline caps its rows and says how many it shows', () => {
  const host = parse(eventTimelineHtml(data, { now: NOW, limit: 2 }));
  const rows = host.querySelectorAll('.gev-events-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].dataset.id, fireCleared.id, 'the latest change stays');
  assert.equal(
    host.querySelector('.gev-events-children .gev-events-more').textContent,
    '2 earlier entries not shown',
  );
  assert.equal(
    host.querySelector('.gev-events > .gev-events-more').textContent,
    'Showing the latest 2 of 6 events.',
  );
  // Trimmed rows include possibly related events, so they are "entries".
  const one = parse(eventTimelineHtml(data, { now: NOW, limit: 3 }));
  assert.equal(
    one.querySelector('.gev-events-children .gev-events-more').textContent,
    '1 earlier entry not shown',
  );
  assert.doesNotMatch(
    one.textContent + host.textContent,
    /earlier changes?\b/,
    'a possibly related event is not a change',
  );
});

test('the timeline has empty and unavailable states', () => {
  const empty = parse(
    eventTimelineHtml(
      { generatedAt: NOW, summary: { at: NOW, lines: [] }, events: [] },
      { now: NOW },
    ),
  );
  assert.equal(
    empty.querySelector('.gev-events-empty').textContent,
    'No events in the last 48 hours.',
  );
  assert.ok(empty.querySelector('.gev-events-now'), 'Right now still shows');
  assert.equal(
    empty.querySelector('.gev-events-now-line').textContent,
    'Nothing notable in the feeds right now.',
  );
  assert.equal(empty.querySelector('.gev-events-sources'), null);

  const down = parse(eventTimelineHtml(null, { now: NOW }));
  assert.equal(
    down.querySelector('.gev-events-unavailable').textContent,
    'Live events are unavailable right now.',
  );
  assert.equal(
    down.querySelector('.gev-events-note').textContent,
    'Unofficial. In an emergency call 911.',
  );
  assert.equal(down.querySelector('.gev-events-timeline'), null);
});

/* ------------------------------ map target ------------------------------- */

test('eventTarget flies to each kind at its own height and adds its layer', () => {
  const heights = {
    call: 2_500,
    report: 2_500,
    traffic: 2_500,
    flooding: 6_000,
    outage: 6_000,
    aircraft: 60_000,
    airport: 25_000,
  };
  for (const [kind, height] of Object.entries(heights))
    assert.deepEqual(
      eventTarget({ kind, lat: 39.0, lon: -74.8, layer: `${kind}-layer` }),
      { lat: 39.0, lon: -74.8, height, layers: [`${kind}-layer`] },
      kind,
    );
  assert.deepEqual(eventTarget({ kind: 'call', lat: 39, lon: -74.8 }), {
    lat: 39,
    lon: -74.8,
    height: 2_500,
    layers: [],
  });
});

test('a storm within 300 mi of Cape May also turns the radar on', () => {
  // Off the Outer Banks, about 205 mi away.
  assert.deepEqual(
    eventTarget({
      kind: 'storm',
      lat: 36.0,
      lon: -75.5,
      layer: 'weather-cyclones',
    }),
    {
      lat: 36.0,
      lon: -75.5,
      height: 1_500_000,
      layers: ['weather-cyclones', 'weather-radar'],
    },
  );
  // The Bahamas, about 970 mi away.
  assert.deepEqual(
    eventTarget({
      kind: 'storm',
      lat: 25.0,
      lon: -77.0,
      layer: 'weather-cyclones',
    }).layers,
    ['weather-cyclones'],
  );
  // About 330 mi due south: just outside.
  assert.deepEqual(
    eventTarget({ kind: 'storm', lat: 34.15, lon: -74.91, layer: 'x' }).layers,
    ['x'],
  );
});

test('eventTarget with only a layer, or nothing to show', () => {
  assert.deepEqual(
    eventTarget({ kind: 'alert', lat: null, lon: null, layer: 'nws-alerts' }),
    { layers: ['nws-alerts'] },
  );
  assert.deepEqual(
    eventTarget({ kind: 'storm', layer: 'weather-cyclones' }),
    { layers: ['weather-cyclones'] },
    'no position: the radar rule cannot apply',
  );
  assert.equal(eventTarget({ kind: 'call', lat: null, lon: null }), null);
  assert.equal(eventTarget({ kind: 'call', lat: 0, lon: 0 }), null);
  assert.equal(eventTarget({ kind: 'call', lat: 95, lon: -74.8 }), null);
  assert.equal(eventTarget({ kind: 'call', lat: '', lon: '' }), null);
  assert.equal(eventTarget(null), null);
});

/* -------------------------------- ticker --------------------------------- */

test('latestTickerItem shows the newest event of the last 60 minutes', () => {
  const item = latestTickerItem({ events: [fire] }, at('2026-11-19T02:41:00Z'));
  assert.deepEqual(item, {
    key: 'events',
    label: 'LATEST',
    value: '8:42 PM Fire reported · Rio Grande',
    detail: '',
    tone: 'warn',
    layerId: 'scanner-calls',
    title: 'Fire reported · Rio Grande (Fire Wire scanner, 8:42 PM)',
    eventId: fire.id,
  });
  assert.equal(
    latestTickerItem({ events: [fire] }, at('2026-11-19T02:43:00Z')),
    null,
    'over an hour old',
  );
  assert.equal(
    latestTickerItem(
      { events: [fire, roadClosed, hostile] },
      at('2026-11-19T02:00:00Z'),
    ).eventId,
    roadClosed.id,
  );
  // No layer of its own: none, never a stand-in that shows something else.
  for (const layer of [null, undefined, '', '  '])
    assert.equal(
      latestTickerItem(
        { events: [{ ...fire, layer }] },
        at('2026-11-19T02:00:00Z'),
      ).layerId,
      null,
      JSON.stringify(layer),
    );
  assert.equal(latestTickerItem(null, NOW), null);
  assert.equal(latestTickerItem({ events: [] }, NOW), null);
});
