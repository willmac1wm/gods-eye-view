// Cape May Dispatch read-only proxy: /api/cape/<path> -> ${CAPE_DISPATCH_URL}/api/<path>.
// Allowlisted GET reads only; no admin/manager/review/account/members/evidence/uploads/push; no AIS.
const DEFAULT_CAPE_URL = 'https://capemaydispatch.com';
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15000;

export const CAPE_ALLOW = [
  /^health\/sources$/,
  /^air(\/[\w-]+)?$/,
  /^aircraft\/(details|photo)$/,
  /^airport_wx$/,
  /^aviation\/tfrs$/,
  /^hazards$/,
  /^storm_status$/,
  /^storms$/,
  /^feeds$/,
  /^county[-_]status$/,
  /^floodwatch$/,
  /^buoys$/,
  /^flood_gauges(\/[\w-]+)?$/,
  /^flood_map\/(plan|streets)$/,
  /^flood_map\/tile\/\d{1,2}\/\d+\/\d+\.png$/,
  /^flood_card$/,
  /^flood3d\/[\w.-]+$/,
  /^sar\/flood[\w-]*$/,
  /^tools\/flood-zone$/,
  /^wx\/(status|wind)$/,
  /^power_outages$/,
  /^traffic_cameras$/,
  /^webcams$/,
  /^fx\/cameras$/,
  /^intel\/nj511_cameras$/,
  /^fx\/cam\/[\w.-]+\.jpg$/,
  /^radio\/(feeds|live|buffer|seek)$/,
  /^board$/,
  /^cad\/(incidents|calls|units)$/,
  /^explain$/,
  /^tomtom\/(traffic|flow-lines|status|search)$/,
  /^tomtom\/flow\/\d{1,2}\/\d+\/\d+\.png$/,
  /^basemap\/\d{1,2}\/\d+\/\d+\.png$/,
];
const DENY =
  /(^|\/)(admin|manager|review|account|members|evidence|uploads|push|ais)(\/|$)/i;

export function capeAllowed(p) {
  return (
    !DENY.test(p) && !p.includes('..') && CAPE_ALLOW.some((re) => re.test(p))
  );
}

function ttlFor(p) {
  if (/\.(png|jpg)$/.test(p)) return 60_000;
  if (/^(air|radio|cad|tomtom\/traffic|board)/.test(p)) return 10_000;
  return 30_000;
}

export function createCapeMiddleware({ baseUrl } = {}) {
  const base = String(
    baseUrl || process.env.CAPE_DISPATCH_URL || DEFAULT_CAPE_URL,
  ).replace(/\/+$/, '');
  const cache = new Map();
  const inflight = new Map();
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://local');
    const p = url.pathname.replace(/^\/+/, '');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!capeAllowed(p)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({ error: 'cape path not allowlisted', path: p }),
      );
    }
    const key = p + url.search;
    const now = Date.now();
    let hit = cache.get(key);
    if (!hit || hit.exp < now) {
      let job = inflight.get(key);
      if (!job) {
        job = (async () => {
          const ctl = AbortSignal.timeout(TIMEOUT_MS);
          const r = await fetch(`${base}/api/${p}${url.search}`, {
            signal: ctl,
            headers: {
              Accept: '*/*',
              'User-Agent': 'gods-eye-view-cape-proxy',
            },
          });
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > MAX_BYTES)
            throw new Error('cape response too large');
          const entry = {
            status: r.status,
            type: r.headers.get('content-type') || 'application/octet-stream',
            body: buf,
            exp: Date.now() + (r.ok ? ttlFor(p) : 5000),
            at: Date.now(),
          };
          cache.set(key, entry);
          if (cache.size > 500) cache.delete(cache.keys().next().value);
          return entry;
        })().finally(() => inflight.delete(key));
        inflight.set(key, job);
      }
      try {
        hit = await job;
      } catch (e) {
        if (hit) {
          res.setHeader('X-Cape-Stale', '1');
        } else {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({
              error: 'cape upstream unavailable',
              detail: String(e?.message || e),
            }),
          );
        }
      }
    }
    res.statusCode = hit.status;
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Cape-Age-Ms', String(Date.now() - hit.at));
    res.end(req.method === 'HEAD' ? undefined : hit.body);
  };
}

export function capeDispatchProxy() {
  let mw;
  const install = (server) => {
    server.middlewares.use('/api/cape', (req, res, next) =>
      (mw ||= createCapeMiddleware())(req, res, next),
    );
  };
  return {
    name: 'cape-dispatch-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
