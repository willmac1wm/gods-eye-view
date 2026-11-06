/**
 * Anonymized Place desk demo fixtures — no owner names, no real case ids.
 * Opt-in only via `?demo=1` or Managers `sources.place.demoFixtures`.
 */

export const PERMITS_DEMO_CASES = Object.freeze([
  Object.freeze({
    id: 'demo-permit-1',
    title: 'Building permit (demo)',
    type: 'permit',
    status: 'issued',
    address: '100 block · Demo St (Cape May)',
    opened_at: '2026-01-12',
    source: 'demo-fixture',
  }),
  Object.freeze({
    id: 'demo-code-1',
    title: 'Property maintenance (demo)',
    type: 'code_enforcement',
    status: 'open',
    address: '200 block · Demo Ave (Wildwood)',
    opened_at: '2026-02-03',
    source: 'demo-fixture',
  }),
  Object.freeze({
    id: 'demo-permit-2',
    title: 'Zoning review (demo)',
    type: 'permit',
    status: 'under review',
    address: '300 block · Demo Blvd (Lower Twp)',
    opened_at: '2026-03-18',
    source: 'demo-fixture',
  }),
]);

export function wantsPlaceDemo(search = globalThis.location?.search || '') {
  try {
    const params = new URLSearchParams(search);
    return params.get('demo') === '1' || params.get('demo') === 'true';
  } catch {
    return false;
  }
}
