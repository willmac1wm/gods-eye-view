import { createMarineWarningsSource } from '../layers/marineWarnings/index.js';
import { createApplicationMarineWarnings } from '../app/layers/marineWarnings.js';
import { createSourceSlot } from '../sources/sourceSlot.js';
export * from '../layers/marineWarnings/index.js';

const sourceSlot = createSourceSlot(
  createMarineWarningsSource(),
  ['getSnapshot'],
  'Marine warnings source',
);
export const configureMarineWarningsSource = sourceSlot.configure;

/** Wire the standalone source and application overlay owner. */
export function createMarineWarningsLayer({
  source = createMarineWarningsSource(),
  ...options
} = {}) {
  return createApplicationMarineWarnings({ source, ...options });
}
