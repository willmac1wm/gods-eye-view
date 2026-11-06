import { createPlaceHandler } from './place.js';
import { createHydrantsHandler } from './hydrants.js';
import { createTimelineHandlers } from './timeline.js';
import { createFloodZoneHandler } from './floodZone.js';
import { createHydrantPinpointHandler } from './pinpoint.js';
import { createWhalesHandler } from './whales.js';
import { createKmlParseHandler } from './kml.js';
import { createManagerHandlers } from './manager.js';
import { createManagerConfigHandlers } from './managerConfig.js';
import { createMessagesHandlers } from './messages.js';
import { createSocialHandler } from './social.js';
import { createAtcLiveHandlers } from './atcLive.js';
import { createAtcChartsHandler } from './atcCharts.js';
import { createFloodNativeHandlers } from './floodNative.js';
import { createOutagesNativeHandler } from './outagesNative.js';
import { createBoardNativeHandler } from './boardNative.js';

const OPS_HTML = [
  'index',
  'place',
  'hydrants',
  'timeline',
  'incidents',
  'scanners',
  'flood',
  'board',
  'social',
  'news',
  'aviation',
  'atc',
  'firewire',
  'cameras',
  'reconstruct',
  'scenes',
  'intel',
  'whales',
  'messages',
  'ai',
  'managers',
];

/**
 * Native Cape ops compile APIs — parcels, hydrants, Then & Now, flood zone,
 * whale zones, social feed, manager config, messages, auth-gated manager
 * proxy, KML parse. Pages live under /ops/*.
 */
export function opsCompileProxy(options = {}) {
  const placeHandler = createPlaceHandler(options);
  const hydrantsHandler = createHydrantsHandler(options);
  const pinpointHandler = createHydrantPinpointHandler(options);
  const { erasHandler, imageHandler } = createTimelineHandlers(options);
  const floodZoneHandler = createFloodZoneHandler(options);
  const whalesHandler = createWhalesHandler(options);
  const kmlHandler = createKmlParseHandler(options);
  const socialHandler = createSocialHandler(options);
  const { sessionHandler, proxyHandler } = createManagerHandlers(options);
  const configApi = createManagerConfigHandlers(options);
  const messagesApi = createMessagesHandlers({
    ...options,
    requireManagerForWrite: async () => {
      const cfg = await configApi.getConfig();
      return Boolean(cfg?.approvals?.requireManagerForMessages);
    },
  });
  const atcLive = createAtcLiveHandlers({
    ...options,
    getConfig: () => configApi.getConfig(),
  });
  const atcCharts = createAtcChartsHandler(options);
  const floodNative = createFloodNativeHandlers(options);
  const outagesNative = createOutagesNativeHandler(options);
  const boardNative = createBoardNativeHandler({
    ...options,
    getMessages: async () => {
      // Soft: board does not require messages file; empty is fine.
      return [];
    },
  });

  const install = (server) => {
    server.middlewares.use('/api/ops/place', (req, res) =>
      placeHandler(req, res),
    );
    server.middlewares.use('/api/ops/hydrants/pinpoint', (req, res) =>
      pinpointHandler(req, res),
    );
    server.middlewares.use('/api/ops/hydrants', (req, res) =>
      hydrantsHandler(req, res),
    );
    server.middlewares.use('/api/ops/timeline/eras', (req, res) =>
      erasHandler(req, res),
    );
    server.middlewares.use('/api/ops/timeline/image', (req, res) =>
      imageHandler(req, res),
    );
    server.middlewares.use('/api/ops/flood-zone', (req, res) =>
      floodZoneHandler(req, res),
    );
    server.middlewares.use('/api/ops/whales', (req, res) =>
      whalesHandler(req, res),
    );
    server.middlewares.use('/api/ops/intel/kml', (req, res) =>
      kmlHandler(req, res),
    );
    server.middlewares.use('/api/ops/social', (req, res) =>
      socialHandler(req, res),
    );
    server.middlewares.use('/api/ops/messages', (req, res) =>
      messagesApi.handler(req, res),
    );
    // ATC LiveATC Icecast proxy + transcript (old Cape program).
    server.middlewares.use('/api/ops/atc/stream', (req, res) =>
      atcLive.handleStream(req, res),
    );
    server.middlewares.use('/api/ops/atc/feeds', (req, res) =>
      atcLive.handleFeeds(req, res),
    );
    server.middlewares.use('/api/ops/atc/live', (req, res) =>
      atcLive.handleLive(req, res),
    );
    server.middlewares.use('/api/ops/atc/health', (req, res) =>
      atcLive.handleHealth(req, res),
    );
    server.middlewares.use('/api/ops/atc/ingest', (req, res) =>
      atcLive.handleIngest(req, res),
    );
    server.middlewares.use('/api/ops/atc/charts', (req, res) =>
      atcCharts(req, res),
    );
    // Native flood / outages / board (prefer over Fire Wire collectors).
    server.middlewares.use('/api/ops/flood/watch', (req, res) =>
      floodNative.watchHandler(req, res),
    );
    server.middlewares.use('/api/ops/flood/gauges', (req, res) =>
      floodNative.gaugesHandler(req, res),
    );
    server.middlewares.use('/api/ops/flood/plan', (req, res) =>
      floodNative.planHandler(req, res),
    );
    server.middlewares.use('/api/ops/flood', (req, res) =>
      floodNative.allHandler(req, res),
    );
    server.middlewares.use('/api/ops/outages', (req, res) =>
      outagesNative(req, res),
    );
    server.middlewares.use('/api/ops/board', (req, res) =>
      boardNative(req, res),
    );
    // Local GEV config — must mount before the Fire Wire manager proxy.
    server.middlewares.use('/api/ops/manager/config', (req, res) =>
      configApi.handler(req, res),
    );
    server.middlewares.use('/api/ops/manager/session', (req, res) =>
      sessionHandler(req, res),
    );
    server.middlewares.use('/api/ops/manager', (req, res) =>
      proxyHandler(req, res),
    );
  };

  return {
    name: 'ops-compile-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}

/** Soft paths so /ops/place serves ops/place.html in Vite MPA. */
export function opsPagesPlugin() {
  const rewrites = new Map([
    ['/ops', '/ops/index.html'],
    ['/ops/', '/ops/index.html'],
  ]);
  for (const id of OPS_HTML) {
    if (id === 'index') continue;
    rewrites.set(`/ops/${id}`, `/ops/${id}.html`);
    rewrites.set(`/ops/${id}/`, `/ops/${id}.html`);
  }

  const rewrite = (req, _res, next) => {
    const raw = req.url || '/';
    const q = raw.indexOf('?');
    const path = q === -1 ? raw : raw.slice(0, q);
    const search = q === -1 ? '' : raw.slice(q);
    const target = rewrites.get(path);
    if (target) req.url = target + search;
    next();
  };

  return {
    name: 'ops-pages',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export { OPS_HTML };
