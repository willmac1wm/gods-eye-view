/**
 * In-app Fire Wire quiet store — healthy empty payloads when no separate
 * FIREWIRE_URL upstream is configured. CAD/radio stay quiet until real
 * in-app SDR ingest; never invent sample data.
 */

/** @param {string} path allowlisted cape path without leading slash */
export function quietCapePayload(path) {
  const p = String(path || '').replace(/^\/+/, '');

  if (p === 'health/sources') {
    return {
      mode: 'inapp',
      quiet: true,
      radio: { state: 'quiet', detail: 'waiting on SDR' },
      cad: { state: 'quiet', detail: 'waiting on ingest' },
      board: { state: 'quiet' },
      cameras: { state: 'quiet', detail: 'ferry seed / native packs' },
    };
  }

  if (p === 'radio/feeds') return { feeds: [], quiet: true, mode: 'inapp' };
  if (p.startsWith('radio/')) {
    return {
      feed_id: null,
      chunk: null,
      quiet: true,
      mode: 'inapp',
      detail: 'waiting on SDR',
    };
  }

  if (p === 'cad/incidents')
    return { incidents: [], quiet: true, mode: 'inapp' };
  if (p === 'cad/calls') return { calls: [], quiet: true, mode: 'inapp' };
  if (p === 'cad/units') return { units: [], quiet: true, mode: 'inapp' };

  if (p === 'board' || p === 'wire') {
    return { items: [], posts: [], quiet: true, mode: 'inapp' };
  }
  if (p === 'news' || p.startsWith('news/')) {
    return { items: [], posts: [], quiet: true, mode: 'inapp' };
  }
  if (p === 'social' || p.startsWith('social/')) {
    return { items: [], posts: [], quiet: true, mode: 'inapp' };
  }

  if (p === 'place' || p === 'permits' || p === 'code_enforcement') {
    return { items: [], cases: [], quiet: true, mode: 'inapp' };
  }

  if (p === 'traffic_cameras' || p === 'webcams' || p === 'fx/cameras') {
    return { cameras: [], webcams: [], quiet: true, mode: 'inapp' };
  }
  if (p === 'intel/nj511_cameras') {
    return { cameras: [], quiet: true, mode: 'inapp' };
  }

  if (
    p === 'floodwatch' ||
    p === 'flood_card' ||
    p.startsWith('flood_gauges')
  ) {
    return { quiet: true, mode: 'inapp', gauges: [], sources: [] };
  }
  if (
    p.startsWith('flood_map/') ||
    p.startsWith('flood3d/') ||
    p.startsWith('sar/')
  ) {
    return { quiet: true, mode: 'inapp' };
  }

  if (p === 'power_outages') return { outages: [], quiet: true, mode: 'inapp' };
  if (
    p === 'hazards' ||
    p === 'feeds' ||
    p === 'storms' ||
    p === 'storm_status'
  ) {
    return { items: [], alerts: [], quiet: true, mode: 'inapp' };
  }
  if (p === 'buoys' || p === 'county-status' || p === 'county_status') {
    return { items: [], quiet: true, mode: 'inapp' };
  }
  if (p === 'airport_wx' || p === 'aviation/tfrs' || p.startsWith('air')) {
    return { airports: [], tfrs: [], quiet: true, mode: 'inapp' };
  }
  if (p === 'wx/status' || p === 'wx/wind') {
    return { quiet: true, mode: 'inapp' };
  }
  if (
    p.startsWith('tomtom/') ||
    p.startsWith('basemap/') ||
    p.startsWith('tools/')
  ) {
    return { quiet: true, mode: 'inapp' };
  }
  if (p === 'explain') {
    return {
      quiet: true,
      mode: 'inapp',
      detail: 'in-app Fire Wire quiet store',
    };
  }

  // audio / fw-audio / image tiles — no bytes in quiet mode
  if (
    p.startsWith('audio/') ||
    p.startsWith('fw-audio/') ||
    p.startsWith('fx/cam/') ||
    /\.(png|jpg|mp3|wav|ogg|m4a)$/i.test(p)
  ) {
    return null;
  }

  return { quiet: true, mode: 'inapp', path: p };
}

/** In-app stubs for former Fire Wire /api/manager/* review tools. */
export function quietManagerPayload(path) {
  const p = String(path || '').replace(/^\/+/, '');
  return {
    ok: true,
    mode: 'inapp',
    quiet: true,
    tool: p,
    detail:
      'Managers runs in-app. External Fire Wire review queue is not configured — no separate host.',
    items: [],
    queue: [],
    members: [],
  };
}
