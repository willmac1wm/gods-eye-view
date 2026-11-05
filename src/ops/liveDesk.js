/**
 * Shared live-desk bootstrap: health strip + manager poll interval.
 */
import { fetchOpsConfig, intervalFor } from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';

/**
 * @param {string} deskId
 * @param {(ctx: { config: object, health: ReturnType<typeof createPageHealth> }) => Promise<void>|void} load
 * @param {{ defaultMs?: number }} [opts]
 */
export async function startLiveDesk(deskId, load, { defaultMs = 60_000 } = {}) {
  const health = createPageHealth(ensureHealthHost(), {
    desk: deskId,
    pollMs: defaultMs,
  });
  const config = await fetchOpsConfig();
  const ms = intervalFor(config, deskId, defaultMs);
  health.setPollMs(ms);

  const run = () =>
    health.probe(async () => {
      const meta = await load({ config, health });
      return meta && typeof meta === 'object' ? meta : { source: deskId };
    }).catch(() => {});

  await run();
  const timer = setInterval(run, ms);
  return {
    config,
    health,
    stop() {
      clearInterval(timer);
      health.destroy();
    },
  };
}
