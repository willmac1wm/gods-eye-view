import { createPlaceHandler } from './place.js';
import { createHydrantsHandler } from './hydrants.js';
import { createTimelineHandlers } from './timeline.js';

/**
 * Native Cape ops compile APIs — parcels, hydrants, Then & Now imagery.
 * Mounted at /api/ops/* (not Fire Wire). Pages live under /ops/*.
 */
export function opsCompileProxy(options = {}) {
  const placeHandler = createPlaceHandler(options);
  const hydrantsHandler = createHydrantsHandler(options);
  const { erasHandler, imageHandler } = createTimelineHandlers(options);

  const install = (server) => {
    server.middlewares.use('/api/ops/place', (req, res) =>
      placeHandler(req, res),
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
    ['/ops/place', '/ops/place.html'],
    ['/ops/place/', '/ops/place.html'],
    ['/ops/hydrants', '/ops/hydrants.html'],
    ['/ops/hydrants/', '/ops/hydrants.html'],
    ['/ops/timeline', '/ops/timeline.html'],
    ['/ops/timeline/', '/ops/timeline.html'],
  ]);

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
