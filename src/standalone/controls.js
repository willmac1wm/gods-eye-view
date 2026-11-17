import { createApplicationControls } from '../app/controls.js';
import { installCapeDispatchOverlay } from '../layers/capeDispatch/index.js';
import { getStandaloneCatalog } from './catalog.js';
export function createStandaloneControls(options) {
  const controls = createApplicationControls({
    catalog: options?.catalog ?? getStandaloneCatalog(),
    ...options,
  });
  const viewer = options?.scene?.viewer;
  if (viewer?.dataSources && globalThis.document?.body) {
    try {
      const stop = installCapeDispatchOverlay(viewer);
      options?.defer?.(() => stop?.());
    } catch (error) {
      console.warn('Cape Dispatch overlay unavailable:', error);
    }
  }
  return controls;
}
