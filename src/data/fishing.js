import { createFishingSource } from '../layers/fishing/index.js';
import { createApplicationFishing } from '../app/layers/fishing.js';
export * from '../layers/fishing/index.js';
/** Wire the presence source (derived from the AIS vessels layer) and overlay owner. */
export function createFishingLayer({
  vessels,
  source = createFishingSource({ vessels }),
  ...options
} = {}) {
  return createApplicationFishing({ source, ...options });
}
