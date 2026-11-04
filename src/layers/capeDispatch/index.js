// Cape May Dispatch overlay: consumes Cape via GEV's same-origin /api/cape/* proxy.
// Gauges + Cape May Harbor tide + fx cameras as Cesium entities, plus a status panel
// (health gate, NWS hazards, power outages, TomTom-via-Cape, radio, CAD).
// Disable with localStorage.setItem('gev.cape', 'off'). AIS intentionally not wired.
import * as Cesium from 'cesium';
import { installCapeExtras } from './extras.js';

const BASE = '/api/cape';
const STALE_S = 900;

async function getJson(path) {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

function gaugeColor(cat) {
  if (!cat || cat === 'no_flooding' || cat === 'none')
    return Cesium.Color.DEEPSKYBLUE;
  if (/action|minor/.test(cat)) return Cesium.Color.YELLOW;
  if (/moderate/.test(cat)) return Cesium.Color.ORANGE;
  return Cesium.Color.RED;
}

// Approximate county centroids: Cape outage feed is county/town counts only (no polygons).
const COUNTY_CENTROIDS = {
  'Cape May': [-74.82, 39.08],
  Atlantic: [-74.63, 39.47],
  Cumberland: [-75.13, 39.33],
};

function geoRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  return [];
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function installCapeDispatchOverlay(viewer) {
  if (globalThis.localStorage?.getItem('gev.cape') === 'off') return () => {};
  const ds = new Cesium.CustomDataSource('Cape May Dispatch');
  viewer.dataSources.add(ds);
  const gauges = ds.entities.add(
    new Cesium.Entity({
      id: 'cape-gauges',
      name: 'Cape May: Tide & flood gauges',
    }),
  );
  const cams = ds.entities.add(
    new Cesium.Entity({ id: 'cape-cams', name: 'Cape May: Cameras' }),
  );
  const group = (id, name) => ds.entities.add(new Cesium.Entity({ id, name }));
  const alertsG = group('cape-nws', 'Cape May: NWS alert polygons');
  const trafficCamsG = group('cape-traffic-cams', 'Cape May: Traffic cameras');
  const outagesG = group('cape-outages', 'Cape May: Power outages');
  const cadG = group('cape-cad', 'Cape May: CAD calls');
  const clear = (parent) => {
    for (const e of [...ds.entities.values])
      if (e.parent === parent) ds.entities.remove(e);
  };

  // Predicted-flooding raster from Cape (NOAA SLR inundation). Drapes on the
  // Cesium globe only; hidden when the photoreal tileset hides the globe.
  let floodLayer = null;
  try {
    floodLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: `${BASE}/flood_map/tile/{z}/{x}/{y}.png`,
        rectangle: Cesium.Rectangle.fromDegrees(-75.4, 38.8, -74.3, 39.6),
        minimumLevel: 8,
        maximumLevel: 16,
        credit: 'Cape May Dispatch / NOAA SLR',
      }),
    );
    floodLayer.alpha = 0.55;
    floodLayer.show = false;
  } catch (e) {
    console.warn('Cape flood_map tiles unavailable:', e);
  }

  const panel = document.createElement('div');
  panel.id = 'cape-dispatch-panel';
  panel.style.cssText =
    'position:fixed;left:12px;bottom:56px;z-index:50;max-width:300px;font:11px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,12,20,.82);border:1px solid #2a6;padding:6px 8px;border-radius:4px;pointer-events:auto';
  panel.innerHTML = // i18n-ignore
    '<b>CAPE MAY DISPATCH</b> <button id="cape-home" title="Home: Cape May County" style="font:inherit;float:right;margin-left:4px">HOME</button><button id="cape-toggle" style="font:inherit;float:right">−</button><div id="cape-body">loading…</div>';
  document.body.appendChild(panel);
  const legend = document.createElement('div');
  legend.id = 'cape-legend';
  legend.style.cssText =
    'margin-top:4px;border-top:1px solid #2a6;padding-top:3px';
  const sw = (css, label) =>
    `<div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:middle;${css}"></span>${label}</div>`;
  legend.innerHTML = // i18n-ignore
    '<b>Legend</b> (click any dot)' +
    sw('background:#00bfff', 'Tide/flood gauge: normal') +
    sw('background:#ff0', 'Gauge: action/minor flood') +
    sw('background:#ffa500', 'Gauge: moderate flood') +
    sw('background:#f00', 'Gauge: major flood') +
    sw('background:#0f0', 'Cape fx camera (thumbnail)') +
    sw('background:#0ff', 'Traffic camera') +
    sw('background:#ffd700', '511NJ camera') +
    sw('background:#f0f;border:1px solid #fff', 'CAD call: high priority') +
    sw('background:#ee82ee;border:1px solid #fff', 'CAD call: other') +
    sw(
      'background:rgba(255,255,0,.4);border-radius:2px',
      'Power outage area (red = >5% out)',
    ) +
    sw('background:rgba(255,69,0,.4);border-radius:2px', 'NWS alert polygon');
  panel.appendChild(legend);
  panel.querySelector('#cape-home').onclick = () =>
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-74.91, 38.935, 12000),
      orientation: {
        heading: Cesium.Math.toRadians(20),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
      duration: 2.5,
    });

  // Click popup: the viewer runs with infoBox:false, so Cape entities need
  // their own pick handler or clicks do nothing.
  const pop = document.createElement('div');
  pop.id = 'cape-popup';
  pop.style.cssText =
    'position:fixed;z-index:60;display:none;max-width:320px;max-height:60vh;overflow:auto;font:12px/1.4 ui-monospace,monospace;color:#dfe;background:rgba(0,12,20,.94);border:1px solid #2a6;padding:8px 10px;border-radius:4px';
  document.body.appendChild(pop);
  const capeGroups = new Set([
    gauges,
    cams,
    alertsG,
    trafficCamsG,
    outagesG,
    cadG,
  ]);
  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((ev) => {
    if (!ds.show) return;
    const hits = viewer.scene.drillPick(ev.position, 5) || [];
    const ent = hits
      .map((h) => h?.id)
      .find((e) => e instanceof Cesium.Entity && capeGroups.has(e.parent));
    if (!ent) {
      pop.style.display = 'none';
      return;
    }
    const now = viewer.clock.currentTime;
    const desc = ent.description?.getValue?.(now) ?? '';
    // i18n-ignore
    pop.innerHTML = `<button style="float:right;font:inherit" id="cape-pop-x">x</button><div style="color:#7f7;margin-bottom:4px">${esc(ent.parent?.name || 'Cape')}</div><div><b>${esc(ent.name)}</b></div>${desc}`;
    pop.querySelector('#cape-pop-x').onclick = () => {
      pop.style.display = 'none';
    };
    const x = Math.min(ev.position.x + 14, window.innerWidth - 340);
    const y = Math.min(ev.position.y + 14, window.innerHeight - 200);
    pop.style.left = `${Math.max(4, x)}px`;
    pop.style.top = `${Math.max(4, y)}px`;
    pop.style.display = 'block';
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  panel.querySelector('#cape-toggle').onclick = (e) => {
    ds.show = !ds.show;
    e.target.textContent = ds.show ? '−' : '+';
    panel.querySelector('#cape-body').style.display = ds.show ? '' : 'none';
    if (floodLayer) floodLayer.show = ds.show;
  };

  const state = { health: {}, lines: {} };
  const fresh = (key) => {
    const s = state.health[key];
    return !s || (s.state !== 'down' && (s.age_s == null || s.age_s < STALE_S));
  };
  const render = () => {
    const h = Object.values(state.health)
      .map(
        (s) =>
          `${s.state === 'ok' ? '●' : s.state === 'down' ? '✕' : '◐'}${s.key}`,
      )
      .join(' ');
    panel.querySelector('#cape-body').innerHTML =
      `<div style="opacity:.8">${h}</div>` +
      Object.entries(state.lines)
        .map(([k, v]) => `<div><b>${k}</b> ${v}</div>`)
        .join('');
  };
  const safe = (label, fn) =>
    fn().catch((e) => {
      state.lines[label] = `<span style="color:#f88">${e.message}</span>`;
    });

  async function pollHealth() {
    const j = await getJson('health/sources');
    state.health = Object.fromEntries((j.sources || []).map((s) => [s.key, s]));
  }
  async function pollFlood() {
    if (fresh('tides')) {
      const t = await getJson('floodwatch');
      state.lines.Tide = `${t.station_name}: ${t.level_ft} ft (${t.trend_ft_per_hr > 0 ? '↑' : '↓'}) ${t.flooding_now ? 'FLOODING' : t.category}; next high ${t.next_high_tide?.level_ft ?? '?'} ft @ ${t.next_high_tide?.time ?? '?'}`;
    }
    if (!fresh('flood')) {
      state.lines.Gauges = 'stale/down';
      return;
    }
    const g = await getJson('flood_gauges');
    for (const e of [...ds.entities.values])
      if (e.parent === gauges) ds.entities.remove(e);
    let n = 0;
    for (const x of g.gauges || []) {
      if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng)) continue;
      n++;
      ds.entities.add({
        parent: gauges,
        name: `Cape May gauge: ${x.name}`,
        position: Cesium.Cartesian3.fromDegrees(x.lng, x.lat, 30),
        point: {
          pixelSize: 9,
          color: gaugeColor(x.observed?.category),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `<p><b>${esc(x.name)}</b> - ${esc(x.observed?.category || 'no flooding')}</p><p>${x.observed?.value ?? '–'} ${x.observed?.unit ?? ''} @ ${x.observed?.time ?? ''} (${x.datum})</p><p>Forecast: ${x.forecast?.value ?? '–'} @ ${x.forecast?.time ?? ''}</p><p><a href="${x.link}" target="_blank" rel="noopener">NWS gauge</a></p>`,
      });
    }
    state.lines.Gauges = `${n} NWS tide/flood gauges on map`;
    const plan = await getJson('flood_map/plan').catch(() => null);
    if (floodLayer) floodLayer.show = ds.show && !!plan;
    if (plan)
      state.lines['Flood map'] =
        `${plan.flooding ? 'FLOODING predicted' : 'no flooding predicted'}; max ${plan.max_level ?? 0} ft${viewer.scene.globe.show ? '' : ' (globe hidden: raster not visible)'}`;
  }
  async function pollTrafficCams() {
    if (!fresh('cameras')) return;
    const [tc, nj] = await Promise.all([
      getJson('traffic_cameras').catch(() => null),
      getJson('intel/nj511_cameras').catch(() => null),
    ]);
    clear(trafficCamsG);
    const seen = new Set();
    let n = 0;
    const add = (c, src, color) => {
      const lng = c.lng ?? c.lon;
      if (!Number.isFinite(c.lat) || !Number.isFinite(lng)) return;
      const k = `${c.lat.toFixed(4)},${lng.toFixed(4)}`;
      if (seen.has(k)) return;
      seen.add(k);
      n++;
      ds.entities.add({
        parent: trafficCamsG,
        name: `Cape cam: ${c.name}`,
        position: Cesium.Cartesian3.fromDegrees(lng, c.lat, 20),
        point: {
          pixelSize: 7,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `<p><b>${esc(c.name)}</b></p><p>${esc(c.source || c.agency || src)} — ${esc(c.road || c.corridor || '')}</p>${c.image_url ? `<img src="${esc(c.image_url)}" style="max-width:100%">` : ''}${c.player_url ? `<p><a href="${esc(c.player_url)}" target="_blank" rel="noopener">Live player</a></p>` : ''}`,
      });
    };
    for (const c of tc?.cameras || []) add(c, 'Traffic cam', Cesium.Color.CYAN);
    for (const c of nj?.cameras || []) add(c, '511NJ', Cesium.Color.GOLD);
    state.lines['Traffic cams'] = `${n} traffic/511NJ cameras on map`;
  }
  async function pollAlertsAndOutages() {
    if (fresh('nws')) {
      const h = await getJson('hazards');
      clear(alertsG);
      let n = 0;
      for (const a of h.nws_alerts || []) {
        for (const ring of geoRings(a.geometry)) {
          n++;
          ds.entities.add({
            parent: alertsG,
            name: `NWS: ${a.event || 'alert'}`,
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
              material: Cesium.Color.ORANGERED.withAlpha(0.25),
              classificationType: Cesium.ClassificationType.BOTH,
            },
            description: `<p><b>${esc(a.event)}</b></p><p>${esc(a.headline || a.area || '')}</p>`,
          });
        }
      }
      state.lines['NWS polys'] = `${n} alert polygon(s) drawn`;
    }
    if (fresh('outages')) {
      const o = await getJson('power_outages');
      clear(outagesG);
      for (const [county, v] of Object.entries(o.counties || {})) {
        const c = COUNTY_CENTROIDS[county];
        if (!c || !v.out) continue;
        const pct = v.served ? v.out / v.served : 0;
        ds.entities.add({
          parent: outagesG,
          name: `Outages: ${county}: ${v.out} out`,
          position: Cesium.Cartesian3.fromDegrees(c[0], c[1]),
          ellipse: {
            semiMajorAxis: 4000 + Math.min(16000, pct * 400000),
            semiMinorAxis: 4000 + Math.min(16000, pct * 400000),
            material: (pct > 0.05
              ? Cesium.Color.RED
              : Cesium.Color.YELLOW
            ).withAlpha(0.22),
            classificationType: Cesium.ClassificationType.BOTH,
          },
          description: `<p>${esc(county)}: ${v.out} of ${v.served} out; ETR ${esc(v.etr)}</p>${(
            o.towns || []
          )
            .filter((t) => t.county === county)
            .map((t) => `<div>${esc(t.town)}: ${t.out}</div>`)
            .join('')}`,
        });
      }
    }
  }
  async function pollCad() {
    const j = await getJson('cad/calls').catch(() => null);
    if (!j) return;
    clear(cadG);
    const calls = j.calls || [];
    let n = 0;
    for (const c of calls) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      n++;
      ds.entities.add({
        parent: cadG,
        name: `CAD: ${c.type || 'call'} — ${c.location || ''}`,
        position: Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 25),
        point: {
          pixelSize: 11,
          color: /high|emerg|^1$/i.test(String(c.priority ?? ''))
            ? Cesium.Color.MAGENTA
            : Cesium.Color.VIOLET,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `<p><b>${esc(c.type)}</b> (${esc(c.priority)}) — ${esc(c.status)}</p><p>${esc(c.location)}, ${esc(c.municipality)}</p><p>${esc(c.timestamp)}</p><p>Units: ${esc((c.units || []).join(', '))}</p>${c.summary || c.description ? `<p>${esc(c.summary || c.description)}</p>` : ''}`,
      });
    }
    state.lines['CAD calls'] = `${calls.length} recent call(s), ${n} on map`;
  }
  async function pollCams() {
    if (!fresh('cameras')) return;
    const j = await getJson('fx/cameras');
    for (const e of [...ds.entities.values])
      if (e.parent === cams) ds.entities.remove(e);
    let n = 0;
    for (const c of j.cameras || []) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      n++;
      const thumb = c.thumb ? c.thumb.replace(/^\/api\//, `${BASE}/`) : '';
      ds.entities.add({
        parent: cams,
        name: `Cape May cam: ${c.name}`,
        position: Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 20),
        point: {
          pixelSize: 7,
          color: Cesium.Color.LIME,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `<p><b>${esc(c.name)}</b></p><p>${esc(c.source)} - ${esc(c.road ?? '')}</p>${thumb ? `<a href="${esc(thumb)}" target="_blank" rel="noopener"><img src="${esc(thumb)}" style="max-width:100%"></a>` : '<p>(no thumbnail)</p>'}${c.player_url || c.url ? `<p><a href="${esc(c.player_url || c.url)}" target="_blank" rel="noopener">Open camera</a></p>` : ''}`,
      });
    }
    state.lines.Cameras = `${n} Cape cameras on map`;
  }
  async function pollStatus() {
    if (fresh('nws')) {
      const h = await getJson('hazards');
      const a = h.nws_alerts || [];
      state.lines.NWS = a.length
        ? `${a.length} alert(s): ${[...new Set(a.map((x) => x.event))].slice(0, 3).join(', ')}`
        : 'no alerts';
    }
    if (fresh('outages')) {
      const o = await getJson('power_outages');
      state.lines.Outages = Object.entries(o.counties || {})
        .map(([k, v]) => `${k} ${v.out}`)
        .join(' · ');
    }
  }

  const timers = [];
  const loop = (fn, ms) => {
    const run = () => fn().finally(render);
    run();
    timers.push(setInterval(run, ms));
  };
  loop(
    () =>
      safe('Health', pollHealth).then(() =>
        Promise.all([
          safe('Gauges', pollFlood),
          safe('Status', pollStatus),
          safe('NWS polys', pollAlertsAndOutages),
          safe('CAD calls', pollCad),
        ]),
      ),
    60_000,
  );
  loop(
    () =>
      Promise.all([
        safe('Cameras', pollCams),
        safe('Traffic cams', pollTrafficCams),
      ]),
    300_000,
  );
  const extrasOff = installCapeExtras({
    viewer,
    ds,
    panel,
    legend,
    capeGroups,
    getJson,
    fresh,
    esc,
    BASE,
  });
  return () => {
    extrasOff();
    timers.forEach(clearInterval);
    viewer.dataSources.remove(ds, true);
    if (floodLayer) viewer.imageryLayers.remove(floodLayer, true);
    panel.remove();
    pop.remove();
    clickHandler.destroy();
  };
}
