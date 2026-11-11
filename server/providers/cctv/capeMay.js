/**
 * Cape May County camera packs (ported from the Cape Dispatch app).
 *
 *  - drba-ferry: Cape May–Lewes Ferry terminal cameras operated by the
 *    Delaware River and Bay Authority. Live HLS on DRBA's Wowza host, with a
 *    JW Player thumbnail as the still. Positions and headings are the ones
 *    Cape Dispatch shipped; each stream was checked live on 2026-11-09 (the
 *    "Lewes Green" stream 404'd and is left out).
 *  - windy: shore, beach and road webcams near Cape May County from the
 *    Windy Webcams API v3. Needs WINDY_API_KEY. Free-tier image URLs carry
 *    short-lived tokens, so keep CCTV_SOURCE_CACHE_MS under ~10 minutes.
 */

const DRBA_STREAM_HOST = 'https://5b18e54927a82.streamlock.net';
const DRBA_THUMB_HOST = 'https://cdn.jwplayer.com';

// [id, title, lat, lon, heading, fov, stream name, JW media id, city]
const DRBA_CAMERAS = [
  ['cm-green', 'Cape May Ferry: Bay & Dock', 38.96855, -74.96095, 285, 65, 'CapeMayGreenNEW', 'uPdLa13e', 'North Cape May'],
  ['cm-staging', 'Cape May Ferry: Staging Lanes', 38.96895, -74.95985, 290, 60, 'CapeMayParkingLot', 'H4KLcV4j', 'North Cape May'],
  ['cm-parking', 'Cape May Ferry: Parking Lot', 38.96795, -74.9589, 200, 70, 'CapeMayParkingLot-2', '6db7TFVf', 'North Cape May'],
  ['cm-toll', 'Cape May Ferry: Toll Booth', 38.96865, -74.95745, 95, 55, 'CapeMayTollBooth', 'QugvJVYD', 'North Cape May'],
  ['lewes-bulkhead', 'Lewes Ferry: Bulkhead & Osprey', 38.78295, -75.11955, 25, 65, 'LewesOsprey', 'ubwk93C3', 'Lewes, DE'],
  ['lewes-staging', 'Lewes Ferry: Staging Lanes', 38.78215, -75.12015, 355, 60, 'LewesParkingLot', 'FsOGfNId', 'Lewes, DE'],
  ['lewes-toll', 'Lewes Ferry: Toll Booth', 38.78125, -75.12085, 205, 55, 'LewesTollBooth', 'XogzbMib', 'Lewes, DE'],
  ['lewes-freeman', 'Lewes Ferry: Freeman Highway', 38.77665, -75.12685, 45, 60, 'FreemanHighway', 'hN4hXxOq', 'Lewes, DE'],
  ['lewes-waterfront', 'Lewes Ferry: Waterfront', 38.78315, -75.11895, 10, 65, 'OTRLewes', '7964lNnn', 'Lewes, DE'],
];

export function loadDrbaFerrySources() {
  const cameras = DRBA_CAMERAS.map(
    ([id, name, lat, lon, heading, fov, stream, media, city]) => ({
      id: `drba-${id}`,
      name,
      city,
      cityId: city.startsWith('Lewes') ? 'drba-lewes' : 'drba-cape-may',
      provider: 'Cape May–Lewes Ferry (DRBA)',
      lat,
      lon,
      headingDeg: heading,
      headingConfidence: 'high',
      pitchDeg: -12,
      fovDeg: fov,
      rangeM: 180,
      mountHeightM: 8,
      groundElevationM: 3,
      feedType: 'hls',
      url: `${DRBA_STREAM_HOST}/live/${stream}.stream/playlist.m3u8`,
      snapshotUrl: `${DRBA_THUMB_HOST}/thumbs/${media}-720.jpg`,
      sourceKind: 'drba-ferry',
      license: 'Public DRBA ferry webcam',
    }),
  );
  console.log(`[CCTV] Loaded DRBA ferry cameras: ${cameras.length}`);
  return cameras;
}

const WINDY_API_URL = 'https://api.windy.com/webcams/api/v3/webcams';
const COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

function headingFromTitle(title) {
  const t = ` ${String(title || '').toUpperCase()} `;
  for (const [token, deg] of [
    [' NB ', 0],
    [' EB ', 90],
    [' SB ', 180],
    [' WB ', 270],
  ]) {
    if (t.includes(token)) return deg;
  }
  const m = /(NORTH|SOUTH)?-?(EAST|WEST)?$/.exec(t.split('>').pop()?.trim() || '');
  if (m && (m[1] || m[2])) {
    const key = `${(m[1] || '')[0] || ''}${(m[2] || '')[0] || ''}`;
    if (key in COMPASS) return COMPASS[key];
  }
  return null;
}

function stableHeading(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export async function loadWindyNearbySources({ fetchImpl = fetch } = {}) {
  const key = String(process.env.WINDY_API_KEY || '').trim();
  if (!key) return [];
  const nearby = String(
    process.env.CCTV_WINDY_NEARBY || '39.08,-74.87,60',
  ).trim();
  const url = new URL(WINDY_API_URL);
  url.searchParams.set('nearby', nearby);
  url.searchParams.set('include', 'location,images,categories');
  url.searchParams.set('limit', '50');
  try {
    const resp = await fetchImpl(url, {
      headers: { 'x-windy-api-key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!resp.ok) {
      console.warn('[CCTV] Windy webcams download failed:', resp.status);
      return [];
    }
    const payload = await resp.json();
    const cameras = [];
    for (const cam of payload?.webcams || []) {
      if (String(cam?.status || 'active') !== 'active') continue;
      const lat = Number(cam?.location?.latitude);
      const lon = Number(cam?.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const image = cam?.images?.current?.preview || cam?.images?.current?.thumbnail;
      let imageUrl;
      try {
        imageUrl = new URL(String(image || ''));
      } catch {
        continue;
      }
      if (imageUrl.protocol !== 'https:' || !imageUrl.hostname.endsWith('windy.com'))
        continue;
      const id = String(cam?.webcamId || cam?.id || '').trim();
      if (!/^\d{1,20}$/.test(id)) continue;
      const title = String(cam?.title || 'Webcam').trim();
      const cats = (cam?.categories || []).map((c) => String(c?.id || ''));
      const heading = headingFromTitle(title);
      cameras.push({
        id: `windy-${id}`,
        name: title,
        city: String(cam?.location?.city || 'Cape May County'),
        cityId: 'windy-cape-may',
        provider: 'Windy.com webcams',
        lat,
        lon,
        headingDeg: heading ?? stableHeading(id),
        headingConfidence: heading == null ? 'low' : 'estimated',
        pitchDeg: cats.includes('traffic') ? -20 : -8,
        fovDeg: cats.includes('traffic') ? 50 : 70,
        rangeM: cats.includes('traffic') ? 160 : 400,
        mountHeightM: cats.includes('traffic') ? 9 : 12,
        groundElevationM: 3,
        feedType: 'image',
        url: imageUrl.href,
        snapshotUrl: imageUrl.href,
        sourceUrl: `https://www.windy.com/webcams/${id}`,
        sourceKind: 'windy-webcams',
        license: 'Webcams provided by windy.com',
      });
    }
    console.log(`[CCTV] Loaded Windy webcams near Cape May: ${cameras.length}`);
    return cameras;
  } catch (error) {
    console.warn('[CCTV] Windy webcams error:', error?.message || error);
    return [];
  }
}
