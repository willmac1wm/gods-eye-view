/** The one service worker this app registers: watched-place push alerts. */
export const PUSH_WORKER_PATH = '/push-sw.js';

const scriptOf = (registration) =>
  registration?.active?.scriptURL ||
  registration?.waiting?.scriptURL ||
  registration?.installing?.scriptURL ||
  '';

const isPushWorker = (registration) => {
  try {
    return (
      new URL(scriptOf(registration), 'http://x').pathname === PUSH_WORKER_PATH
    );
  } catch {
    return false;
  }
};

/**
 * Drop service workers left by the previous app on this origin. The push
 * alert worker is kept: unregistering it would silently end a member's
 * alerts on every page load.
 */
export function retireLegacyServiceWorkers(nav = globalThis.navigator) {
  if (!nav?.serviceWorker?.getRegistrations) return Promise.resolve();
  return nav.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations
          .filter((registration) => !isPushWorker(registration))
          .map((registration) => registration.unregister()),
      ),
    )
    .then(() => {})
    .catch(() => {});
}
