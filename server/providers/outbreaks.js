// server/providers/outbreaks.js
// CDC ArboNET (West Nile / arbovirus, U.S. federal public domain) +
// WHO Disease Outbreak News (CC BY-NC-SA 3.0 IGO — NON-COMMERCIAL ONLY)
// proxy. The two halves are fetched independently and stay
// source-labeled: CDC is the county-relevant half (West Nile is the
// mosquito-season angle for Cape May County), WHO is international
// context only.
//
// Verified live 2026-11-17 (with the provider's own User-Agent — all
// five calls HTTP 200): the CDC current-year dashboard JSON lists live
// CSVs under wcms/vizdata/live/ncezid_dvbd/WNV/ — CountbyState (NJ 35
// reported cases) and hum_nonhum (county human + non-human activity;
// Cape May Co FIPS 34009: non-human activity, 0 human cases). The
// "current as of" date lives only on the HTML page (November 10, 2026),
// split across elements, so the extractor tolerates tags and whitespace
// between the parts. The WHO OData endpoint returns 50 DONs (latest Nov
// 13, 2026: MERS – Qatar, DON626). The old WHO RSS URL 404s — never used.
// CDC data are preliminary and subject to change; counts are served with
// their as-of date, never as live. Pattern mirrors iodaProxy (TTL cache,
// single-flight refresh, backoff, serve-stale-on-failure, 502 cold).
//
// Routes:
//   GET /api/outbreaks        → {fetchedAt, stale, ttlMs, arbonet: {ok, asOf, status, states, njCounties}, don: {ok, items}}
//   GET /api/outbreaks/status → {lastFetch, stale, ttlMs, counts, arbonet: {ok, asOf}, don: {ok}}
//
// @returns {import('vite').Plugin}
import {
  readResponseJsonCapped,
  readResponseTextCapped,
} from './common/http.js';

export const CDC_DASHBOARD_JSON_URL =
  'https://www.cdc.gov/west-nile-virus/data-maps/current-data.json';
export const CDC_CURRENT_YEAR_PAGE_URL =
  'https://www.cdc.gov/west-nile-virus/data-maps/current-year-data.html';
export const CDC_WNV_CSV_BASE =
  'https://www.cdc.gov/wcms/vizdata/live/ncezid_dvbd/WNV';
export const CDC_COUNT_BY_STATE_CSV = 'wnv_hum_current_CountbyState.csv';
export const CDC_HUM_NONHUM_CSV = 'wnv_current_hum_nonhum.csv';
export const WHO_DON_ODATA_URL =
  'https://www.who.int/api/emergencies/diseaseoutbreaknews?sf_provider=dynamicProvider372&sf_culture=en&$orderby=PublicationDateAndTime%20desc&$expand=EmergencyEvent&$select=Title,TitleSuffix,OverrideTitle,UseOverrideTitle,regionscountries,ItemDefaultUrl,FormattedDate,PublicationDateAndTime';
export const OUTBREAKS_PROXY_TTL_MS = 24 * 60 * 60_000;
export const OUTBREAKS_PROXY_TIMEOUT_MS = 15_000;
export const OUTBREAKS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
export const OUTBREAKS_DON_LIMIT = 20;
const OUTBREAKS_MAX_RESPONSE_BYTES = 1024 * 1024;
const OUTBREAKS_BACKOFF_MS = 60_000;
const OUTBREAKS_NJ_FIPS_PREFIX = '34';

/** The upstream CDC dashboard URL (exposed for tests). */
export function outbreaksUpstreamUrl() {
  return CDC_DASHBOARD_JSON_URL;
}

function parseRetryAfterMs(response, now) {
  const raw = response?.headers?.get?.('Retry-After');
  if (raw == null || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 60 * 60_000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now());
  return null;
}

