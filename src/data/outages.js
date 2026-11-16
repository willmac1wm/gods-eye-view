import { createMassOutageSource } from '../layers/outages/index.js';
import { createApplicationOutages } from '../app/layers/outages.js';
export * from '../layers/outages/index.js';
/** Wire the standalone source and application overlay owner. */
export function createOutagesLayer({
  source = createMassOutageSource(),
  ...options
} = {}) {
  return createApplicationOutages({ source, ...options });
}
