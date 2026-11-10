/**
 * Public legal & App Store compliance pages:
 *   GET / HEAD  /privacy
 *   GET / HEAD  /support
 *   GET / HEAD  /terms
 *
 * Ported from cape-dispatch/app/legal.py so the Apple App Store & Google Play
 * links keep working identically after retiring the old app.
 *
 * Key properties:
 *   - Always returns HTTP 200 OK to all visitors (no login redirect).
 *   - Self-contained server-rendered HTML with zero inline scripts and zero
 *     third-party trackers.
 *   - Wraps email addresses in <!--email_off-->...<!--/email_off--> so
 *     Cloudflare Email Address Obfuscation does not inject email-decode.min.js.
 */
import { BROWSER_HEADERS } from '../../../build/vite.js';

const APP_NAME = 'Cape May Dispatch';
const OPERATOR_NAME = 'Cape May Dispatch';
const SUPPORT_EMAIL = 'support@capemaydispatch.com';
const CANONICAL_URL = 'https://capemaydispatch.com';
const EFFECTIVE_DATE = 'April 17, 2026';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageShell(title, activeSlug, bodyHtml) {
  const navItem = (href, slug, label) => {
    const active = activeSlug === slug ? ' aria-current="page" class="active"' : '';
    return `<a href="${href}"${active}>${escapeHtml(label)}</a>`;
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0e17">
<title>${escapeHtml(title)} — ${escapeHtml(APP_NAME)}</title>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<style>
  :root {
    --bg: #0a0e17;
    --panel: #111827;
    --border: #1f2937;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --accent: #38bdf8;
    --danger: #f87171;
    --warn: #fbbf24;
    --ok: #34d399;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  .wrap {
    max-width: 820px;
    margin: 0 auto;
    padding: max(24px, env(safe-area-inset-top)) 20px max(48px, env(safe-area-inset-bottom));
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 18px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--text);
    text-decoration: none;
  }
  .brand-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 0.9rem;
  }
  nav a {
    color: var(--muted);
    text-decoration: none;
  }
  nav a:hover, nav a.active {
    color: var(--accent);
  }
  h1 {
    font-size: 1.75rem;
    line-height: 1.25;
    margin: 0 0 8px;
  }
  .meta {
    color: var(--muted);
    font-size: 0.88rem;
    margin-bottom: 24px;
  }
  h2 {
    font-size: 1.18rem;
    margin-top: 28px;
    margin-bottom: 8px;
    color: #f9fafb;
  }
  p, li {
    color: #d1d5db;
    font-size: 0.96rem;
  }
  ul {
    padding-left: 20px;
  }
  li { margin-bottom: 6px; }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
    margin: 18px 0;
  }
  .emergency-banner {
    border-left: 4px solid var(--danger);
    background: rgba(248, 113, 113, 0.08);
  }
  a { color: var(--accent); }
  code {
    background: #1f2937;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.88rem;
  }
  footer {
    margin-top: 40px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.84rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">
        <span class="brand-dot"></span>
        <span>${escapeHtml(APP_NAME)}</span>
      </a>
      <nav aria-label="Legal and support navigation">
        ${navItem('/', 'map', 'Live Map')}
        ${navItem('/support', 'support', 'Support')}
        ${navItem('/privacy', 'privacy', 'Privacy Policy')}
        ${navItem('/terms', 'terms', 'Terms of Use')}
        ${navItem('/login', 'login', 'Sign In')}
      </nav>
    </header>
    <main>
      ${bodyHtml}
    </main>
    <!--email_off-->
    <footer>
      <span>&copy; 2026 ${escapeHtml(OPERATOR_NAME)}. Independent situational awareness platform for Cape May County, NJ.</span>
      <span>Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></span>
    </footer>
    <!--/email_off-->
  </div>
</body>
</html>`;
}

export function renderPrivacyHtml() {
  const body = `
<!--email_off-->
<h1>Privacy Policy</h1>
<div class="meta">Effective Date: ${EFFECTIVE_DATE} &middot; Applies to ${CANONICAL_URL} and the ${APP_NAME} iOS &amp; web applications</div>

<div class="card emergency-banner">
  <strong>Emergency Notice:</strong> ${APP_NAME} is an informational situational awareness tool and is <strong>not</strong> an official 9-1-1 or emergency dispatch service. In an emergency, always dial <strong>9-1-1</strong> directly.
</div>

<h2>1. Overview</h2>
<p>
  ${OPERATOR_NAME} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the ${APP_NAME} website (${CANONICAL_URL}) and mobile application. This Privacy Policy explains what information we collect, how we use it, how it is shared, and how you can access or delete your data.
</p>

<h2>2. Information We Collect</h2>
<ul>
  <li><strong>Account Information (Optional):</strong> You can browse the live 3D map, NWS weather alerts, NOAA tide gauges, power outages, traffic incidents, and public safety calls without signing in. If you choose to create an account or sign in (including via Sign in with Apple or Google Sign-In powered by Firebase Authentication project <code>cape-dispatch</code>), we collect your authentication identifier, username or display name, and email address (including Apple Private Relay addresses).</li>
  <li><strong>User-Submitted Community Reports:</strong> If you submit a community condition report (such as flooding, road hazard, or storm damage), we store the report text, category, town, optional JPEG photo, and approximate coordinates (rounded to ~100 meters within the South Jersey region). Community reports are saved privately in pending-review status and only appear publicly on the map if approved by a moderator.</li>
  <li><strong>Location Data (Optional):</strong> If you use the &ldquo;Near Me&rdquo; filter or attach your location to a community report, your browser or device requests permission to read your geographic coordinates. You can decline location permission and pick any Cape May County municipality manually.</li>
  <li><strong>Technical &amp; Security Logs:</strong> Our servers record standard HTTP request metadata (IP address, user-agent, timestamp, and rate-limit counters) to protect service availability, enforce daily AI chat budgets, and prevent abuse.</li>
</ul>

<h2>3. How We Use Information</h2>
<ul>
  <li>To provide real-time situational awareness across Cape May County, NJ (weather alerts, tide &amp; flood gauges, outages, traffic incidents, marine buoys, airport weather, and public safety scanner summaries).</li>
  <li>To authenticate your account across sessions and devices via Google and Apple Sign-In.</li>
  <li>To review and display community hazard reports after moderator approval.</li>
  <li>To maintain security, prevent spam (including Cloudflare Turnstile verification where enabled), and comply with legal obligations.</li>
</ul>

<h2>4. Third-Party Services &amp; Public Data Sources</h2>
<p>We do not sell your personal information to third parties or data brokers. We rely on the following service providers and public agencies to operate the app:</p>
<ul>
  <li><strong>Authentication:</strong> Google Firebase Authentication (<code>cape-dispatch</code>), Google Sign-In, and Sign in with Apple.</li>
  <li><strong>Public Weather, Marine &amp; Map Feeds:</strong> National Weather Service (NWS), NOAA Tides &amp; Currents / NWPS, USGS Water Services, Atlantic City Electric outage summaries, OpenStreetMap, Cesium Ion 3D terrain/tiles, Google Maps / Street View, and TomTom traffic incidents.</li>
  <li><strong>Optional AI Local Conditions Q&amp;A:</strong> Questions sent to the local conditions assistant are processed using Google Gemini / OpenAI APIs grounded strictly on the current public conditions snapshot.</li>
</ul>

<h2>5. Public Broadcast &amp; Scanner Transcription Disclaimer</h2>
<p>
  Public safety call summaries and airport radio transcripts displayed in ${APP_NAME} are generated automatically from publicly accessible radio transmissions. Automated speech-to-text and AI summaries may contain errors or omissions and are not official dispatch records. Sensitive personal details are filtered out before display.
</p>

<h2>6. Data Retention &amp; Self-Service Account Deletion</h2>
<p>
  You may delete your account and associated profile data at any time:
</p>
<ul>
  <li><strong>In-App Self-Service Deletion:</strong> Visit <a href="/account">${CANONICAL_URL}/account</a> (or tap <strong>Account &rarr; Delete Account</strong> inside the app) and click <strong>Delete My Account Permanently</strong>. Your account record and active session are removed immediately.</li>
  <li><strong>By Email:</strong> You may also email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the email address associated with your account to request deletion of your account or any submitted community report. Requests are completed within 7 business days.</li>
</ul>

<h2>7. Security</h2>
<p>
  All traffic between your device and ${CANONICAL_URL} is encrypted over HTTPS/TLS, protected by strict Content Security Policy (CSP) headers, HttpOnly session cookies, and rate limiting.
</p>

<h2>8. Children&rsquo;s Privacy</h2>
<p>
  ${APP_NAME} is intended for a general audience and is not directed to children under 13. We do not knowingly collect personal information from children under 13.
</p>

<h2>9. Your Privacy Rights</h2>
<p>
  Depending on your jurisdiction (including New Jersey, California, and the European Economic Area), you have the right to request access to, correction of, or deletion of your personal information. Contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> to exercise these rights.
</p>

<h2>10. Contact Us</h2>
<p>
  If you have questions about this Privacy Policy or our data practices, contact:<br>
  <strong>${OPERATOR_NAME}</strong><br>
  Email: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><br>
  Support Page: <a href="/support">${CANONICAL_URL}/support</a>
</p>
<!--/email_off-->
`;
  return pageShell('Privacy Policy', 'privacy', body);
}

export function renderSupportHtml() {
  const body = `
<!--email_off-->
<h1>Support &amp; Help Center</h1>
<div class="meta">${APP_NAME} &middot; Cape May County &amp; South Jersey Situational Awareness</div>

<div class="card emergency-banner">
  <strong>Not a 9-1-1 Service:</strong> ${APP_NAME} is an independent situational awareness application. Never use this app or support email to report an active emergency. <strong>Dial 9-1-1 immediately</strong> for police, fire, EMS, or Coast Guard assistance.
</div>

<div class="card">
  <h2 style="margin-top:0">Direct Support Contact</h2>
  <p>
    Need help with your account, sign-in, community reports, or the iOS / web app?<br>
    <strong>Email:</strong> <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><br>
    <strong>Typical Response Time:</strong> Within 1&ndash;2 business days.
  </p>
</div>

<h2>Frequently Asked Questions</h2>

<h2>1. How do I sign in with Google or Apple?</h2>
<p>
  Open <a href="/login">${CANONICAL_URL}/login</a> (or click <strong>Sign In</strong> in the top bar of the map) and select <strong>Continue with Google</strong> or <strong>Continue with Apple</strong>. Existing Cape May Dispatch accounts (Firebase project <code>cape-dispatch</code>) work automatically with the same login and permissions.
</p>

<h2>2. How do I delete my account?</h2>
<p>
  Sign in at <a href="/account">${CANONICAL_URL}/account</a> and click <strong>Delete My Account Permanently</strong> for immediate self-service deletion, or email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and we will process your deletion request within 7 business days.
</p>

<h2>3. Why hasn&rsquo;t my community report appeared on the map?</h2>
<p>
  All resident-submitted reports (flooding, road hazards, power outages, storm damage) are saved privately as <code>pending-review</code> when submitted. A Cape May Dispatch moderator reviews each report in the Manager Console before it is made public on the map.
</p>

<h2>4. Why does a tide gauge or scanner feed show &ldquo;not reporting&rdquo; or &ldquo;offline&rdquo;?</h2>
<p>
  ${APP_NAME} labels every data layer with its live upstream source and timestamp (NOAA, NWS, USGS, Atlantic City Electric, TomTom, Broadcastify/Fire Wire). When an upstream station or feed stops reporting, the app explicitly displays that status rather than guessing or showing stale readings as current.
</p>

<h2>5. How do I share a specific incident?</h2>
<p>
  Every public safety call and approved community report has a shareable link at <code>${CANONICAL_URL}/incidents/{id}</code> with social preview cards and a one-click button to fly directly to that location on the 3D map.
</p>

<h2>System &amp; App Information</h2>
<ul>
  <li><strong>Platform:</strong> ${APP_NAME} (3D Globe &amp; Local Situational Awareness Console)</li>
  <li><strong>Coverage Area:</strong> Cape May County, Atlantic County &amp; Cumberland County, NJ</li>
  <li><strong>Legal:</strong> <a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms of Use</a></li>
</ul>
<!--/email_off-->
`;
  return pageShell('Support', 'support', body);
}

export function renderTermsHtml() {
  const body = `
<!--email_off-->
<h1>Terms of Use</h1>
<div class="meta">Effective Date: ${EFFECTIVE_DATE} &middot; ${CANONICAL_URL}</div>

<div class="card emergency-banner">
  <strong>No Emergency Reliance:</strong> ${APP_NAME} provides aggregated public data for informational purposes only. Do not rely on this application for life-safety, navigation, marine, aviation, or evacuation decisions. Always follow official orders from Cape May County OEM, the National Weather Service, and 9-1-1.
</div>

<h2>1. Acceptance of Terms</h2>
<p>
  By accessing or using ${APP_NAME} (${CANONICAL_URL} or the mobile application), you agree to these Terms of Use and our <a href="/privacy">Privacy Policy</a>.
</p>

<h2>2. Informational Use &amp; Accuracy Disclaimer</h2>
<p>
  Weather alerts, tide and flood gauge readings, flood estimates, power outage counts, traffic incidents, aircraft/vessel tracks, and radio transcriptions come from third-party and government feeds that may be delayed, incomplete, or inaccurate. ${OPERATOR_NAME} makes no warranty of completeness, timeliness, or fitness for a particular purpose.
</p>

<h2>3. Acceptable Use &amp; Community Reports</h2>
<ul>
  <li>Do not submit false, misleading, defamatory, or unlawful community reports, or include personal identifying information of private individuals.</li>
  <li>Do not attempt to scrape, overload, bypass rate limits, or interfere with the security of ${APP_NAME}.</li>
  <li>We reserve the right to moderate, reject, or remove any community report or suspend accounts that violate these terms.</li>
</ul>

<h2>4. Limitation of Liability</h2>
<p>
  To the maximum extent permitted by law, ${OPERATOR_NAME} and its contributors shall not be liable for any direct, indirect, incidental, or consequential damages arising from the use of or inability to use ${APP_NAME}.
</p>

<h2>5. Contact</h2>
<p>
  Questions regarding these Terms may be directed to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
</p>
<!--/email_off-->
`;
  return pageShell('Terms of Use', 'terms', body);
}

const LEGAL_RENDERERS = new Map([
  ['/privacy', renderPrivacyHtml],
  ['/support', renderSupportHtml],
  ['/terms', renderTermsHtml],
]);

export function handleLegalRequest(req, res) {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return false;
  }
  const render = LEGAL_RENDERERS.get(pathname);
  if (!render) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {
      ...BROWSER_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      Allow: 'GET, HEAD',
    });
    res.end('Method Not Allowed');
    return true;
  }
  const html = render();
  res.writeHead(200, {
    ...BROWSER_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
  res.end(req.method === 'HEAD' ? undefined : html);
  return true;
}

export function installLegalRoutes(server) {
  server.middlewares.use((req, res, next) => {
    if (handleLegalRequest(req, res)) return;
    next();
  });
}
