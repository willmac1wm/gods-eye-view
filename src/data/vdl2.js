import { createVdl2Source } from '../layers/vdl2/index.js';
import { createApplicationVdl2 } from '../app/layers/vdl2.js';
import { createSourceSlot } from '../sources/sourceSlot.js';
export * from '../layers/vdl2/index.js';

const sourceSlot = createSourceSlot(
  createVdl2Source(),
  ['getSnapshot'],
  'VDL2 source',
);
export const configureVdl2Source = sourceSlot.configure;

/** Wire the standalone source and application layer. */
export function createVdl2Layer({
  source = createVdl2Source(),
  ...options
} = {}) {
  return createApplicationVdl2({ source, ...options });
}
