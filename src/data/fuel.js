import { createEiaFuelSource } from '../layers/fuel/index.js';
import { createApplicationFuel } from '../app/layers/fuel.js';
export * from '../layers/fuel/index.js';
/** Wire the standalone source and application overlay owner. */
export function createFuelLayer({
  source = createEiaFuelSource(),
  ...options
} = {}) {
  return createApplicationFuel({ source, ...options });
}
