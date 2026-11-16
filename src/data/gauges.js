import { createUsgsGaugesSource } from '../layers/gauges/index.js';
import { createApplicationGauges } from '../app/layers/gauges.js';
export * from '../layers/gauges/index.js';
/** Wire the standalone source and application overlay owner. */
export function createGaugesLayer({
  source = createUsgsGaugesSource(),
  ...options
} = {}) {
  return createApplicationGauges({ source, ...options });
}
