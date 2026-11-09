import { createSarFloodLayer } from '../../layers/sarFlood/index.js';
/** Radar flood over one explicitly supplied status source. */
export function createApplicationSarFlood(options) {
  return createSarFloodLayer(options);
}
