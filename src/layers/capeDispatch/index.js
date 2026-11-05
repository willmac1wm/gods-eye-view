// Cape May Dispatch status strip. Map graphics live in DATA LAYERS
// (src/layers/capeDispatch/layers.js). Disable the strip with
// localStorage.setItem('gev.cape', 'off'). AIS stays unwired.
import * as Cesium from 'cesium';
import { requestCapeRadio } from '../../capeRadioFocusRequest.js';
import { getCapeHealth } from './client.js';
import { CAPE_NATIVE_FALLBACKS } from './nativeFallback.js';
import {
  CAPE_HOME,
  isCapeSourceFresh,
  mapAirports,
  mapBuoys,
  mapCad,
  mapFloodGauges,
  mapTomTom,
  mapWind,
} from './model.js';

const BASE = '/api/cape';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

function firewireStatusMessage(error) {
  const message = String(error?.message || error || '');
  if (/HTTP 503/.test(message)) return 'Fire Wire offline / unconfigured';
  if (/HTTP 502/.test(message)) return 'Fire Wire upstream down';
  return message || 'unavailable';
}

const swatch = (css, label) =>
  `<div><span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle;${css}"></span>${label}</div>`;

async function getJson(path) {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.clone().json();
      detail = body?.error ? ` (${body.error})` : '';
    } catch {
      /* ignore */
    }
    throw new Error(`${path} HTTP ${response.status}${detail}`);
  }
  return response.json();
}

