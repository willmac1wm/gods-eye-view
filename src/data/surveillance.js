import { createSurveillanceSource } from '../layers/surveillance/index.js';
import { createApplicationSurveillance } from '../app/layers/surveillance.js';
export * from '../layers/surveillance/index.js';
/** Wire the standalone source and application overlay owner. */
export function createSurveillanceLayer({
  source = createSurveillanceSource(),
  ...options
} = {}) {
  return createApplicationSurveillance({ source, ...options });
}
