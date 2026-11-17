// Ports + chokepoints constants. Ports are slow-moving: the layer
// ships a hand-curated regional snapshot (portsSnapshot.json) built
// from NGA World Port Index particulars — public domain — because the
// bulk WPI download is unreachable today (theportindex.online/data
// 404s; msi.nga.mil returns HTTP 503, the same blocker as B4). No live
// poll, no upstream: the snapshot refreshes only when a maintainer
// re-verifies it by hand (see the snapshot's method note). Depths are
// carried only where a solid source gave a number; otherwise null with
// a depth class — never invented. Chokepoint pins come from Wikipedia
// infobox coordinates, verified at build time.
export const PORTS_LAYER_ID = 'ports';
export const PORTS_OVERLAY_SOURCE_ID = 'ports';
export const PORTS_ATTRIBUTION =
  'Ports: NGA World Port Index (public domain) · Chokepoints: Wikipedia';
export const PORTS_SNAPSHOT_VERSION = 1;
/** Mid-Atlantic window the regional snapshot covers. */
export const PORTS_WINDOW = Object.freeze({
  minLat: 36,
  maxLat: 42,
  minLon: -77,
  maxLon: -73,
});
/** Static snapshot — re-publish once a day at most; nothing upstream to poll. */
export const PORTS_REFRESH_MS = 86_400_000;