export function installCapeDispatchOverlay(viewer) {
  if (globalThis.localStorage?.getItem('gev.cape') === 'off') return () => {};
  const panel = document.createElement('div');
  panel.id = 'cape-dispatch-panel';
  panel.style.cssText =
    'position:fixed;left:12px;bottom:56px;z-index:50;max-width:310px;max-height:52vh;overflow:auto;font:11px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,12,20,.86);border:1px solid #2a6;padding:6px 8px;border-radius:4px;pointer-events:auto';
  panel.innerHTML = // i18n-ignore
    '<b>CAPE MAY DISPATCH</b> <button id="cape-home" title="Home: Cape May County" style="font:inherit;float:right;margin-left:4px">HOME</button><button id="cape-toggle" style="font:inherit;float:right">−</button><div id="cape-body">loading…</div><div id="cape-sections" style="margin-top:4px;border-top:1px solid #2a6;padding-top:3px"></div><details id="cape-legend" style="margin-top:4px;border-top:1px solid #2a6;padding-top:3px"><summary style="cursor:pointer"><b>Legend</b> (DATA LAYERS → Cape May)</summary>' +
    swatch('background:#00bfff', 'Tide/flood gauge: normal') +
    swatch('background:#ff0', 'Gauge: action/minor flood') +
    swatch('background:#ffa500', 'Gauge: moderate flood') +
    swatch('background:#f00', 'Gauge: major flood') +
    swatch('background:#0f0', 'Cape fx camera (snapshot)') +
    swatch('background:#0ff', 'Traffic camera') +
    swatch('background:#ffd700', '511NJ camera') +
    swatch('background:#7fff00', 'Webcam') +
    swatch('background:#f0f;border:1px solid #fff', 'CAD call: high priority') +
    swatch('background:#ee82ee;border:1px solid #fff', 'CAD call: other') +
    swatch('background:#ff1493;border:1px solid #fff', 'CAD incident / unit') +
    swatch('background:#ff4500', 'TomTom traffic incident') +
    swatch('background:#1e90ff', 'Buoy / coastal station') +
    swatch('background:#22c55e', 'Airport METAR (flight cat)') +
    swatch(
      'background:rgba(255,255,0,.45);border-radius:2px',
      'Power outage area',
    ) +
    swatch(
      'background:rgba(255,69,0,.45);border-radius:2px',
      'NWS alert / TFR polygon',
    ) +
    '</details>';
  document.body.appendChild(panel);
  const body = panel.querySelector('#cape-body');
  const sectionsBox = panel.querySelector('#cape-sections');
  const legendBox = panel.querySelector('#cape-legend');
  let collapsed = false;
  panel.querySelector('#cape-toggle').onclick = (event) => {
    collapsed = !collapsed;
    event.target.textContent = collapsed ? '+' : '−';
    body.style.display = collapsed ? 'none' : '';
    sectionsBox.style.display = collapsed ? 'none' : '';
    legendBox.style.display = collapsed ? 'none' : '';
  };
  panel.querySelector('#cape-home').onclick = () =>
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        CAPE_HOME.lon,
        CAPE_HOME.lat,
        CAPE_HOME.height,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(20),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
      duration: 2.5,
    });

  const flyables = new Map();
  let flySeq = 0;
  const flyLink = (lon, lat, label) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return esc(label);
    const id = `cf${flySeq++}`;
    flyables.set(id, [lon, lat]);
    return `<a href="#" data-cape-fly="${id}" style="color:#9ff;text-decoration:none">${esc(label)}</a>`;
  };
  sectionsBox.addEventListener('click', (event) => {
    const id = event.target?.dataset?.capeFly;
    if (!id) return;
    event.preventDefault();
    const coords = flyables.get(id);
    if (!coords) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 3000),
      duration: 1.5,
    });
  });

  const state = { health: {}, lines: {}, sections: {}, boardChips: [] };
  const fresh = (key) => isCapeSourceFresh(state.health, key);
  const setSection = (label, summary, rows = []) => {
    state.sections[label] = {
      summary: esc(summary),
      body: rows
        .slice(0, 30)
        .map((row) => `<div style="margin-left:8px">${row}</div>`)
        .join(''),
    };
  };
  const cameraPoint = () => {
    const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    if (!carto) return { lat: CAPE_HOME.lat, lon: CAPE_HOME.lon };
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  };
  const opsHref = (path) => {
    const { lat, lon } = cameraPoint();
    return `${path}?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
  };
  const renderOpsLinks = () => {
    setSection('Ops pages', 'full Cape desk', [
      `<a href="/ops/" target="_blank" rel="noopener" style="color:#9ff">Ops hub</a>`,
      `<a href="${opsHref('/ops/place')}" target="_blank" rel="noopener" style="color:#9ff">Place</a>`,
      `<a href="${opsHref('/ops/hydrants')}" target="_blank" rel="noopener" style="color:#9ff">Hydrants</a>`,
      `<a href="${opsHref('/ops/timeline')}" target="_blank" rel="noopener" style="color:#9ff">Timeline</a>`,
      `<a href="/ops/incidents" target="_blank" rel="noopener" style="color:#9ff">Incidents</a>`,
      `<a href="/ops/scanners" target="_blank" rel="noopener" style="color:#9ff">Scanners</a>`,
      `<a href="${opsHref('/ops/flood')}" target="_blank" rel="noopener" style="color:#9ff">Flood</a>`,
      `<a href="/ops/board" target="_blank" rel="noopener" style="color:#9ff">Board</a>`,
      `<a href="${opsHref('/ops/aviation')}" target="_blank" rel="noopener" style="color:#9ff">Aviation</a>`,
      `<a href="/ops/cameras" target="_blank" rel="noopener" style="color:#9ff">Cameras</a>`,
      `<a href="/ops/reconstruct" target="_blank" rel="noopener" style="color:#9ff">Reconstruct</a>`,
      `<a href="/ops/scenes" target="_blank" rel="noopener" style="color:#9ff">Scenes</a>`,
      `<a href="/ops/intel" target="_blank" rel="noopener" style="color:#9ff">Intel</a>`,
      `<a href="/ops/whales" target="_blank" rel="noopener" style="color:#9ff">Whales</a>`,
    ]);
  };
  /** Official board chips from `/api/cape/board` (weather, marine, radio, power). */
  const setBoardChips = (chips) => {
    state.boardChips = Array.isArray(chips) ? chips : [];
  };
  const chipColor = (level) => {
    if (level === 'alert' || level === 'warn') return '#fbbf24';
    if (level === 'danger' || level === 'critical') return '#f87171';
    return '#9fe8c2';
  };
  const render = () => {
    const health = Object.values(state.health)
      .map(
        (source) =>
          `${source.state === 'ok' ? '●' : source.state === 'down' ? '✕' : '◐'}${esc(source.key)}`,
      )
      .join(' ');
    const chips = (state.boardChips || [])
      .slice(0, 12)
      .map(
        (chip) =>
          `<span style="display:inline-block;margin:2px 4px 2px 0;padding:1px 5px;border:1px solid #2a6;border-radius:3px;color:${chipColor(chip.level)}"><b>${esc(chip.label)}</b> ${esc(chip.value)}</span>`,
      )
      .join('');
    // i18n-ignore
    body.innerHTML =
      `<div style="opacity:.8">${health}</div>` +
      (chips ? `<div style="margin:4px 0 2px">${chips}</div>` : '') +
      Object.entries(state.lines)
        .map(([key, value]) => `<div><b>${esc(key)}</b> ${esc(value)}</div>`)
        .join('');
    // i18n-ignore
    sectionsBox.innerHTML = Object.entries(state.sections)
      .map(
        ([key, sec]) =>
          `<details><summary style="cursor:pointer"><b>${esc(key)}</b> ${sec.summary}</summary>${sec.body}</details>`,
      )
      .join('');
  };
  const safe = (label, fn) =>
    fn().catch((error) => {
      state.lines[label] = firewireStatusMessage(error);
    });

  sectionsBox.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('[data-cape-feed-id]');
    if (!btn) return;
    event.preventDefault();
    requestCapeRadio({
      feedId: btn.getAttribute('data-cape-feed-id') || '',
      name: btn.getAttribute('data-cape-feed-name') || '',
      agency: btn.getAttribute('data-cape-feed-agency') || '',
    });
  });

  async function poll() {
    flyables.clear();
    flySeq = 0;
    renderOpsLinks();
    const health = await getCapeHealth().catch(() => null);
    if (health) state.health = health;
    // Probe Fire Wire once so the strip can say offline vs quiet.
    try {
      await getJson('health/sources');
      delete state.lines.Upstream;
    } catch (error) {
      state.lines.Upstream = firewireStatusMessage(error);
      setSection(
        'Native fallbacks',
        'Fire Wire offline — use GEV natives / set FIREWIRE_URL',
        CAPE_NATIVE_FALLBACKS.map(
          (row) => `${esc(row.cape)} → ${esc(row.native)}`,
        ),
      );
    }
    await Promise.all([
      safe('Tide', async () => {
        if (!fresh('tides')) {
          state.lines.Tide = 'stale/down';
          return;
        }
        const tide = await getJson('floodwatch');
        const trend = tide.trend_ft_per_hr > 0 ? '↑' : '↓';
        const nextHigh = tide.next_high_tide
          ? `; next high ${tide.next_high_tide.level_ft ?? '?'} ft @ ${tide.next_high_tide.time ?? '?'}`
          : '';
        state.lines.Tide = `${tide.station_name}: ${tide.level_ft} ft (${trend}) ${tide.flooding_now ? 'FLOODING' : tide.category}${nextHigh}`;
      }),
      safe('Flood map', async () => {
        if (!fresh('flood')) {
          state.lines['Flood map'] = 'stale/down';
          return;
        }
        const [plan, gauges] = await Promise.all([
          getJson('flood_map/plan').catch(() => null),
          getJson('flood_gauges').catch(() => null),
        ]);
        if (plan) {
          const globeNote =
            viewer?.scene?.globe && viewer.scene.globe.show === false
              ? ' (globe hidden)'
              : '';
          state.lines['Flood map'] =
            `${plan.flooding ? 'FLOODING predicted' : 'no flooding predicted'}; max ${plan.max_level ?? 0} ft${globeNote}`;
        }
        const mapped = mapFloodGauges(gauges);
        if (mapped.length) {
          setSection(
            'Gauges',
            `${mapped.length} in region`,
            mapped.map((g) =>
              flyLink(g.lon, g.lat, `${g.title} (${g.details[0] || 'ok'})`),
            ),
          );
        }
      }),
      safe('NWS', async () => {
        if (!fresh('nws')) {
          state.lines.NWS = 'stale/down';
          return;
        }
        const hazards = await getJson('hazards');
        const alerts = hazards.nws_alerts || [];
        state.lines.NWS = alerts.length
          ? `${alerts.length} alert(s): ${[...new Set(alerts.map((alert) => alert.event))].slice(0, 3).join(', ')}`
          : 'no alerts';
      }),
      safe('Storm', async () => {
        if (!fresh('nws')) {
          state.lines.Storm = 'stale/down';
          return;
        }
        const storm = await getJson('storm_status');
        state.lines.Storm = storm.text || `${storm.count ?? 0} alert(s)`;
      }),
      safe('County', async () => {
        const county = await getJson('county-status');
        const power = county.power?.county;
        const rip = county.rip_current?.risk || county.rip_current?.error || '';
        state.lines.County = `${county.calls_1h ?? 0} calls/1h, ${county.calls_24h ?? 0}/24h; tide ${county.tide?.level_ft ?? '?'} ft${power ? `; power ${power.out}/${power.served}` : ''}${rip ? `; rip ${rip}` : ''}`;
      }),
      safe('Outages', async () => {
        if (!fresh('outages')) {
          state.lines.Outages = 'stale/down';
          return;
        }
        const outages = await getJson('power_outages');
        state.lines.Outages =
          Object.entries(outages.counties || {})
            .map(([name, stats]) => `${name} ${stats.out}`)
            .join(' · ') || 'none';
      }),
      safe('Radio', async () => {
        const radio = await getJson('radio/feeds');
        const feeds = radio.feeds || [];
        const live = feeds.filter((feed) => feed.live).length;
        const summary =
          feeds.length === 0
            ? 'quiet · waiting on SDR'
            : live > 0
              ? `${live} live / ${feeds.length}`
              : `${feeds.length} idle · waiting on SDR`;
        state.lines.Radio = summary;
        setSection(
          'Scanner feeds',
          summary,
          feeds.map((feed) => {
            const mark = feed.live
              ? 'LIVE'
              : feed.has_audio
                ? 'idle · SDR'
                : 'no audio · SDR';
            const heard = feed.last_heard_at
              ? ` · heard ${esc(feed.last_heard_at)}`
              : '';
            const label = `${esc(mark)} <b>${esc(feed.agency || feed.name)}</b> — ${esc(feed.desc || feed.name)}${heard}`;
            if (feed.feed_id == null) return label;
            return `<button type="button" data-cape-feed-id="${esc(feed.feed_id)}" data-cape-feed-name="${esc(feed.name || '')}" data-cape-feed-agency="${esc(feed.agency || '')}" style="all:unset;cursor:pointer;color:#9ff">${label}</button>`;
          }),
        );
      }),
      safe('Board', async () => {
        const board = await getJson('board');
        setBoardChips(board.official || []);
        const rumors = board.flash_rumors || [];
        setSection(
          'News wire',
          rumors.length ? `${rumors.length} item(s)` : 'quiet',
          rumors.map((item) => {
            const title = esc(item.title || item.keyword || 'Update');
            const meta = [item.town, item.keyword, item.source]
              .filter(Boolean)
              .map(esc)
              .join(' · ');
            if (item.url && /^https?:\/\//i.test(item.url)) {
              return `<a href="${esc(item.url)}" target="_blank" rel="noopener" style="color:#9ff">${title}</a>${meta ? `<div style="opacity:.75">${meta}</div>` : ''}`;
            }
            return `${title}${meta ? `<div style="opacity:.75">${meta}</div>` : ''}`;
          }),
        );
      }),
      safe('SAR', async () => {
        const sar = await getJson('sar/flood');
        if (!sar?.configured) {
          state.lines.SAR = 'not configured';
          return;
        }
        const water =
          sar.new_water_pct != null ? `${sar.new_water_pct}% new water` : '';
        state.lines.SAR = sar.available
          ? `pass ${sar.latest_pass || '?'}${water ? `; ${water}` : ''}`
          : sar.error || 'unavailable';
      }),
      safe('Storms', async () => {
        const storms = await getJson('storms');
        const list = storms.storms || [];
        if (!list.length) {
          state.lines.Storms = 'none on record';
          setSection('Storm archive', 'none');
          return;
        }
        const latest = list[0];
        state.lines.Storms = `${list.length} on record; latest ${latest.category || ''} peak ${latest.peak_ft ?? '?'} ft @ ${latest.peak_time || latest.id || '?'}`;
        setSection(
          'Storm archive',
          `${list.length} event(s)`,
          list.slice(0, 8).map((storm) => {
            const peak = storm.peak_ft != null ? `${storm.peak_ft} ft` : '';
            return `${esc(storm.id || storm.peak_time || 'storm')}: ${esc(storm.category || '')} ${esc(peak)} (${esc(storm.start || '')} → ${esc(storm.end || '')})`;
          }),
        );
      }),
      safe('CAD', async () => {
        const [calls, incidents, units] = await Promise.all([
          getJson('cad/calls').catch(() => null),
          getJson('cad/incidents').catch(() => null),
          getJson('cad/units').catch(() => null),
        ]);
        const mapped = mapCad({ calls, incidents, units });
        setSection(
          'CAD',
          mapped.length ? `${mapped.length} on map` : 'quiet',
          mapped.map((item) => flyLink(item.lon, item.lat, item.title)),
        );
      }),
      safe('TomTom', async () => {
        if (!fresh('traffic')) {
          setSection('TomTom', 'stale/down');
          return;
        }
        const status = await getJson('tomtom/status').catch(() => null);
        if (status && (!status.configured || status.budget?.circuit_open)) {
          setSection('TomTom', 'unavailable');
          return;
        }
        const traffic = await getJson('tomtom/traffic');
        const points = mapTomTom(traffic).filter(
          (item) => item.kind === 'point',
        );
        setSection(
          'TomTom',
          `${points.length} incident(s)`,
          points.map((item) => flyLink(item.lon, item.lat, item.title)),
        );
      }),
      safe('WX/Marine', async () => {
        const [wxStatus, wind, buoys, airports] = await Promise.all([
          getJson('wx/status').catch(() => null),
          getJson('wx/wind').catch(() => null),
          getJson('buoys').catch(() => null),
          getJson('airport_wx').catch(() => null),
        ]);
        const tropical =
          wxStatus?.layers?.tropical?.note ||
          (wxStatus?.layers?.tropical?.storms || []).length ||
          0;
        const windRows = mapWind(wind);
        const buoyRows = mapBuoys(buoys);
        const airportRows = mapAirports(airports);
        setSection(
          'Marine & WX',
          `${buoyRows.length} buoys · ${windRows.length} wind · ${airportRows.length} METAR · trop: ${tropical}`,
          [
            ...buoyRows.map((b) =>
              flyLink(b.lon, b.lat, `Buoy ${b.title}: ${b.details[1] || ''}`),
            ),
            ...airportRows.map((a) =>
              flyLink(a.lon, a.lat, `${a.title} (${a.details[0] || ''})`),
            ),
            ...windRows.map((w) =>
              flyLink(w.lon, w.lat, `Wind ${w.title}: ${w.details[0] || ''}`),
            ),
          ],
        );
      }),
    ]);
    render();
  }

  poll();
  const timer = setInterval(poll, 60_000);
  return () => {
    clearInterval(timer);
    panel.remove();
  };
}
