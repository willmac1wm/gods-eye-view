/** Drop service workers left by the previous app on this origin. */
export function retireLegacyServiceWorkers(nav = globalThis.navigator) {
  if (!nav?.serviceWorker?.getRegistrations) return Promise.resolve();
  return nav.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .then(() => {})
    .catch(() => {});
}
