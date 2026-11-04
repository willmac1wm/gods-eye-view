// Cape May Dispatch status strip. Map graphics live in DATA LAYERS
// (src/layers/capeDispatch/layers.js). Disable the strip with
// localStorage.setItem('gev.cape', 'off'). AIS stays unwired.
import * as Cesium from 'cesium';
import { CAPE_HOME } from './model.js';

const BASE = '/api/cape';

async function getJson(path) {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

export function installCapeDispatchOverlay(viewer) {
  if (globalThis.localStorage?.getItem('gev.cape') === 'off') return () => {};
  const panel = document.createElement('div');
  panel.id = 'cape-dispatch-panel';
  panel.style.cssText =
    'position:fixed;left:12px;bottom:56px;z-index:50;max-width:300px;font:11px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,12,20,.82);border:1px solid #2a6;padding:6px 8px;border-radius:4px;pointer-events:auto';
  panel.innerHTML = // i18n-ignore
    '<b>CAPE MAY DISPATCH</b> <button id="cape-home" title="Home: Cape May County" style="font:inherit;float:right;margin-left:4px">HOME</button><button id="cape-toggle" style="font:inherit;float:right">−</button><div id="cape-body">loading…</div><div style="opacity:.75;margin-top:4px">Map graphics: DATA LAYERS → Cape May</div>';
  document.body.appendChild(panel);
  const body = panel.querySelector('#cape-body');
  let collapsed = false;
  panel.querySelector('#cape-toggle').onclick = (event) => {
    collapsed = !collapsed;
    event.target.textContent = collapsed ? '+' : '−';
    body.style.display = collapsed ? 'none' : '';
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

  const state = { health: {}, lines: {} };
  const render = () => {
    const health = Object.values(state.health)
      .map(
        (source) =>
          `${source.state === 'ok' ? '●' : source.state === 'down' ? '✕' : '◐'}${source.key}`,
      )
      .join(' ');
    // i18n-ignore
    body.innerHTML =
      `<div style="opacity:.8">${health}</div>` +
      Object.entries(state.lines)
        .map(([key, value]) => `<div><b>${key}</b> ${value}</div>`)
        .join('');
  };
  const safe = (label, fn) =>
    fn().catch((error) => {
      state.lines[label] = error.message;
    });

  async function poll() {
    const health = await getJson('health/sources').catch(() => null);
    if (health)
      state.health = Object.fromEntries(
        (health.sources || []).map((source) => [source.key, source]),
      );
    await Promise.all([
      safe('Tide', async () => {
        const tide = await getJson('floodwatch');
        const trend = tide.trend_ft_per_hr > 0 ? '↑' : '↓';
        state.lines.Tide = `${tide.station_name}: ${tide.level_ft} ft (${trend}) ${tide.flooding_now ? 'FLOODING' : tide.category}`;
      }),
      safe('NWS', async () => {
        const hazards = await getJson('hazards');
        const alerts = hazards.nws_alerts || [];
        state.lines.NWS = alerts.length
          ? `${alerts.length} alert(s): ${[...new Set(alerts.map((alert) => alert.event))].slice(0, 3).join(', ')}`
          : 'no alerts';
      }),
      safe('Storm', async () => {
        const storm = await getJson('storm_status');
        state.lines.Storm = storm.text || `${storm.count ?? 0} alert(s)`;
      }),
      safe('County', async () => {
        const county = await getJson('county-status');
        const power = county.power?.county;
        state.lines.County = `${county.calls_1h ?? 0} calls/1h, ${county.calls_24h ?? 0}/24h; tide ${county.tide?.level_ft ?? '?'} ft${power ? `; power ${power.out}/${power.served}` : ''}`;
      }),
      safe('Outages', async () => {
        const outages = await getJson('power_outages');
        state.lines.Outages =
          Object.entries(outages.counties || {})
            .map(([name, stats]) => `${name} ${stats.out}`)
            .join(' · ') || 'none';
      }),
      safe('Radio', async () => {
        const radio = await getJson('radio/feeds');
        const feeds = radio.feeds || [];
        state.lines.Radio = `${feeds.filter((feed) => feed.live).length} live / ${feeds.length}`;
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
