// Pure Cape May Dispatch record mapping. Geometry stays inside the
// mid-Atlantic box (NJ, DE, Cape May, PA, NY). No Cesium, no network.

import { CAPE_BBOX } from '../../region/mode.js';
import { capeFeed, eachCapeCamera, eachCapeWebcam } from './cctvFeed.js';

/** Same window as GEV_REGION=cape. NJ, DE, Cape May, full PA, full NY. */
export const CAPE_REGION = CAPE_BBOX;

/** County centroids: the outage feed is counts, not polygons. */
export const COUNTY_CENTROIDS = Object.freeze({
  'Cape May': [-74.82, 39.08],
  Atlantic: [-74.63, 39.47],
  Cumberland: [-75.13, 39.33],
});

export const CAPE_HOME = Object.freeze({
  lon: -74.91,
  lat: 38.935,
  height: 12000,
});

export const CAPE_STALE_S = 900;

/**
 * Whether `/api/cape/health/sources` considers `key` usable.
 * Missing health map or unknown key fails open so feeds still work if the
 * health endpoint is absent.
 */
export function isCapeSourceFresh(healthMap, key, maxAgeS = CAPE_STALE_S) {
  if (!healthMap || typeof healthMap !== 'object' || !key) return true;
  const source = healthMap[key];
  if (!source) return true;
  if (source.state === 'down') return false;
  if (source.age_s != null && Number(source.age_s) >= maxAgeS) return false;
  return true;
}

const text = (value) => {
  const raw = String(value ?? '').trim();
  return raw || '';
};

export function inCapeRegion(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= CAPE_REGION.west &&
    lon <= CAPE_REGION.east &&
    lat >= CAPE_REGION.south &&
    lat <= CAPE_REGION.north
  );
}

/** `{lon, lat}` inside the region, or null. */
export function lonLat(record) {
  const lat = Number(record?.lat ?? record?.latitude);
  const lon = Number(record?.lng ?? record?.lon ?? record?.longitude);
  if (!inCapeRegion(lon, lat)) return null;
  return { lon, lat };
}

export function gaugeAccent(category) {
  const cat = String(category || '');
  if (!cat || cat === 'no_flooding' || cat === 'none') return '#00bfff';
  if (/action|minor/i.test(cat)) return '#ffff00';
  if (/moderate/i.test(cat)) return '#ffa500';
  return '#ff0000';
}

/** GeoJSON Polygon / MultiPolygon outer rings as `[lon, lat][]`. */
export function outerRings(geometry) {
  if (!geometry || typeof geometry !== 'object') return [];
  const coords = geometry.coordinates;
  const ring = (raw) =>
    Array.isArray(raw)
      ? raw
          .map((coord) => {
            if (!Array.isArray(coord) || coord.length < 2) return null;
            const lon = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
            return [lon, lat];
          })
          .filter(Boolean)
      : [];
  if (geometry.type === 'Polygon' && Array.isArray(coords))
    return [ring(coords[0])].filter((part) => part.length >= 3);
  if (geometry.type === 'MultiPolygon' && Array.isArray(coords)) {
    return coords
      .map((polygon) => ring(polygon?.[0]))
      .filter((part) => part.length >= 3);
  }
  return [];
}

