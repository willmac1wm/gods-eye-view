import { createCoopsTidesSource } from '../layers/tides/index.js';
import { createApplicationTides } from '../app/layers/tides.js';
export * from '../layers/tides/index.js';
/** Wire the standalone source and application overlay owner. */
export function createTidesLayer({
  source = createCoopsTidesSource(),
  ...options
} = {}) {
  return createApplicationTides({ source, ...options });
}
