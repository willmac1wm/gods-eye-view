/**
 * Shared live-desk bootstrap: health strip + manager poll interval +
 * viewability gate.
 */
import { applyDeskViewability, fetchOpsConfig, intervalFor } from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';

/**
 * @param {string} deskId
 * @param {(ctx: { config: object, health: ReturnType<typeof createPageHealth> }) => Promise<void>|void} load
 * @param {{ defaultMs?: number, statusEl?: Element|null }} [opts]
 */
export async function startLiveDesk(
  deskId,
  load,
  { defaultMs = 60_000, statusEl = null } = {},
) {
  const health = createPageHealth(ensureHealthHost(), {
    desk: deskId,
    pollMs: defaultMs,
  });
  const config = await fetchOpsConfig();
  if (!applyDeskViewability(config, deskId, statusEl)) {
    return {
      config,
      health,
      gated: true,
      stop() {
        health.destroy();
      },
    };
  }
  const ms = intervalFor(config, deskId, defaultMs);
  health.setPollMs(ms);

  const run = () =>
    health
      .probe(async () => {
        const meta = await load({ config, health });
        return meta && typeof meta === 'object' ? meta : { source: deskId };
      })
      .catch(() => {});

  await run();
  const timer = setInterval(run, ms);
  return {
    config,
    health,
    gated: false,
    stop() {
      clearInterval(timer);
      health.destroy();
    },
  };
}
