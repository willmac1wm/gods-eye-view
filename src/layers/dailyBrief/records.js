import { DAILY_BRIEF_SECTIONS, DAILY_BRIEF_STALE_MS } from './policy.js';

// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/** Brief statuses the store can hold. */
export const DAILY_BRIEF_STATUSES = Object.freeze([
  'published',
  'review',
  'draft',
  'retracted',
]);

/**
 * Parse the brief's `## ` section headings out of body_md, in the
 * DAILY_BRIEF_SECTIONS order. A section that is missing (an older brief,
 * a malformed body) is simply absent — never invented. Text before the
 * first heading is the lede and is returned under `lede`.
 */
export function parseBriefSections(bodyMd) {
  const text = String(bodyMd ?? '');
  const sections = [];
  let lede = null;
  if (!text.trim()) return { lede, sections };
  const headingRe = /^##\s+(.+?)\s*$/gm;
  const headings = [...text.matchAll(headingRe)];
  if (headings.length === 0) {
    return { lede: text.trim(), sections };
  }
  const first = headings[0];
  const before = text.slice(0, first.index).trim();
  if (before) lede = before;
  const wanted = new Set(DAILY_BRIEF_SECTIONS);
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i][1].trim();
    const start = headings[i].index + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    if (!wanted.has(heading) || !body) continue;
    sections.push({ heading, text: body });
  }
  sections.sort(
    (a, b) =>
      DAILY_BRIEF_SECTIONS.indexOf(a.heading) -
      DAILY_BRIEF_SECTIONS.indexOf(b.heading),
  );
  return { lede, sections };
}

/** The brief's day from its slug (daily-brief-YYYY-MM-DD), else null. */
export function briefSlugDate(slug) {
  const match = /^daily-brief-(\d{4})-(\d{2})-(\d{2})/.exec(String(slug ?? ''));
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
}

/** "Nov. 17, 2026" from a YYYY-MM-DD date, else null. */
export function formatBriefDate(isoDate) {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return null;
  const months = [
    'Jan.',
    'Feb.',
    'Mar.',
    'Apr.',
    'May',
    'Jun.',
    'Jul.',
    'Aug.',
    'Sep.',
    'Oct.',
    'Nov.',
    'Dec.',
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${months[month - 1]} ${day}, ${year}`;
}

/** Normalize one brief post from the /api/news/brief payload. */
export function normalizeDailyBrief(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const headline = text(raw?.headline);
  if (!headline) return null;
  const status = text(raw?.status);
  const slug = text(raw?.slug);
  // updated_at is a seconds epoch in the store; the layer works in ms.
  const updatedAtS = num(raw?.updated_at) ?? num(raw?.published_at);
  const updatedAt = updatedAtS === null ? null : updatedAtS * 1000;
  const { lede, sections } = parseBriefSections(raw?.body_md);
  const date = briefSlugDate(slug);
  return {
    id: num(raw?.id),
    slug,
    date,
    dateLabel: formatBriefDate(date),
    headline,
    dek: text(raw?.dek),
    dateline: text(raw?.dateline),
    bodyMd: text(raw?.body_md),
    lede,
    sections,
    status: DAILY_BRIEF_STATUSES.includes(status) ? status : null,
    confidence: num(raw?.confidence),
    updatedAt,
    stale:
      updatedAt === null ? null : Date.now() - updatedAt > DAILY_BRIEF_STALE_MS,
  };
}

/** Normalize the whole /api/news/brief payload into a snapshot. */
export function normalizeDailyBriefSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const brief = payload.brief ? normalizeDailyBrief(payload.brief) : null;
  // A null brief with a malformed non-null brief object is malformed.
  if (payload.brief && !brief) return null;
  return {
    brief,
    writerEnabled: payload?.writer_enabled === true,
  };
}

/**
 * Validate a normalized snapshot. A null brief is valid — no brief has
 * been written yet (writer inert, or before the first 07:00 run) — but a
 * brief without a headline or with an unknown status is malformed.
 */
export function validateDailyBriefSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (typeof snapshot?.writerEnabled !== 'boolean') return null;
  const brief = snapshot?.brief ?? null;
  if (brief === null) return snapshot;
  if (!brief.headline) return null;
  if (brief.status !== null && !DAILY_BRIEF_STATUSES.includes(brief.status))
    return null;
  return snapshot;
}

/** One-line status for the summary label ("in review", "stale", ...). */
export function briefStatusLabel(brief) {
  if (!brief) return msg('No daily brief yet');
  if (brief.status === 'review') return msg('in review');
  if (brief.stale) return msg('stale');
  return msg('published');
}
