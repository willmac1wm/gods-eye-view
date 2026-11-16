import { createGpsjamSource } from '../layers/gpsjam/index.js';
import { createApplicationGpsjam } from '../app/layers/gpsjam.js';
import { createSourceSlot } from '../sources/sourceSlot.js';
export * from '../layers/gpsjam/index.js';

const sourceSlot = createSourceSlot(
  createGpsjamSource(),
  ['getSnapshot'],
  'GPSJam source',
);
export const configureGpsjamSource = sourceSlot.configure;

/** Wire the standalone source and application layer. */
export function createGpsjamLayer({
  source = createGpsjamSource(),
  ...options
} = {}) {
  return createApplicationGpsjam({ source, ...options });
}
