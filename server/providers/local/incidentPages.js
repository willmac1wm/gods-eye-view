/**
 * Public, shareable Incident Pages at `/incidents/{id}` (plus `/incident/{id}`
 * legacy redirect and `/incidents/{id}/card.svg` social preview image).
 *
 * Ported from `cape-dispatch/app/incident_share.py`:
 *   - Fails closed (404) on unknown IDs, unreviewed community reports, or
 *     sensitive/private call natures (domestic, juvenile, psychiatric, DOA, etc.).
 *   - Strips apartment/unit/suite numbers from street addresses.
 *   - Formats the Teresa-style Fire Wire headline:
 *       `UNITS TOWN -- LOCATION -- NATURE`
 *   - Includes full Open Graph & Twitter Card metadata so links pasted into
 *     Facebook, Nextdoor, iMessage, or X unfurl cleanly.
 *   - Links directly back to the 3D Globe centered on the incident's coordinates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_HEADERS } from '../../../build/vite.js';
import { sanitizeReportText } from '../../../src/publicExposure.mjs';

const PUBLIC_BASE_URL = 'https://capemaydispatch.com';

const BLOCKED_NATURE_PATTERNS = [
  /\b(?:sexual\s*assault|rape|sex\s*offense)\b/i,
  /\b(?:suicide|suicidal|self[- ]harm)\b/i,
  /\b(?:doa|dead\s*on\s*arrival|unattended\s*death)\b/i,
  /\b(?:domestic\s*violence|domestic\s*dispute)\b/i,
  /\b(?:juvenile|child\s*abuse|endangering\s*welfare)\b/i,
  /\b(?:psychiatric|mental\s*health|involuntary\s*commit)\b/i,
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isIncidentPublicSafe(incident) {
  if (!incident) return false;
  const combined = [
    incident.title,
    incident.nature,
    incident.summary,
    incident.text,
  ]
    .filter(Boolean)
    .join(' ');
  for (const re of BLOCKED_NATURE_PATTERNS) {
    if (re.test(combined)) return false;
  }
  return true;
}

export function stripUnitNumber(location) {
  const raw = String(location || '').trim();
  if (!raw) return '';
  return raw
    .replace(/\b(?:apt|apartment|unit|ste|suite|rm|room|fl|floor)\s*#?\s*[a-z0-9-]+\b/gi, '')
    .replace(/\s+#\s*[a-z0-9-]+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s-]+|[,\s-]+$/g, '');
}

export function classifyIncidentCategory(titleOrNature = '', kind = '') {
  if (kind === 'community-report') {
    return { label: 'COMMUNITY REPORT', color: '#c77dff', bg: 'rgba(199, 125, 255, 0.16)' };
  }
  const upper = String(titleOrNature || '').toUpperCase();
  if (/\b(?:FIRE|SMOKE|ALARM|BRUSH|STRUCTURE|CHIMNEY|ODOR\s+OF\s+GAS)\b/.test(upper)) {
    return { label: 'FIRE', color: '#ff4d4f', bg: 'rgba(255, 77, 79, 0.16)' };
  }
  if (/\b(?:MVC|MVA|CRASH|ACCIDENT|OVERTURN|PEDESTRIAN|TRAFFIC)\b/.test(upper)) {
    return { label: 'MVC / TRAFFIC', color: '#ffb020', bg: 'rgba(255, 176, 32, 0.16)' };
  }
  if (/\b(?:MARINE|WATER\s+RESCUE|BOAT|DISTRESSED\s+SWIMMER|COAST\s+GUARD)\b/.test(upper)) {
    return { label: 'MARINE / RESCUE', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.16)' };
  }
  if (/\b(?:HAZMAT|SPILL|GAS\s+LEAK|CARBON\s+MONOXIDE|WIRES\s+DOWN)\b/.test(upper)) {
    return { label: 'HAZMAT / UTILITY', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.16)' };
  }
  if (/\b(?:EMS|MEDICAL|RESCUE|CARDIAC|FALL|UNCONSCIOUS|AMBULANCE|BLS|ALS)\b/.test(upper)) {
    return { label: 'EMS / RESCUE', color: '#34d399', bg: 'rgba(52, 211, 153, 0.16)' };
  }
  return { label: 'DISPATCH', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.16)' };
}

export function buildTeresaHeadline({ units = [], town = '', location = '', title = '' } = {}) {
  const unitPart = Array.isArray(units) && units.length
    ? units.slice(0, 3).join(' ').toUpperCase()
    : '';
  const townPart = String(town || 'CAPE MAY COUNTY').trim().toUpperCase();
  const locPart = stripUnitNumber(location).toUpperCase();
  const naturePart = String(title || 'INCIDENT').trim().toUpperCase();

  const lead = [unitPart, townPart].filter(Boolean).join(' ');
  const segments = [lead];
  if (locPart && locPart !== townPart) segments.push(locPart);
  if (naturePart) segments.push(naturePart);
  return segments.filter(Boolean).join(' -- ');
}

function formatEasternTime(isoString) {
  if (!isoString) return 'Time not stated';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(d);
  } catch {
    return String(isoString);
  }
}

function loadApprovedReportById(rawId, reportDir) {
  const cleanId = String(rawId || '')
    .replace(/^report:/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanId) return null;
  const file = path.join(reportDir, `${cleanId}.json`);
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (r.status !== 'approved' || r.visibility !== 'public') return null;
    const title = `Community Report: ${String(r.category || 'other').replace(/-/g, ' ')}`;
    return {
      id: `report:${r.id}`,
      rawId: String(r.id),
      kind: 'community-report',
      title,
      town: r.town || 'Cape May County',
      location: r.town || 'Approximate Location',
      summary: sanitizeReportText(r.text),
      units: [],
      audio: null,
      observedAt: r.createdAt || null,
      lat: Number.isFinite(Number(r.lat)) ? Number(r.lat) : null,
      lon: Number.isFinite(Number(r.lon)) ? Number(r.lon) : null,
      sourceName: 'Cape May Dispatch Community Report (Moderator Reviewed)',
      verified: Boolean(r.verified),
    };
  } catch {
    return null;
  }
}

/**
 * Look up a public-safe incident by ID from local sources or approved reports.
 */