/** Split one CSV record line into fields (quoted fields supported). */
export function parseCsvRecord(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Parse the CountbyState CSV ("State","Reported Cases","Legend") into
 * [{state, cases, band}]. The header row is skipped; a row needs a state
 * code and a numeric case count.
 */
export function parseCountByStateCsv(text) {
  const rows = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseCsvRecord(line);
    if (fields[0] === 'State') continue;
    const cases = Number(fields[1]);
    if (!fields[0] || !Number.isFinite(cases)) continue;
    rows.push({ state: fields[0], cases, band: fields[2] || null });
  }
  return rows;
}

/**
 * Parse the hum_nonhum CSV
 * ("County","Activity","Total human disease cases","Neuroinvasive
 * disease cases","Presumptive viremic blood donors") into rows, keeping
 * only New Jersey counties (FIPS 34xxx) — the layer surfaces NJ counties
 * plus the national state table, never all 944 county rows. The County
 * column is a FIPS code, not a name.
 */
export function parseHumNonhumCsv(text) {
  const rows = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseCsvRecord(line);
    if (fields[0] === 'County') continue;
    const fips = fields[0];
    if (!fips?.startsWith(OUTBREAKS_NJ_FIPS_PREFIX)) continue;
    const humanCases = Number(fields[2]);
    if (!Number.isFinite(humanCases)) continue;
    rows.push({
      fips,
      activity: fields[1] || null,
      humanCases,
      neuroinvasive:
        fields[3] === '' || fields[3] === undefined ? null : Number(fields[3]),
      donors:
        fields[4] === '' || fields[4] === undefined ? null : Number(fields[4]),
    });
  }
  return rows;
}

/**
 * Extract the CDC "current as of" date from the current-year page HTML.
 * The date is split across elements ("November 10" + "," + "2026"), so
 * the text is tag-stripped first and the regex tolerates whitespace
 * between the parts. Returns "Month D, YYYY" or null when not found —
 * never invent a date; a null asOf means "as-of date unavailable".
 */
export function extractCdcAsOfDate(html) {
  const stripped = String(html ?? '').replace(/<[^>]*>/g, ' ');
  const match = stripped.match(
    /Data are current as of\s*([A-Za-z]+ \d{1,2}\s*,\s*\d{4})/,
  );
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').replace(/\s*,\s*/, ', ');
}

/**
 * Normalize one WHO OData DON item to {id, title, date, dateIso, url}.
 * The id comes from the item URL ("/2026-DON626" → "DON626"); the title
 * prefers the override title; the date is WHO's FormattedDate
 * ("13 November 2026"), parsed to ISO when possible.
 */
export function normalizeWhoDonItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const url =
    typeof raw.ItemDefaultUrl === 'string' ? raw.ItemDefaultUrl.trim() : '';
  const idMatch = url.match(/(DON\d+)\s*$/i);
  const id = idMatch ? idMatch[1].toUpperCase() : null;
  if (!id) return null;
  const title =
    (typeof raw.OverrideTitle === 'string' && raw.OverrideTitle.trim()) ||
    (typeof raw.Title === 'string' && raw.Title.trim()) ||
    null;
  if (!title) return null;
  const date =
    typeof raw.FormattedDate === 'string' ? raw.FormattedDate.trim() : null;
  const parsed = date ? Date.parse(date) : NaN;
  return {
    id,
    title,
    date,
    dateIso: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    url: url
      ? `https://www.who.int${url.startsWith('/') ? url : `/${url}`}`
      : null,
  };
}

