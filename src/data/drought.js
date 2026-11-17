import { createDroughtSource } from '../layers/drought/index.js';
import { createApplicationDrought } from '../app/layers/drought.js';
export * from '../layers/drought/index.js';
/** Wire the standalone source and application overlay owner. */
export function createDroughtLayer({
  source = createDroughtSource(),
  ...options
} = {}) {
  return createApplicationDrought({ source, ...options });
}