export async function resolvePublicIncident(
  rawId,
  {
    localSources = {},
    reportDir = path.join(process.cwd(), '.gev-data', 'community-reports'),
  } = {},
) {
  const idStr = decodeURIComponent(String(rawId || '').trim());
  if (!idStr || idStr.length > 120) return null;

  // 1. Check approved community reports if prefixed with report: or matching file
  if (idStr.startsWith('report:') || /^\d{10,}-[a-f0-9]{6,}$/i.test(idStr)) {
    const rep = loadApprovedReportById(idStr, reportDir);
    if (rep && isIncidentPublicSafe(rep)) return rep;
    if (idStr.startsWith('report:')) return null;
  }

  // 2. Check public-safety-calls source
  const callNumeric = idStr.replace(/^call:/i, '');
  if (localSources['public-safety-calls']) {
    try {
      const env = await localSources['public-safety-calls'].get();
      const features = Array.isArray(env?.features) ? env.features : [];
      const hit = features.find(
        (f) =>
          String(f.id) === idStr ||
          String(f.id) === `call:${callNumeric}` ||
          String(f.id).replace(/^call:/i, '') === callNumeric,
      );
      if (hit) {
        const normalized = {
          id: String(hit.id).replace(/^call:/i, ''),
          rawId: String(hit.id),
          kind: 'public-safety-call',
          title: hit.title || 'Dispatch Call',
          town: hit.municipality || 'Cape May County',
          location: stripUnitNumber(hit.location || ''),
          summary: hit.summary || null,
          units: Array.isArray(hit.units) ? hit.units : [],
          audio: hit.audio || null,
          observedAt: hit.observedAt || null,
          lat: Number.isFinite(Number(hit.geometry?.lat)) ? Number(hit.geometry.lat) : null,
          lon: Number.isFinite(Number(hit.geometry?.lon)) ? Number(hit.geometry.lon) : null,
          sourceName: env?.source?.name || 'Fire Wire scanner transcription',
          verified: false,
        };
        return isIncidentPublicSafe(normalized) ? normalized : null;
      }
    } catch {
      /* continue */
    }
  }

  // 3. Check traffic-incidents source
  if (localSources['traffic-incidents']) {
    try {
      const env = await localSources['traffic-incidents'].get();
      const features = Array.isArray(env?.features) ? env.features : [];
      const hit = features.find((f) => String(f.id) === idStr);
      if (hit) {
        const normalized = {
          id: String(hit.id),
          rawId: String(hit.id),
          kind: 'traffic-incident',
          title: hit.title || 'Traffic Incident',
          town: hit.from || 'South Jersey',
          location: stripUnitNumber(hit.road || hit.from || ''),
          summary: hit.description || null,
          units: [],
          audio: null,
          observedAt: env?.fetchedAt ? new Date(env.fetchedAt).toISOString() : null,
          lat: Number.isFinite(Number(hit.geometry?.lat)) ? Number(hit.geometry.lat) : null,
          lon: Number.isFinite(Number(hit.geometry?.lon)) ? Number(hit.geometry.lon) : null,
          sourceName: env?.source?.name || 'TomTom Traffic Incidents',
          verified: true,
        };
        return isIncidentPublicSafe(normalized) ? normalized : null;
      }
    } catch {
      /* continue */
    }
  }

  return null;
}