export function ringCentroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let lon = 0;
  let lat = 0;
  for (const coord of ring) {
    lon += coord[0];
    lat += coord[1];
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

function ringInRegion(ring) {
  return ring.some(([lon, lat]) => inCapeRegion(lon, lat));
}

function safeHttpUrl(raw) {
  const value = text(raw);
  if (!value) return '';
  if (value.startsWith('/api/cape/')) return value;
  if (value.startsWith('/api/')) return value.replace(/^\/api\//, '/api/cape/');
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

function pointRecord(id, title, details, accent, position, extra = {}) {
  return {
    id,
    title,
    details: details.filter(Boolean),
    accent,
    lon: position.lon,
    lat: position.lat,
    height: extra.height ?? 30,
    kind: extra.kind || 'point',
    pixelSize: extra.pixelSize ?? 8,
    positions: extra.positions,
    radiusM: extra.radiusM,
    alpha: extra.alpha,
    imageUrl: extra.imageUrl || '',
    linkUrl: extra.linkUrl || '',
    linkLabel: extra.linkLabel || '',
    cctvId: extra.cctvId || '',
  };
}

export function mapFloodGauges(payload) {
  const records = [];
  for (const [index, gauge] of (payload?.gauges || []).entries()) {
    const position = lonLat(gauge);
    if (!position) continue;
    const observed = gauge.observed || {};
    const linkUrl = safeHttpUrl(gauge.link);
    records.push(
      pointRecord(
        `gauge:${gauge.id || index}`,
        text(gauge.name) || 'Flood gauge',
        [
          text(observed.category) || 'no flooding',
          observed.value != null
            ? `${observed.value} ${text(observed.unit)}`.trim()
            : '',
          text(observed.time),
          gauge.forecast?.value != null
            ? `Forecast ${gauge.forecast.value} @ ${text(gauge.forecast.time)}`
            : '',
          text(gauge.datum),
          text(gauge.link),
        ],
        gaugeAccent(observed.category),
        position,
        {
          pixelSize: 9,
          linkUrl,
          linkLabel: linkUrl ? 'Open NWS gauge' : '',
        },
      ),
    );
  }
  return records;
}

function cameraRecord(item) {
  const feed = capeFeed(item.camera);
  return pointRecord(
    item.id,
    text(item.camera.name || item.camera.title) || item.label,
    [
      item.label,
      text(item.camera.source || item.camera.agency),
      text(item.camera.road || item.camera.corridor || item.camera.city),
      feed.hasFeed ? '' : 'No public feed',
    ],
    item.accent,
    { lon: item.lon, lat: item.lat },
    {
      pixelSize: 7,
      height: 20,
      cctvId: item.id,
    },
  );
}

/** Traffic cameras, 511NJ, and Cape fx cameras. Later lists fill gaps only. */
export function mapCameras(payloads = {}) {
  const records = [];
  eachCapeCamera(payloads, (item) => {
    const record = cameraRecord(item);
    if (record) records.push(record);
  });
  return records;
}

export function mapWebcams(payload = {}) {
  const records = [];
  eachCapeWebcam(payload, (item) => {
    const record = cameraRecord(item);
    if (record) records.push(record);
  });
  return records;
}

export function mapNws(hazards, feeds) {
  const records = [];
  (hazards?.nws_alerts || []).forEach((alert, index) => {
    const title = text(alert.event) || 'NWS alert';
    outerRings(alert.geometry).forEach((ring, ringIndex) => {
      if (!ringInRegion(ring)) return;
      const center = ringCentroid(ring);
      if (!center || !inCapeRegion(center.lon, center.lat)) {
        const inside = ring.find(([lon, lat]) => inCapeRegion(lon, lat));
        if (!inside) return;
      }
      const anchor =
        center && inCapeRegion(center.lon, center.lat)
          ? center
          : {
              lon: ring.find(([lon, lat]) => inCapeRegion(lon, lat))[0],
              lat: ring.find(([lon, lat]) => inCapeRegion(lon, lat))[1],
            };
      records.push(
        pointRecord(
          `alert:${alert.id || index}:${ringIndex}`,
          title,
          [text(alert.headline || alert.area)],
          '#ff4500',
          anchor,
          { kind: 'polygon', positions: ring, alpha: 0.25, height: 0 },
        ),
      );
    });
  });
  for (const key of ['nws', 'waze', 'usgs', 'nj511']) {
    (feeds?.[key] || []).forEach((item, index) => {
      const position = lonLat(item);
      if (!position) return;
      records.push(
        pointRecord(
          `feed:${key}:${item.id || index}`,
          `${text(item.source_label) || key}: ${text(item.title || item.type)}`,
          [text(item.description), text(item.time_ago || item.pub_date)],
          '#ffb6c1',
          position,
        ),
      );
    });
  }
  return records;
}

export function mapOutages(payload) {
  const records = [];
  for (const [county, stats] of Object.entries(payload?.counties || {})) {
    const centroid = COUNTY_CENTROIDS[county];
    if (!centroid || !stats?.out) continue;
    const [lon, lat] = centroid;
    const served = Number(stats.served) || 0;
    const out = Number(stats.out) || 0;
    const pct = served ? out / served : 0;
    const towns = (payload.towns || [])
      .filter((town) => town.county === county)
      .slice(0, 8)
      .map((town) => `${text(town.town)}: ${town.out}`);
    records.push(
      pointRecord(
        `outage:${county}`,
        `${county}: ${out} out`,
        [
          served ? `${out} of ${served} customers` : `${out} customers`,
          text(stats.etr) ? `ETR ${text(stats.etr)}` : '',
          ...towns,
        ],
        pct > 0.05 ? '#ff0000' : '#ffff00',
        { lon, lat },
        {
          kind: 'ellipse',
          radiusM: 4000 + Math.min(16000, pct * 400000),
          alpha: 0.22,
          height: 0,
        },
      ),
    );
  }
  return records;
}

function cadPoint(prefix, item, index, accent, title, details, size) {
  const position = lonLat(item);
  if (!position) return null;
  return pointRecord(
    `${prefix}:${item.id || index}`,
    title,
    details,
    accent,
    position,
    {
      pixelSize: size,
      height: 25,
    },
  );
}

export function mapCad({ incidents, units, calls } = {}) {
  const records = [];
  const seen = new Set();
  const push = (record) => {
    if (!record) return;
    const key = `${record.lat.toFixed(4)},${record.lon.toFixed(4)},${record.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push(record);
  };
  (incidents?.incidents || []).forEach((item, index) => {
    push(
      cadPoint(
        'incident',
        item,
        index,
        '#ff1493',
        `CAD ${text(item.type || item.nature || item.id)} ${text(item.location || item.address)}`.trim(),
        [
          text(item.status),
          text(item.priority),
          text(item.timestamp || item.time),
        ],
        11,
      ),
    );
  });
  (calls?.calls || []).forEach((item, index) => {
    const high = /high|emerg|^1$/i.test(String(item.priority ?? ''));
    push(
      cadPoint(
        'call',
        item,
        index,
        high ? '#ff00ff' : '#ee82ee',
        `CAD ${text(item.type) || 'call'} ${text(item.location)}`.trim(),
        [
          text(item.priority) ? `Priority ${text(item.priority)}` : '',
          text(item.status),
          [text(item.location), text(item.municipality)]
            .filter(Boolean)
            .join(', '),
          text(item.timestamp),
          Array.isArray(item.units) && item.units.length
            ? `Units ${item.units.join(', ')}`
            : '',
          text(item.summary || item.description),
        ],
        11,
      ),
    );
  });
  (units?.units || []).forEach((item, index) => {
    push(
      cadPoint(
        'unit',
        item,
        index,
        '#ff69b4',
        `Unit ${text(item.id || item.unit || item.name)} ${text(item.status)}`.trim(),
        [text(item.type), text(item.location || item.address)],
        9,
      ),
    );
  });
  return records;
}

/** TomTom incidents already proxied by Cape. `line` pairs are `[lat, lon]`. */
export function mapTomTom(payload) {
  const records = [];
  (payload?.incidents || []).forEach((incident, index) => {
    const delay = Number(incident.magnitude_of_delay) || 0;
    const accent = delay >= 3 ? '#ff0000' : '#ff4500';
    const title =
      `${text(incident.category) || 'Incident'}: ${text(incident.from)}` +
      (incident.to ? ` – ${text(incident.to)}` : '');
    const details = [
      text(incident.description),
      incident.delay_s != null ? `Delay ${incident.delay_s} s` : '',
      incident.length_m != null ? `${Math.round(incident.length_m)} m` : '',
      text(incident.start_time),
    ];
    const line = Array.isArray(incident.line)
      ? incident.line
          .map((pair) => {
            if (!Array.isArray(pair) || pair.length < 2) return null;
            const lat = Number(pair[0]);
            const lon = Number(pair[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            return [lon, lat];
          })
          .filter(Boolean)
      : [];
    const localLine = line.filter(([lon, lat]) => inCapeRegion(lon, lat));
    if (localLine.length > 1) {
      const anchor = ringCentroid(localLine);
      records.push(
        pointRecord(
          `tomtom:${incident.id || index}:line`,
          title,
          details,
          accent,
          anchor,
          {
            kind: 'polyline',
            positions: localLine,
            height: 0,
          },
        ),
      );
    }
    const position = lonLat(incident);
    if (position)
      records.push(
        pointRecord(
          `tomtom:${incident.id || index}`,
          title,
          details,
          accent,
          position,
        ),
      );
  });
  return records;
}

export function mapWind(payload) {
  const records = [];
  (payload?.stations || []).forEach((station, index) => {
    const position = lonLat(station);
    if (!position) return;
    const direction =
      station.dir_deg != null && station.dir_deg !== ''
        ? ` ${station.dir_deg}°`
        : '';
    const speed =
      station.mph != null
        ? `${station.mph} mph${direction}${station.gust_mph ? ` gust ${station.gust_mph}` : ''}`
        : '';
    records.push(
      pointRecord(
        `wind:${station.id || index}`,
        text(station.name) || 'Wind station',
        [speed, text(station.time)],
        '#ffffff',
        position,
        { pixelSize: 7, height: 40 },
      ),
    );
  });
  return records;
}

export function mapBuoys(payload) {
  const records = [];
  Object.values(payload?.stations || {}).forEach((station, index) => {
    const position = lonLat(station);
    if (!position) return;
    records.push(
      pointRecord(
        `buoy:${station.station || station.id || index}`,
        text(station.name) || 'Buoy',
        [
          text(station.kind),
          station.wind_speed_ms != null
            ? `Wind ${station.wind_speed_ms} m/s @ ${station.wind_dir_deg ?? '?'}°`
            : '',
          station.wave_height_m != null
            ? `Waves ${station.wave_height_m} m`
            : '',
          station.water_temp_c != null ? `Water ${station.water_temp_c}°C` : '',
          station.air_temp_c != null ? `Air ${station.air_temp_c}°C` : '',
          station.pressure_hpa != null ? `${station.pressure_hpa} hPa` : '',
          text(station.observed_at),
        ],
        '#1e90ff',
        position,
        { pixelSize: 9, height: 5 },
      ),
    );
  });
  return records;
}

export function mapTfrs(payload) {
  const records = [];
  (payload?.features || []).forEach((feature, index) => {
    const props = feature.properties || {};
    const title = `TFR ${text(props.notam || props.name || feature.id) || index}`;
    outerRings(feature.geometry).forEach((ring, ringIndex) => {
      if (!ringInRegion(ring)) return;
      const center = ringCentroid(ring);
      const inside = ring.find(([lon, lat]) => inCapeRegion(lon, lat));
      const anchor =
        center && inCapeRegion(center.lon, center.lat)
          ? center
          : { lon: inside[0], lat: inside[1] };
      records.push(
        pointRecord(
          `tfr:${props.notam || feature.id || index}:${ringIndex}`,
          title,
          [
            text(props.type),
            text(props.description || props.title),
            [text(props.low), text(props.high)].filter(Boolean).join(' – '),
          ],
          '#ff0000',
          anchor,
          { kind: 'polygon', positions: ring, alpha: 0.18, height: 0 },
        ),
      );
    });
  });
  return records;
}

export function mapAirports(payload) {
  const records = [];
  Object.values(payload?.airports || {}).forEach((airport, index) => {
    const position = lonLat(airport);
    if (!position) return;
    const raw = text(airport.raw);
    const taf = text(airport.taf_raw);
    records.push(
      pointRecord(
        `metar:${airport.icao || index}`,
        `${text(airport.icao)} ${text(airport.flight_category)}`.trim(),
        [
          text(airport.name),
          airport.temp_c != null ? `${airport.temp_c}°C` : '',
          airport.wind_speed_kt != null
            ? `Wind ${airport.wind_dir_deg ?? '?'}° / ${airport.wind_speed_kt} kt`
            : '',
          airport.visibility_sm != null
            ? `Vis ${airport.visibility_sm} sm`
            : '',
          raw.length > 180 ? `${raw.slice(0, 177)}…` : raw,
          taf ? `TAF: ${taf.length > 180 ? `${taf.slice(0, 177)}…` : taf}` : '',
        ],
        text(airport.color) || '#9ca3af',
        position,
        { pixelSize: 10, height: 60 },
      ),
    );
  });
  return records;
}

export function mapRadio(payload) {
  const feeds = payload?.feeds || [];
  const live = feeds.filter((feed) => feed.live).length;
  const details = feeds.slice(0, 24).map((feed) => {
    const heard = feed.last_heard_at
      ? ` heard ${text(feed.last_heard_at)}`
      : '';
    return `${feed.live ? 'LIVE' : 'idle'} ${text(feed.name)} (${text(feed.agency)})${heard}`;
  });
  if (feeds.length > 24) details.push(`${feeds.length - 24} more feeds`);
  return {
    count: feeds.length,
    live,
    records: [
      pointRecord(
        'radio:cape-may',
        `Dispatch radio · ${live} live / ${feeds.length}`,
        details.length ? details : ['No radio feeds reported'],
        live ? '#00ff00' : '#9ca3af',
        {
          lon: COUNTY_CENTROIDS['Cape May'][0],
          lat: COUNTY_CENTROIDS['Cape May'][1],
        },
        { pixelSize: 10, height: 40 },
      ),
    ],
  };
}
