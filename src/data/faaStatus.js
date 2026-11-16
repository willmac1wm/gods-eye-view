import { createFaaNasSource } from '../layers/faaStatus/index.js';
import { createApplicationFaaStatus } from '../app/layers/faaStatus.js';
export * from '../layers/faaStatus/index.js';
/** Wire the standalone source and application overlay owner. */
export function createFaaStatusLayer({
  source = createFaaNasSource(),
  ...options
} = {}) {
  return createApplicationFaaStatus({ source, ...options });
}
