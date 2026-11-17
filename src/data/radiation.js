import { createRadiationSource } from '../layers/radiation/index.js';
import { createApplicationRadiation } from '../app/layers/radiation.js';
export * from '../layers/radiation/index.js';
/** Wire the standalone source and application overlay owner. */
export function createRadiationLayer({
  source = createRadiationSource(),
  ...options
} = {}) {
  return createApplicationRadiation({ source, ...options });
}
