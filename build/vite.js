import { fileURLToPath } from 'node:url';
import { isPublicExposure } from '../src/publicFlags.mjs';
import cesium from 'vite-plugin-cesium';
import vue from '@vitejs/plugin-vue';
import { VUE_PLUGIN_OPTIONS } from './vueOptions.js';
import { DEFAULT_ALLOWED_HOSTS, hostCheckPlugin } from './allowedHosts.js';
import { embedFramingPlugin } from './embed-framing.js';
import { panelBuildPlugin } from './panel.js';

/**
 * The repository root (this file lives at `<root>/build/vite.js`), as a
 * forward-slash path for glob matching. Vite's `fs.deny` patterns are
 * matched against the full absolute file path, and a bare `**\/dist/**`
 * matches a `dist` directory at *any* depth — including dependencies that
 * ship their own, such as `node_modules/vite/dist/client/client.mjs` (the
 * dev client itself). Anchoring to this repository's root denies only the
 * project's own build output.
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
  .replace(/\\/g, '/')
  .replace(/\/$/, '');

export function escapeFsDenyPath(path) {
  return path.replace(/[()[\]{}*?!+@|]/g, '\\$&');
}

const REPO_ROOT_GLOB = escapeFsDenyPath(REPO_ROOT);

/**
 * Browser-safe form of the optional Photon endpoint build input. Only https
 * is accepted: the page's connect-src allows no plain-http origin, so an
 * http endpoint would only fail later, silently, in the browser.
 */
function photonEndpointSetting(value) {
  if (value === undefined) return undefined;
  const text = String(value ?? '').trim();
  if (!text || ['off', 'none', 'disabled'].includes(text.toLowerCase()))
    return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy for every document the dev/preview server serves.
 * No inline script is permitted, and the only foreign script origins are the
 * three that the Bhote Koshi event's embedded media needs (YouTube, Facebook
 * and X), which frame-src matches for their players and posts. 'unsafe-eval' is
 * required: Knockout (bundled inside @cesium/widgets) resolves the global
 * object with `(0, eval)("this")` at module load, and without it the Cesium
 * widget never initializes (verified in headless Chrome). It also covers
 * Cesium's WASM decoders. `blob:` is required in the built app: Cesium's
 * bundled workers bootstrap through `importScripts(blob:...)`, which a worker
 * checks against script-src (the dev server loads them by URL instead).
 * Widen any other directive only for a real violation.
 */
export const BROWSER_CSP = [
  "default-src 'self'",
  // The Bhote Koshi event's embedded media: the YouTube player API, the
  // Facebook video SDK and X's post widget (src/data/bhoteKoshiEmbeddedMedia.js);
  // and the Maps JavaScript API that Street Level's Google Street View runs on.
  "script-src 'self' 'unsafe-eval' blob: https://www.youtube.com https://connect.facebook.net https://platform.twitter.com https://maps.googleapis.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' blob: data: https: wss: ws:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // The same media's players and posts, which load in frames.
  "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.youtube.com https://www.facebook.com https://platform.twitter.com https://challenges.cloudflare.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Response headers shared by the dev and preview servers. */
export const BROWSER_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': BROWSER_CSP,
  // Responses are only ever used as the type the server declares.
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()',
});

/**
 * Content-Security-Policy for every `/api` response. API routes return data,
 * never a document, so a response opened directly in a tab gets no origin and
 * can load nothing.
 */
export const API_CSP = "default-src 'none'; sandbox";

/** Response headers every `/api` response carries. */
export const API_HEADERS = Object.freeze({
  'Content-Security-Policy': API_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()',
});

/**
 * Whether a request reaches an `/api` mount, by the router's own rule: the
 * prefix compared without case and followed by the end, `/` or `.`. The router
 * reads an absolute-form target's path without resolving dot segments, so the
 * path is taken here the same way (scheme and authority dropped, backslashes as
 * slashes), alongside the raw and the fully parsed path; any match counts.
 */
