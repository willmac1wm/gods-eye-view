// Same-origin NOAA Aviation Weather Center SIGMET proxy.
// aviationweather.gov does not send CORS headers, so the browser layer
// fetches /api/aviation/isigmet and this plugin is the only upstream hop.
const SIGMET_UPSTREAM_URL =
  'https://aviationweather.gov/api/data/isigmet?format=geojson';
const TIMEOUT_MS = 15000;

export function sigmetProxy() {
  const install = (server) => {
    server.middlewares.use('/api/aviation/isigmet', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end();
        return;
      }
      try {
        const upstream = await fetch(SIGMET_UPSTREAM_URL, {
          headers: {
            Accept: 'application/geo+json, application/json',
            'User-Agent': 'gods-eye-view-sigmet-proxy',
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        res.statusCode = upstream.status;
        res.setHeader(
          'Content-Type',
          upstream.headers.get('content-type') || 'application/geo+json',
        );
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'sigmet upstream unavailable' }));
      }
    });
  };
  return {
    name: 'sigmet-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