export function renderIncidentCardSvg(incident) {
  const cat = classifyIncidentCategory(incident.title, incident.kind);
  const headline = buildTeresaHeadline(incident);
  const timeText = formatEasternTime(incident.observedAt);
  const summaryText = String(incident.summary || incident.location || 'Cape May County situational awareness update').slice(0, 110);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#070b12"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="48" y="48" width="1104" height="534" rx="24" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
  <circle cx="96" cy="108" r="10" fill="#38bdf8"/>
  <text x="120" y="116" fill="#e2e8f0" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="700">CAPE MAY DISPATCH</text>
  <rect x="88" y="156" width="240" height="44" rx="22" fill="${escapeHtml(cat.color)}" fill-opacity="0.18"/>
  <text x="112" y="185" fill="${escapeHtml(cat.color)}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20" font-weight="700">${escapeHtml(cat.label)}</text>
  <text x="88" y="275" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="40" font-weight="800">${escapeHtml(headline.slice(0, 48))}</text>
  <text x="88" y="335" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28">${escapeHtml(summaryText)}</text>
  <text x="88" y="510" fill="#64748b" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22">${escapeHtml(timeText)} · capemaydispatch.com</text>
</svg>`;
}

export function renderIncidentPageHtml(incident, { baseUrl = PUBLIC_BASE_URL } = {}) {
  const cat = classifyIncidentCategory(incident.title, incident.kind);
  const headline = buildTeresaHeadline(incident);
  const timeText = formatEasternTime(incident.observedAt);
  const canonicalUrl = `${baseUrl}/incidents/${encodeURIComponent(incident.id)}`;
  const cardImageUrl = `${baseUrl}/incidents/${encodeURIComponent(incident.id)}/card.svg`;
  const description =
    incident.summary ||
    `${incident.title} in ${incident.town || 'Cape May County'}${incident.location ? ` near ${incident.location}` : ''} (${timeText}).`;

  const mapHref =
    incident.lat != null && incident.lon != null
      ? `/?lat=${encodeURIComponent(incident.lat)}&lon=${encodeURIComponent(incident.lon)}&incident=${encodeURIComponent(incident.id)}`
      : '/';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0e17">
<title>${escapeHtml(headline)} — Cape May Dispatch</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Cape May Dispatch">
<meta property="og:title" content="${escapeHtml(headline)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(cardImageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(headline)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(cardImageUrl)}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<style>
  :root {
    --bg: #0a0e17;
    --panel: #111827;
    --border: #1f2937;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --accent: #38bdf8;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
  }
  .wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 20px 56px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
  }
  .brand-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 26px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
  }
  .pill {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: ${escapeHtml(cat.color)};
    background: ${escapeHtml(cat.bg)};
    margin-bottom: 14px;
  }
  h1 {
    font-size: 1.45rem;
    line-height: 1.35;
    margin: 0 0 14px;
    color: #f9fafb;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 18px 0;
    padding: 14px;
    background: rgba(255,255,255,0.03);
    border-radius: 10px;
  }
  .label {
    font-size: 0.76rem;
    text-transform: uppercase;
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  .val {
    font-weight: 600;
    font-size: 0.96rem;
  }
  .summary {
    margin: 18px 0;
    padding: 14px 16px;
    border-left: 3px solid var(--accent);
    background: rgba(56, 189, 248, 0.06);
    border-radius: 0 10px 10px 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 22px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 18px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.94rem;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid var(--border);
    background: #1f2937;
    color: var(--text);
  }
  .btn-primary {
    background: #0284c7;
    border-color: #38bdf8;
    color: #fff;
  }
  .disclaimer {
    margin-top: 22px;
    font-size: 0.82rem;
    color: var(--muted);
  }
  audio {
    width: 100%;
    margin-top: 12px;
  }
</style>
</head>
<body data-share-url="${escapeHtml(canonicalUrl)}" data-share-title="${escapeHtml(headline)}">
  <div class="wrap">
    <header>
      <a class="brand" href="/">
        <span class="brand-dot"></span>
        <span>Cape May Dispatch</span>
      </a>
      <a href="/" style="color:var(--accent);text-decoration:none;font-size:0.9rem">Open Live 3D Globe &rarr;</a>
    </header>
    <main class="card">
      <span class="pill">${escapeHtml(cat.label)}</span>
      <h1>${escapeHtml(headline)}</h1>
      <div class="grid">
        <div>
          <div class="label">Municipality</div>
          <div class="val">${escapeHtml(incident.town || 'Cape May County')}</div>
        </div>
        <div>
          <div class="label">Location</div>
          <div class="val">${escapeHtml(incident.location || 'Area only')}</div>
        </div>
        <div>
          <div class="label">Time (Eastern)</div>
          <div class="val">${escapeHtml(timeText)}</div>
        </div>
        ${
          incident.units?.length
            ? `<div><div class="label">Units</div><div class="val">${escapeHtml(incident.units.join(', '))}</div></div>`
            : ''
        }
      </div>
      ${
        incident.summary
          ? `<div class="summary"><div class="label" style="margin-bottom:4px">Summary / Transcript</div><div>${escapeHtml(incident.summary)}</div></div>`
          : ''
      }
      ${
        incident.audio
          ? `<div><div class="label">Dispatch Audio</div><audio controls preload="none" src="${escapeHtml(incident.audio)}"></audio></div>`
          : ''
      }
      <div class="actions">
        <a class="btn btn-primary" href="${escapeHtml(mapHref)}">View on 3D Live Map</a>
        <button type="button" id="btn-share-incident" class="btn">Copy / Share Incident Link</button>
      </div>
      <div class="disclaimer">
        Source: ${escapeHtml(incident.sourceName || 'Public data feed')}. Automated radio transcriptions and community reports are unconfirmed and not an official dispatch record. In an emergency, dial 9-1-1.
      </div>
    </main>
  </div>
  <script type="module" src="/cape-incident.js"></script>
</body>
</html>`;
}

