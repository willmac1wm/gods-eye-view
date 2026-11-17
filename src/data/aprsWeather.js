import { createAprsWeatherSource } from '../layers/aprs/index.js';
import { createApplicationAprs } from '../app/layers/aprs.js';
import { createSourceSlot } from '../sources/sourceSlot.js';
export * from '../layers/aprs/index.js';

const sourceSlot = createSourceSlot(
  createAprsWeatherSource(),
  ['getSnapshot'],
  'APRS weather source',
);
export const configureAprsSource = sourceSlot.configure;

/** Wire the standalone source and application overlay owner. */
export function createAprsWeatherLayer({
  source = createAprsWeatherSource(),
  ...options
} = {}) {
  return createApplicationAprs({ source, ...options });
}
