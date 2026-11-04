// Cape Dispatch extra sources (all via same-origin /api/cape/* proxy):
// TomTom incidents (via Cape), radio feeds (metadata only), CAD incidents/units,
// NWS storm_status/feeds/county-status, wx wind, buoys, webcams, TFRs, airport METARs.
import * as Cesium from 'cesium';

const REGION = Cesium.Rectangle.fromDegrees(-76.2, 38.3, -73.8, 40.2); // Cape May / S. Jersey / Delaware
const inRegion = (lng, lat) =>
  Cesium.Rectangle.contains(REGION, Cesium.Cartographic.fromDegrees(lng, lat));
const ll = (o) => {
  const lat = Number(o?.lat ?? o?.latitude);
  const lng = Number(o?.lng ?? o?.lon ?? o?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
};

export function installCapeExtras({
  viewer,
  ds,
  panel,
  legend,
  capeGroups,
  getJson,
  fresh,
  esc,
  BASE,
}) {
  const group = (id, name) => {
    const g = ds.entities.add(new Cesium.Entity({ id, name }));
    capeGroups.add(g);
    return g;
  };
  const G = {
    tt: group('cape-tomtom', 'Cape: TomTom traffic incidents'),
    cad: group('cape-cad-inc', 'Cape: CAD incidents/units'),
    nws: group('cape-nws-feed', 'Cape: NWS / feed items'),
    wind: group('cape-wind', 'Cape: Wind stations'),
    buoy: group('cape-buoys', 'Cape: Buoys'),
    web: group('cape-webcams', 'Cape: Webcams'),
    tfr: group('cape-tfr', 'Cape: TFRs'),
    apt: group('cape-airports', 'Cape: Airport weather'),
  };
  const clear = (p) => {
    for (const e of [...ds.entities.values])
      if (e.parent === p) ds.entities.remove(e);
  };
  const pt = (parent, [lng, lat], name, color, desc, size = 8, h = 25) =>
    ds.entities.add({
      parent,
      name,
      description: desc,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, h),
      point: {
        pixelSize: size,
        color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

  const box = document.createElement('div');
  box.id = 'cape-extras';
  box.style.cssText =
    'margin-top:4px;border-top:1px solid #2a6;padding-top:3px;max-height:38vh;overflow:auto';
  panel.insertBefore(box, legend);
  const sw = (css, label) =>
    `<div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:middle;${css}"></span>${label}</div>`;
  // i18n-ignore
  legend.insertAdjacentHTML(
    'beforeend',
    sw('background:#ff4500', 'TomTom incident (line = affected road)') +
      sw('background:#ff1493;border:1px solid #fff', 'CAD incident / unit') +
      sw('background:#ffb6c1', 'NWS/feed item point') +
      sw('background:#fff', 'Wind station (label = mph/dir)') +
      sw('background:#1e90ff', 'Buoy / coastal station') +
      sw('background:#7fff00', 'Webcam') +
      sw('background:rgba(255,0,0,.35);border-radius:2px', 'TFR polygon') +
      sw('background:#22c55e', 'Airport METAR (flight category color)'),
  );

  const sections = {};
  const flyables = new Map();
  let fid = 0;
  const fly = (c, label) => {
    const id = `f${fid++}`;
    flyables.set(id, c);
    return `<a href="#" data-fly="${id}" style="color:#9ff">${esc(label)}</a>`;
  };
  box.addEventListener('click', (e) => {
    const id = e.target?.dataset?.fly;
    if (!id) return;
    e.preventDefault();
    const [lng, lat] = flyables.get(id) || [];
    if (lng != null)
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 3000),
        duration: 1.5,
      });
  });
  const draw = () => {
    // i18n-ignore
    box.innerHTML = Object.entries(sections)
      .map(
        ([k, v]) =>
          `<details><summary><b>${esc(k)}</b> ${v.summary}</summary>${v.body || ''}</details>`,
      )
      .join('');
  };
  const sect = (k, summary, items = []) => {
    sections[k] = {
      summary,
      body: items
        .slice(0, 40)
        .map((x) => `<div style="margin-left:8px">${x}</div>`)
        .join(''),
    };
  };
  const safe = (k, fn) =>
    fn().catch((e) =>
      sect(k, `<span style="color:#f88">${esc(e.message)}</span>`),
    );

  async function tomtom() {
    const s = await getJson('tomtom/status');
    if (!s.configured || s.budget?.circuit_open) {
      clear(G.tt);
      return sect(
        'TomTom',
        `unavailable${s.budget?.circuit_reason ? `: ${esc(s.budget.circuit_reason)}` : ''}`,
      );
    }
    const t = await getJson('tomtom/traffic');
    clear(G.tt);
    const inc = t.incidents || [];
    const items = [];
    for (const i of inc) {
      const c = ll(i);
      const color =
        (i.magnitude_of_delay ?? 0) >= 3
          ? Cesium.Color.RED
          : Cesium.Color.ORANGERED;
      const desc = `<p><b>${esc(i.category)}</b> - ${esc(i.description)}</p><p>${esc(i.from)} &rarr; ${esc(i.to)}</p><p>Magnitude: ${esc(i.magnitude)}; delay ${i.delay_s ?? '?'} s; ${Math.round(i.length_m || 0)} m</p><p>Since ${esc(i.start_time)}</p>`;
      const name = `${i.category}: ${i.from || ''}${i.to ? ` - ${i.to}` : ''}`;
      if (Array.isArray(i.line) && i.line.length > 1)
        ds.entities.add({
          parent: G.tt,
          name,
          description: desc,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(
              i.line.flatMap(([la, lo]) => [lo, la]),
            ),
            width: 5,
            material: color,
            clampToGround: true,
          },
        });
      if (c) pt(G.tt, c, name, color, desc, 8);
      items.push(c ? fly(c, name) : esc(name));
    }
    sect('TomTom', `${inc.length} incident(s)`, items);
  }
  async function radio() {
    const r = await getJson('radio/feeds');
    const f = r.feeds || [];
    sect(
      'Radio',
      `${f.length} feed(s), ${f.filter((x) => x.live).length} live`,
      f.map(
        (x) =>
          `${x.live ? '<span style="color:#0f0">&#9679;</span>' : '&#9675;'} ${esc(x.name)} <span style="opacity:.7">(${esc(x.agency)}${x.last_heard_at ? `, heard ${esc(x.last_heard_at)}` : ''})</span>`,
      ),
    );
  }
  async function cad() {
    const [i, u] = await Promise.all([
      getJson('cad/incidents'),
      getJson('cad/units'),
    ]);
    clear(G.cad);
    const items = [];
    for (const x of i.incidents || []) {
      const c = ll(x);
      const name = `CAD incident: ${x.type || x.nature || x.id || ''} ${x.location || x.address || ''}`;
      if (c)
        pt(
          G.cad,
          c,
          name,
          Cesium.Color.DEEPPINK,
          `<pre style="white-space:pre-wrap">${esc(JSON.stringify(x, null, 1))}</pre>`,
          11,
        );
      items.push(c ? fly(c, name) : esc(name));
    }
    for (const x of u.units || []) {
      const c = ll(x);
      const name = `Unit ${x.id || x.unit || x.name || ''} ${x.status || ''}`;
      if (c)
        pt(
          G.cad,
          c,
          name,
          Cesium.Color.HOTPINK,
          `<pre style="white-space:pre-wrap">${esc(JSON.stringify(x, null, 1))}</pre>`,
          9,
        );
      items.push(c ? fly(c, name) : esc(name));
    }
    sect(
      'CAD inc/units',
      `${(i.incidents || []).length} incident(s), ${(u.units || []).length} unit(s)`,
      items,
    );
  }
  async function nws() {
    const [ss, cs, fd] = await Promise.all([
      getJson('storm_status').catch(() => null),
      getJson('county-status').catch(() => null),
      getJson('feeds').catch(() => null),
    ]);
    if (ss)
      sect(
        'Storm status',
        esc(ss.text || `${ss.count} alert(s)`),
        (ss.alerts || []).map((a) =>
          esc(a.event || a.headline || a.title || JSON.stringify(a)),
        ),
      );
    if (cs) {
      const p = cs.power?.county;
      sect(
        'County status',
        `${cs.calls_1h ?? 0} calls/1h, ${cs.calls_24h ?? 0}/24h; tide ${cs.tide?.level_ft ?? '?'} ft${p ? `; power ${p.out}/${p.served} out` : ''}`,
        [
          ...(cs.alerts || []).map((a) =>
            esc(a.event || a.headline || a.title || ''),
          ),
          `Rip current: ${esc(cs.rip_current?.risk || cs.rip_current?.error || 'n/a')}`,
        ],
      );
    }
    clear(G.nws);
    if (fd) {
      const items = [];
      let n = 0;
      for (const k of ['nws', 'waze', 'usgs', 'nj511']) {
        for (const x of fd[k] || []) {
          const c = ll(x);
          if (!c) continue;
          n++;
          const name = `${x.source_label || k}: ${x.title || x.type || ''}`;
          pt(
            G.nws,
            c,
            name,
            Cesium.Color.LIGHTPINK,
            `<p><b>${esc(x.title)}</b></p><p>${esc(x.description)}</p><p>${esc(x.time_ago || x.pub_date || '')}</p>`,
            8,
          );
          items.push(fly(c, name));
        }
      }
      sect(
        'Feeds (NWS/Waze/USGS/511)',
        `${n} item(s) on map; nws ${fd.nws_count ?? 0}${fd.nws_stale ? ' (stale)' : ''}`,
        items,
      );
    }
  }
  async function wx() {
    const [st, w] = await Promise.all([
      getJson('wx/status').catch(() => null),
      getJson('wx/wind'),
    ]);
    clear(G.wind);
    const items = [];
    for (const s of w.stations || []) {
      const c = ll(s);
      if (!c) continue;
      const txt = `${s.mph ?? '?'} mph ${s.dir_deg ?? ''}°${s.gust_mph ? ` G${s.gust_mph}` : ''}`;
      ds.entities.add({
        parent: G.wind,
        name: `Wind: ${s.name} ${txt}`,
        position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 40),
        point: {
          pixelSize: 7,
          color: Cesium.Color.WHITE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `<p><b>${esc(s.name)}</b> (${esc(s.id)})</p><p>${txt}</p><p>${esc(s.time)}</p>`,
      });
      items.push(fly(c, `${s.id} ${txt}`));
    }
    const L = st?.layers || {};
    sect(
      'Wind/WX',
      `${items.length} station(s); tropical: ${esc(L.tropical?.note || (L.tropical?.storms || []).length)}`,
      items,
    );
  }
  async function buoys() {
    const b = await getJson('buoys');
    clear(G.buoy);
    const items = [];
    for (const s of Object.values(b.stations || {})) {
      const c = ll(s);
      if (!c) continue;
      const txt = `wind ${s.wind_speed_ms ?? '?'} m/s @${s.wind_dir_deg ?? '?'}°, waves ${s.wave_height_m ?? '?'} m, water ${s.water_temp_c ?? '?'}°C`;
      pt(
        G.buoy,
        c,
        `Buoy: ${s.name}`,
        Cesium.Color.DODGERBLUE,
        `<p><b>${esc(s.name)}</b> (${esc(s.station)}, ${esc(s.kind)})</p><p>${esc(txt)}</p><p>Air ${s.air_temp_c ?? '?'}°C, ${s.pressure_hpa ?? '?'} hPa</p><p>${esc(s.observed_at)}</p>`,
        9,
        5,
      );
      items.push(fly(c, `${s.name}: ${txt}`));
    }
    sect('Buoys', `${items.length} station(s)`, items);
  }
  async function webcams() {
    if (!fresh('cameras')) return;
    const j = await getJson('webcams');
    clear(G.web);
    const items = [];
    for (const w of j.cameras || []) {
      const c = ll(w);
      if (!c) continue;
      pt(
        G.web,
        c,
        `Webcam: ${w.title}`,
        Cesium.Color.CHARTREUSE,
        `<p><b>${esc(w.title)}</b></p><p>${esc(w.source)} - ${esc(w.road || w.city || '')}</p>${w.image_url ? `<img src="${esc(w.image_url)}" style="max-width:100%">` : ''}${w.player_url ? `<p><a href="${esc(w.player_url)}" target="_blank" rel="noopener">Live player</a></p>` : ''}`,
        7,
        20,
      );
      items.push(fly(c, w.title));
    }
    sect('Webcams', `${items.length} on map`, items);
  }
  async function tfrs() {
    const j = await getJson('aviation/tfrs');
    clear(G.tfr);
    const items = [];
    for (const f of j.features || []) {
      const g = f.geometry;
      const rings =
        g?.type === 'Polygon'
          ? [g.coordinates[0]]
          : g?.type === 'MultiPolygon'
            ? g.coordinates.map((p) => p[0])
            : [];
      const local = rings.filter((r) => r.some(([lo, la]) => inRegion(lo, la)));
      if (!local.length) continue;
      const p = f.properties || {};
      const name = `TFR ${p.notam || p.name || f.id}`;
      for (const r of local)
        ds.entities.add({
          parent: G.tfr,
          name,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(r.flat()),
            material: Cesium.Color.RED.withAlpha(0.18),
            outline: true,
            outlineColor: Cesium.Color.RED,
            classificationType: Cesium.ClassificationType.BOTH,
          },
          description: `<p><b>${esc(name)}</b></p><p>${esc(p.type || '')} ${esc(p.description || p.title || '')}</p><p>${esc(p.low || '')} - ${esc(p.high || '')}</p>`,
        });
      items.push(fly(local[0][0], name));
    }
    sect(
      'TFRs (local)',
      `${items.length} in region / ${(j.features || []).length} US`,
      items,
    );
  }
  async function airports() {
    const j = await getJson('airport_wx');
    clear(G.apt);
    const items = [];
    for (const a of Object.values(j.airports || {})) {
      const c = ll(a);
      if (!c) continue;
      const col = a.color
        ? Cesium.Color.fromCssColorString(a.color)
        : Cesium.Color.GRAY;
      pt(
        G.apt,
        c,
        `${a.icao} ${a.flight_category || ''}`,
        col,
        `<p><b>${esc(a.icao)}</b> ${esc(a.name)} - ${esc(a.flight_category)}</p><p>${a.temp_c ?? '?'}°C, wind ${a.wind_dir_deg ?? '?'}°/${a.wind_speed_kt ?? '?'} kt, vis ${a.visibility_sm ?? '?'} sm</p><p style="font-size:10px">${esc(a.raw)}</p>${a.taf_raw ? `<p style="font-size:10px">${esc(a.taf_raw)}</p>` : ''}`,
        10,
        60,
      );
      items.push(fly(c, `${a.icao} ${a.flight_category || ''}`));
    }
    sect('Airports', `${items.length} METAR(s)`, items);
  }

  const fast = () =>
    Promise.all([
      fresh('traffic')
        ? safe('TomTom', tomtom)
        : Promise.resolve(sect('TomTom', 'stale/down')),
      safe('Radio', radio),
      safe('CAD inc/units', cad),
      fresh('nws')
        ? safe('NWS', nws)
        : Promise.resolve(sect('Storm status', 'stale/down')),
    ]).finally(draw);
  const slow = () =>
    Promise.all([
      safe('Wind/WX', wx),
      safe('Buoys', buoys),
      safe('Webcams', webcams),
      safe('TFRs (local)', tfrs),
      safe('Airports', airports),
    ]).finally(draw);
  fast();
  slow();
  const t = [setInterval(fast, 60_000), setInterval(slow, 300_000)];
  return () => {
    t.forEach(clearInterval);
    box.remove();
  };
}