export function renderIncidentNotFoundHtml(id) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Incident Not Available — Cape May Dispatch</title>
<style>
  body { background:#0a0e17; color:#e5e7eb; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; margin:0; padding:48px 20px; text-align:center; }
  .card { max-width:480px; margin:0 auto; background:#111827; border:1px solid #1f2937; border-radius:14px; padding:28px; }
  a { color:#38bdf8; }
</style>
</head>
<body>
  <div class="card">
    <h1 style="margin-top:0;font-size:1.35rem">Incident Not Available</h1>
    <p style="color:#9ca3af;font-size:0.94rem">Incident <code>${escapeHtml(id)}</code> was not found, has expired from the recent window, or is not eligible for public sharing.</p>
    <p><a href="/">Return to the Cape May Dispatch Live 3D Map &rarr;</a></p>
  </div>
</body>
</html>`;
}

export function createIncidentHandler({
  localSources = {},
  reportDir = path.join(process.cwd(), '.gev-data', 'community-reports'),
  baseUrl = PUBLIC_BASE_URL,
} = {}) {
  return async function handleIncidentRequest(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return false;
    }
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // 1. Legacy singular `/incident/:id` -> 302 redirect to `/incidents/:id`
    const legacyMatch = /^\/incident\/([^/]+)$/.exec(pathname);
    if (legacyMatch) {
      res.writeHead(302, {
        ...BROWSER_HEADERS,
        Location: `/incidents/${legacyMatch[1]}`,
        'Cache-Control': 'public, max-age=300',
      });
      res.end();
      return true;
    }

    // 2. Social card SVG `/incidents/:id/card.svg` or `/incident/:id/card.svg`
    const cardMatch = /^\/incidents?\/([^/]+)\/card\.svg$/.exec(pathname);
    if (cardMatch) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return true;
      }
      const incident = await resolvePublicIncident(cardMatch[1], {
        localSources,
        reportDir,
      });
      if (!incident) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return true;
      }
      const svg = renderIncidentCardSvg(incident);
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=120',
      });
      res.end(req.method === 'HEAD' ? undefined : svg);
      return true;
    }

    // 3. Canonical `/incidents/:id`
    const pageMatch = /^\/incidents\/([^/]+)$/.exec(pathname);
    if (!pageMatch) return false;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...BROWSER_HEADERS, Allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return true;
    }

    const incident = await resolvePublicIncident(pageMatch[1], {
      localSources,
      reportDir,
    });
    if (!incident) {
      const notFoundHtml = renderIncidentNotFoundHtml(pageMatch[1]);
      res.writeHead(404, {
        ...BROWSER_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : notFoundHtml);
      return true;
    }

    const html = renderIncidentPageHtml(incident, { baseUrl });
    res.writeHead(200, {
      ...BROWSER_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    });
    res.end(req.method === 'HEAD' ? undefined : html);
    return true;
  };
}

export function installIncidentRoutes(server, options = {}) {
  const handle = createIncidentHandler(options);
  server.middlewares.use((req, res, next) => {
    Promise.resolve(handle(req, res))
      .then((handled) => {
        if (!handled) next();
      })
      .catch(() => {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Incident page error');
        }
      });
  });
}