function isApiPath(url) {
  const raw = String(url || '/');
  const target = raw
    .trim()
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .replace(/^[a-z][a-z0-9+.-]*:(?:\/\/[^/]*)?/i, '');
  let parsed = '';
  try {
    parsed = new URL(raw, 'http://localhost').pathname;
  } catch {
    /* the unparsed paths still decide */
  }
  return [raw.split(/[?#]/, 1)[0], target, parsed].some((path) =>
    /^\/api(?:$|[/.])/i.test(path),
  );
}

/**
 * Vite plugin that sets API_HEADERS on every API response before any other
 * middleware runs, so success, error, partial, refused and unknown-route
 * answers all carry them. Vite's `server.headers` and `preview.headers` only
 * reach the documents and assets Vite serves itself. A route may still add
 * headers; a route's own Content-Security-Policy is sent as an additional
 * policy, which can only restrict further, never replace this one.
 */
const PROXY_HEADER_NAMES = [
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ray',
];

function hasProxyHeaders(headers = {}) {
  return PROXY_HEADER_NAMES.some(
    (name) => String(headers[name] || '').trim() !== '',
  );
}

/**
 * Block HTTP access to sensitive files, dotfiles, logs, build/server sources,
 * and Vite internal escape paths (/@fs/, ?raw on non-src files) in both dev
 * and preview servers before Vite's static or transform plugins run.
 */
function isBlockedPublicPath(rawUrl, { isPreview = false, hasProxy = false } = {}) {
  const raw = String(rawUrl || '/').trim();
  const noQuery = raw.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  let decoded = noQuery;
  try {
    decoded = decodeURIComponent(noQuery).replace(/\\/g, '/');
  } catch {
    return true;
  }
  for (const candidate of [noQuery, decoded]) {
    const lower = candidate.toLowerCase();
    if (
      lower.startsWith('/@fs/') ||
      lower === '/@fs' ||
      lower === '/__vite_ping' ||
      lower.startsWith('/node_modules/.vite/')
    ) {
      return true;
    }
    if (/(?:^|\/)\.(?:env|git|gev-[a-z0-9_-]*|claude|cursor)(?:$|[/.])/i.test(lower)) {
      return true;
    }
    if (
      /^\/(?:gev-service[^/]*|[^/]*\.log|package(?:-lock)?\.json|vite\.config\.[^/]+|environment|security\.md|readme\.md|server(?:\/|$)|build(?:\/|$)|scripts(?:\/|$))/i.test(
        lower,
      )
    ) {
      return true;
    }
    if (
      isPreview &&
      /^\/(?:src(?:\/|$)|@vite(?:\/|$)|node_modules(?:\/|$))/i.test(lower)
    ) {
      return true;
    }
  }
  const query = raw.includes('?')
    ? raw.slice(raw.indexOf('?') + 1).split('#', 1)[0]
    : '';
  if (query && /(?:^|&)(?:raw|import|inline)(?:=|$|&)/i.test(query)) {
    if (isPreview || hasProxy || !decoded.startsWith('/src/')) {
      return true;
    }
  }
  return false;
}

/**
 * Refuse cross-site browser requests on every /api/* route (Sec-Fetch-Site
 * other than same-origin/none, or an Origin that does not match Host).
 */
function isCrossSiteApiRequest(req) {
  const site = String(req.headers?.['sec-fetch-site'] || '')
    .trim()
    .toLowerCase();
  if (site !== '' && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers?.origin;
  if (origin !== undefined && origin !== null && origin !== '') {
    if (origin === 'null') return true;
    const host = String(req.headers?.host || '')
      .trim()
      .toLowerCase();
    if (!host || /[\s/?#@]/.test(host)) return true;
    const protoHeader = String(req.headers?.['x-forwarded-proto'] || '')
      .trim()
      .toLowerCase();
    const proto =
      req.socket?.encrypted || protoHeader === 'https' ? 'https:' : 'http:';
    try {
      const parsedOrigin = new URL(String(origin));
      const expectedOrigin = new URL(`${proto}//${host}`).origin;
      if (
        parsedOrigin.username !== '' ||
        parsedOrigin.password !== '' ||
        parsedOrigin.pathname !== '/' ||
        parsedOrigin.search !== '' ||
        parsedOrigin.hash !== '' ||
        parsedOrigin.origin !== expectedOrigin
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

export function apiResponseHeadersPlugin() {
  const makeInstall = (isPreview) => (server) => {
    server.middlewares.use((req, res, next) => {
      const hasProxy = hasProxyHeaders(req.headers);
      const pathOnly = String(req.url || '/').split('?')[0];
      let decoded = pathOnly;
      try {
        decoded = decodeURIComponent(pathOnly);
      } catch {
        res.writeHead(400, {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        return res.end('Bad request');
      }
      if (decoded.includes('..') || decoded.includes('\\')) {
        const headers = {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        };
        if (isApiPath(req.url)) Object.assign(headers, API_HEADERS);
        res.writeHead(404, headers);
        return res.end('Not found');
      }
      if (isPublicExposure() && req.method === 'OPTIONS' && isApiPath(req.url)) {
        res.statusCode = 204;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end();
        return;
      }
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) => {
        if (
          isPublicExposure() &&
          String(name).toLowerCase() === 'access-control-allow-origin' &&
          String(value).trim() === '*'
        )
          return res;
        return setHeader(name, value);
      };
      if (!isApiPath(req.url)) {
        if (isBlockedPublicPath(req.url, { isPreview, hasProxy })) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end('Forbidden');
          return undefined;
        }
        return next();
      }
      for (const [name, value] of Object.entries(API_HEADERS))
        res.setHeader(name, value);
      if (/^(1|true|yes|on)$/i.test(String(process.env.GEV_HSTS || '').trim()))
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
      const setApiHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) =>
        String(name).toLowerCase() === 'content-security-policy' &&
        String(value) !== API_CSP
          ? setApiHeader(name, `${API_CSP}, ${value}`)
          : setApiHeader(name, value);
      const cleanPath = String(req.url || '/')
        .split(/[?#]/, 1)[0]
        .toLowerCase();
      if (
        (isPreview || isPublicExposure()) &&
        /^\/api\/setup(?:\/|$)/.test(cleanPath)
      ) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: 'Not found' }));
        return undefined;
      }
      if (isCrossSiteApiRequest(req)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: 'Cross-site requests are not accepted' }));
        return undefined;
      }
      return next();
    });
  };
  return {
    name: 'api-response-headers',
    enforce: 'pre',
    configureServer: makeInstall(false),
    configurePreviewServer: makeInstall(true),
  };
}

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  photonUrl,
  mapillaryToken,
  host = 'localhost',
  port = 4173,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  command,
} = {}) {
  const photonSetting = photonEndpointSetting(photonUrl);
  const hsts = /^(1|true|yes|on)$/i.test(String(process.env.GEV_HSTS || '').trim())
    ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' }
    : {};
  const headers = { ...BROWSER_HEADERS, ...hsts };
  return {
    plugins: [
      // First, so every API response, including a Host refusal, carries them.
      apiResponseHeadersPlugin(),
      // Next, so no provider route answers a Host the server does not allow.
      hostCheckPlugin(),
      cesium(),
      // Application views are Vue single-file components.
      vue(VUE_PLUGIN_OPTIONS),
      ...plugins,
      embedFramingPlugin(),
      panelBuildPlugin(),
    ],
    ...(publicDir === undefined ? {} : { publicDir }),
    // A production build must not clean the dependency cache a running dev
    // server is still serving optimized module URLs from.
    ...(command === 'build' ? { cacheDir: 'node_modules/.vite-build' } : {}),
    optimizeDeps: {
      // First reached through the SDR worker or a dynamic import. Pre-bundle
      // them at startup so first use cannot invalidate already-transformed
      // URLs with Vite's "Outdated Optimize Dep" 504 response.
      include: [
        '@jtarrio/signals/demod/demodulator.js',
        '@jtarrio/signals/demod/modes.js',
        '@jtarrio/webrtlsdr/rtlsdr.js',
        'egm96-universal',
        // Loaded on demand when the first street-level image opens.
        'mapillary-js',
      ],
    },
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      // A wildcard bind only chooses interfaces; it never disables Vite's
      // Host-header check. LAN hostnames are added explicitly (see
      // build/allowedHosts.js); IP addresses are always accepted.
      allowedHosts: [...allowedHosts],
      fs: {
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          '**/ENVIRONMENT',
          '**/.gev-logs/**',
          '**/.gev-cache/**',
          // Root-anchored: a bare '**/dist/**' would also deny every
          // dependency's own dist/ (e.g. node_modules/vite/dist/client),
          // breaking /@vite/client and other dev-client assets.
          `${REPO_ROOT_GLOB}/dist/**`,
        ],
      },
      // These headers protect the document containing Provider Settings and
      // give the whole page a real Content-Security-Policy (BROWSER_CSP).
      // Embed-mode documents are framable instead: embed-framing.js rewrites
      // only the frame-ancestors directive and keeps the rest of the policy.
      headers,
    },
    // The preview server serves the same documents, so it carries the same
    // framing + CSP hardening (one constant, no drift).
    preview: { headers, allowedHosts: [...allowedHosts] },
    define: {
      // vue-i18n holds the locale and catalogs; Core formats the messages
      // (src/ui/i18n.js), so the build drops vue-i18n's message compiler.
      __VUE_I18N_FULL_INSTALL__: 'false',
      __VUE_I18N_LEGACY_API__: 'false',
      __INTLIFY_PROD_DEVTOOLS__: 'false',
      __INTLIFY_DROP_MESSAGE_COMPILER__: 'true',
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
      // Only expose a validated URL or the explicit disabled sentinel.
      ...(photonSetting === undefined
        ? {}
        : {
            'import.meta.env.PHOTON_URL': JSON.stringify(photonSetting),
          }),
      // Mapillary client tokens are public by design (see SECURITY.md).
      'import.meta.env.MAPILLARY_CLIENT_TOKEN': JSON.stringify(
        mapillaryToken ?? '',
      ),
    },
    build: { chunkSizeWarningLimit: 1500, sourcemap: false },
  };
}
