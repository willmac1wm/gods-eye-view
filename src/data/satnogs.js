import { createSatnogsSource } from '../layers/satnogs/index.js';
import { createApplicationSatnogs } from '../app/layers/satnogs.js';
import { createSourceSlot } from '../sources/sourceSlot.js';
export * from '../layers/satnogs/index.js';

const sourceSlot = createSourceSlot(
  createSatnogsSource(),
  ['getSnapshot'],
  'SatNOGS source',
);
export const configureSatnogsSource = sourceSlot.configure;

/** Wire the standalone source and application overlay owner. */
export function createSatnogsLayer({
  source = createSatnogsSource(),
  ...options
} = {}) {
  return createApplicationSatnogs({ source, ...options });
}