export function outbreaksProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  const TTL_MS = OUTBREAKS_PROXY_TTL_MS;
  /** @type {?{at: number, arbonet: object, don: object}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  /** One upstream text call. Throws on HTTP error or oversize. */
  async function fetchText(url, signal, accept = 'text/plain') {
    const res = await fetchImpl(url, {
      signal,
      headers: {
        Accept: accept,
        'User-Agent': OUTBREAKS_PROXY_USER_AGENT,
      },
    });
    if (res.status === 429) {
      const error = new Error('outbreaks upstream rate limited (HTTP 429)');
      error.rateLimited = true;
      error.retryAfterMs = parseRetryAfterMs(res, now);
      await res.body?.cancel().catch(() => {});
      throw error;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let body;
    try {
      // readResponseTextCapped returns the text directly and throws
      // {code: 'RESPONSE_TOO_LARGE'} past the cap.
      body = await readResponseTextCapped(
        res,
        OUTBREAKS_MAX_RESPONSE_BYTES,
        signal,
      );
    } catch (err) {
      if (err?.code === 'RESPONSE_TOO_LARGE')
        throw new Error('upstream response exceeded size cap');
      throw err;
    }
    return body;
  }

  /** One upstream JSON call. Throws on HTTP error, oversize, or non-JSON. */
  async function fetchJson(url, signal) {
    const res = await fetchImpl(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': OUTBREAKS_PROXY_USER_AGENT,
      },
    });
    if (res.status === 429) {
      const error = new Error('outbreaks upstream rate limited (HTTP 429)');
      error.rateLimited = true;
      error.retryAfterMs = parseRetryAfterMs(res, now);
      await res.body?.cancel().catch(() => {});
      throw error;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let payload;
    try {
      payload = await readResponseJsonCapped(
        res,
        OUTBREAKS_MAX_RESPONSE_BYTES,
        signal,
      );
    } catch (err) {
      if (err?.code === 'RESPONSE_TOO_LARGE')
        throw new Error('upstream response exceeded size cap');
      throw err;
    }
    if (!payload || typeof payload !== 'object')
      throw new Error('non-JSON upstream response');
    return payload;
  }

  /**
   * Refresh the CDC half: dashboard JSON → CSV URLs (falling back to the
   * known wcms/vizdata paths when the dashboard is down) → both CSVs →
   * page HTML for the as-of date. Throws when no usable CDC data comes
   * back; the as-of date alone never fails the half (asOf null means
   * "as-of date unavailable").
   */
  async function refreshArbonet(signal) {
    let stateCsvUrl = `${CDC_WNV_CSV_BASE}/${CDC_COUNT_BY_STATE_CSV}`;
    let countyCsvUrl = `${CDC_WNV_CSV_BASE}/${CDC_HUM_NONHUM_CSV}`;
    try {
      const dashboard = await fetchJson(CDC_DASHBOARD_JSON_URL, signal);
      const datasets =
        dashboard?.datasets && typeof dashboard.datasets === 'object'
          ? dashboard.datasets
          : {};
      for (const key of Object.keys(datasets)) {
        if (key.endsWith(`/${CDC_COUNT_BY_STATE_CSV}`)) stateCsvUrl = key;
        if (key.endsWith(`/${CDC_HUM_NONHUM_CSV}`)) countyCsvUrl = key;
      }
    } catch (err) {
      warn(
        '[outbreaks-proxy] CDC dashboard JSON failed, using known CSV paths:',
        err?.message || err,
      );
    }
    const [stateText, countyText, pageHtml] = await Promise.all([
      fetchText(stateCsvUrl, signal, 'text/csv'),
      fetchText(countyCsvUrl, signal, 'text/csv'),
      fetchText(CDC_CURRENT_YEAR_PAGE_URL, signal, 'text/html').catch((err) => {
        warn(
          '[outbreaks-proxy] CDC page fetch failed, as-of date unknown:',
          err?.message || err,
        );
        return null;
      }),
    ]);
    const states = parseCountByStateCsv(stateText);
    const njCounties = parseHumNonhumCsv(countyText);
    if (states.length === 0) throw new Error('CDC state table came back empty');
    return {
      ok: true,
      asOf: pageHtml ? extractCdcAsOfDate(pageHtml) : null,
      status: 'preliminary',
      states,
      njCounties,
    };
  }

  /** Refresh the WHO half: OData DON feed, newest first, capped. */
  async function refreshDon(signal) {
    const payload = await fetchJson(WHO_DON_ODATA_URL, signal);
    if (!Array.isArray(payload.value))
      throw new Error('non-WHO-DON upstream response');
    const items = [];
    for (const raw of payload.value) {
      const item = normalizeWhoDonItem(raw);
      if (item) items.push(item);
      if (items.length >= OUTBREAKS_DON_LIMIT) break;
    }
    return { ok: true, items };
  }

  /**
   * Refresh both halves. Partial success (≥1 half ok) still produces a
   * cacheable entry with the failed half marked ok:false; total failure
   * throws so the caller can serve stale.
   */
  async function refreshUpstream() {
    const signal = AbortSignal.timeout(OUTBREAKS_PROXY_TIMEOUT_MS);
    const settled = await Promise.allSettled([
      refreshArbonet(signal),
      refreshDon(signal),
    ]);
    const [arbonetResult, donResult] = settled;
    let rateLimited = null;
    const arbonet =
      arbonetResult.status === 'fulfilled'
        ? arbonetResult.value
        : {
            ok: false,
            asOf: null,
            status: 'preliminary',
            states: [],
            njCounties: [],
          };
    const don =
      donResult.status === 'fulfilled'
        ? donResult.value
        : { ok: false, items: [] };
    for (const result of settled) {
      if (result.status === 'rejected') {
        const reason = result.reason;
        if (reason?.rateLimited === true && !rateLimited) rateLimited = reason;
        warn('[outbreaks-proxy] half fetch failed:', reason?.message || reason);
      }
    }
    if (!arbonet.ok && !don.ok) {
      const error = new Error('all outbreaks halves failed');
      if (rateLimited) {
        error.rateLimited = true;
        error.retryAfterMs = rateLimited.retryAfterMs;
      }
      throw error;
    }
    return { at: now(), arbonet, don };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      arbonet: entry.arbonet,
      don: entry.don,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/outbreaks', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];

        if (subPath === '/status') {
          sendJson(200, {
            lastFetch: mem ? mem.at : null,
            stale: mem ? now() - mem.at >= TTL_MS : false,
            ttlMs: TTL_MS,
            counts: mem
              ? {
                  states: mem.arbonet.states.length,
                  njCounties: mem.arbonet.njCounties.length,
                  don: mem.don.items.length,
                }
              : null,
            arbonet: mem
              ? { ok: mem.arbonet.ok, asOf: mem.arbonet.asOf }
              : null,
            don: mem ? { ok: mem.don.ok } : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        // In backoff after repeated failures: serve stale, do not hammer
        // the upstream. A cold cache in backoff still answers 502.
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error:
              lastFailure ?? 'Outbreaks fetch failed and no cache available',
          });
          return;
        }
        // Stale or missing → refresh, single-flight (concurrent requests
        // share one upstream pass). Capture the promise locally BEFORE
        // awaiting: the .finally() nulls `inflight` the moment it settles.
        if (!inflight) {
          inflight = refreshUpstream()
            .then((fresh) => {
              mem = fresh;
              backoffUntil = 0;
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              const retryAfterMs =
                err?.rateLimited === true ? err.retryAfterMs : null;
              backoffUntil = now() + (retryAfterMs ?? OUTBREAKS_BACKOFF_MS);
              // A bare HTTP status adds nothing to a cold-cache 502, so
              // only a rate limit gets a specific message.
              lastFailure =
                err?.rateLimited === true
                  ? 'Outbreaks upstream rate limited (HTTP 429)'
                  : null;
              warn(
                `[outbreaks-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
              );
              return null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        const pending = inflight;
        const fresh = await pending;
        if (fresh) {
          sendJson(200, buildPayload(fresh, false));
        } else if (entry) {
          sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
        } else {
          sendJson(502, {
            error:
              lastFailure ?? 'Outbreaks fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[outbreaks-proxy] error:', err?.message || err);
        sendJson(500, { error: 'outbreaks proxy error' });
      }
    });
  };
  return {
    name: 'outbreaks-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
