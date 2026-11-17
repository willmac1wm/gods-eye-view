import { createSanctionsSource } from '../layers/sanctionsWatch/index.js';
import { createApplicationSanctionsWatch } from '../app/layers/sanctionsWatch.js';
export * from '../layers/sanctionsWatch/index.js';
/** Wire the standalone source and application overlay owner. */
export function createSanctionsWatchLayer({
  source = createSanctionsSource(),
  ...options
} = {}) {
  return createApplicationSanctionsWatch({ source, ...options });
}
