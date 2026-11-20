import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function panelOrder() {
  const source = readFileSync(
    new URL('./layerPanel.js', import.meta.url),
    'utf8',
  );
  const declarations = source.slice(
    source.indexOf('const PANEL_GROUPS ='),
    source.indexOf('const PANEL_POSITIONS ='),
  );
  return JSON.parse(
    runInNewContext(
      `const msg = (text) => text;\n${declarations}\nJSON.stringify(PANEL_ORDER)`,
    ),
  );
}

test('Roads & Driving opens with Street Traffic and keeps Transit just before Bike Share', () => {
  const order = panelOrder();
  const roads = order
    .filter(({ label }) => label === 'Roads & Driving')
    .map(({ id }) => id);
  assert.equal(roads[0], 'traffic');
  assert.equal(roads[roads.indexOf('transit') + 1], 'bikeshare');
  assert.equal(order.filter(({ id }) => id === 'transit').length, 1);
});

test('everything about aviation on the map sits in Aviation, and Weather sits between Aviation and Ocean & Coast', () => {
  const order = panelOrder();
  const groupOf = (id) => order.find((row) => row.id === id)?.label;
  // FAA Status draws ellipses at affected airports and VDL2 pins datalink
  // messages at aircraft positions, so both stay here in their old places;
  // only Airport Radio left, for the Local panel's Calls tab.
  assert.deepEqual(
    order.filter(({ label }) => label === 'Aviation').map(({ id }) => id),
    [
      'flights',
      'military',
      'local-adsb',
      'faa-status',
      'cape-tfrs',
      'military-areas',
      'drone-airspace',
      'sigmet',
      'airport-weather',
      'vdl2',
      'gpsjam-daily',
    ],
  );
  assert.equal(groupOf('airport-radio'), undefined);
  const labels = [...new Set(order.map(({ label }) => label))];
  assert.deepEqual(labels.slice(0, 3), [
    'Aviation',
    'Weather',
    'Ocean & Coast',
  ]);
  assert.equal(groupOf('wildlife-sightings'), 'Ocean & Coast');
});

test('every listed layer appears once and none is also hidden', async () => {
  const { PANEL_HIDDEN_LAYER_IDS, isPanelHiddenLayer } =
    await import('./panelHiddenLayers.js');
  const ids = panelOrder().map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    ids.filter((id) => isPanelHiddenLayer(id)),
    [],
  );
  assert.equal(
    new Set(PANEL_HIDDEN_LAYER_IDS).size,
    PANEL_HIDDEN_LAYER_IDS.length,
  );
  assert.equal(isPanelHiddenLayer('cape-nws'), true);
  assert.equal(isPanelHiddenLayer('nws-alerts'), false);
});

test('Data Layers lists only map layers: readouts, lists and briefings live in the Local panel', async () => {
  const { ELSEWHERE, isElsewhereLayer } =
    await import('./panelElsewhereLayers.js');
  const order = panelOrder();
  assert.deepEqual(
    order.filter(({ id }) => isElsewhereLayer(id)).map(({ id }) => id),
    [],
  );
  assert.equal(Object.keys(ELSEWHERE).length, 13);
  for (const id of ['faa-status', 'vdl2'])
    assert.ok(
      order.some((row) => row.id === id),
      `${id} draws on the map and stays listed`,
    );
  assert.deepEqual(
    [...new Set(order.map(({ label }) => label))],
    [
      'Aviation',
      'Weather',
      'Ocean & Coast',
      'Roads & Driving',
      'Public Safety',
      'Hazards',
      'Space',
      'Infrastructure',
      'Utilities',
    ],
    'Views & Imagery and Briefings are gone',
  );
  assert.deepEqual(
    order.filter(({ label }) => label === 'Utilities'),
    ['directions', 'osm-places', 'street-level', 'recent-imagery'].map(
      (id) => ({ id, label: 'Utilities', containerId: 'utilities-toggles' }),
    ),
  );
});

test('partial feed controls distinguish incomplete records from stale data and outages', async () => {
  const { LayerPanel, layerFeedState, presentLayerToggle } =
    await import('./layerPanel.js');
  const layer = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    source: 'AISStream',
    enabled: true,
    stats: {
      partial: true,
      stale: false,
      count: 2,
      acceptedRowCount: 2,
      rawRowCount: 3,
      lastUpdate: Date.now(),
    },
  };
  const panel = LayerPanel.prototype;
  let toggle = presentLayerToggle(layer);
  assert.equal(toggle.text, 'PARTIAL');
  assert.equal(toggle.feedState, 'partial');
  assert.equal(toggle.classes['feed-partial'], true);
  assert.equal(toggle.classes['feed-stale'], false);
  assert.match(toggle.ariaLabel, /PARTIAL/);
  assert.match(
    panel._buildMetaText(layer),
    /^PARTIAL · AISStream · 2 of 3 records accepted · /,
  );
  assert.match(
    panel._buildMetaText({
      ...layer,
      stats: { ...layer.stats, rawRowCount: 2 },
    }),
    /incomplete snapshot/,
  );
  assert.equal(layerFeedState({ ...layer.stats, stale: true }), 'stale');
  assert.equal(
    layerFeedState({ ...layer.stats, error: 'Connection lost' }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ ...layer.stats, status: 'unavailable' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ ...layer.stats, loading: true }), 'loading');
  layer.stats = { ...layer.stats, partial: false };
  toggle = presentLayerToggle(layer);
  assert.equal(toggle.text, 'ON');
  assert.equal(toggle.classes['feed-partial'], false);
  layer.enabled = false;
  assert.equal(presentLayerToggle(layer).text, 'OFF');
});

test('a stale row dates cached data by its oldest tile, not the last load', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const panel = LayerPanel.prototype;
  const layer = {
    id: 'traffic',
    name: 'Street Traffic',
    source: 'TomTom',
    enabled: true,
    stats: {
      mode: 'live',
      stale: true,
      count: 4,
      lastUpdate: Date.now(),
      oldestTileAt: Date.now() - 3 * 3600_000,
    },
  };
  assert.match(panel._buildMetaText(layer), /^STALE · TomTom · 3h ago$/);
  delete layer.stats.oldestTileAt;
  assert.match(panel._buildMetaText(layer), /^STALE · TomTom · just now$/);
});

test('readout rows contain only toggles and metadata; ordinary rows retain controls', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  document.body.replaceChildren();
  const container = document.body.appendChild(document.createElement('div'));
  const find = (id) => container.querySelector(`[data-layer-id="${id}"]`);
  const ids = [
    'wind',
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'weather-cyclones',
    'other',
  ];
  let refresh;
  const layers = ids.map((id) => ({
    id,
    name: id,
    icon: '*',
    source: 'Source',
    enabled: true,
    showInTogglePanel: true,
    stats: {},
  }));
  const calls = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: () => true,
    setEnabled: (...args) => calls.push(args),
    setLayerParams: (...args) => calls.push(args),
    hasRowControls: () => true,
    subscribeRowControls: (_id, callback) => {
      refresh = callback;
    },
    getRowControls: (id) => ({
      readout: id !== 'other',
      summary: { status: 'Loading' },
      info: 'Detailed time',
      chips: [{ id: 'config', label: 'Soft', params: { opacity: 'light' } }],
      legend: [{ label: 'Rain', color: '#abcdef' }],
      list: {
        items: [{ id: 'storm', text: 'Storm', params: { focus: true } }],
      },
    }),
  });
  try {
    panel.mount(container);
    for (const id of ids.slice(0, -1)) {
      const row = find(id);
      assert.equal(row.children.length, 2);
      assert.ok(row.querySelector('.data-name'));
      assert.ok(row.querySelector('.data-toggle-meta'));
      for (const cls of [
        'data-toggle-chip',
        'data-count',
        'data-toggle-controls',
        'data-toggle-controls-status',
        'data-row-list',
      ])
        assert.ok(!row.querySelector(`.${cls}`), cls);
      row.querySelector('.data-toggle-btn').click();
    }
    assert.deepEqual(
      calls.map(([id]) => id),
      ids.slice(0, -1),
    );
    const ordinary = find('other');
    assert.equal(
      ordinary.querySelector('.data-toggle-controls-info').textContent,
      'Detailed time',
    );
    assert.ok(ordinary.querySelector('.data-toggle-legend-item'));
    ordinary.querySelector('.data-toggle-chip').click();
    assert.deepEqual(calls.at(-1), [
      'other',
      { opacity: 'light' },
      { origin: 'user' },
    ]);
    assert.equal(typeof refresh, 'function');
  } finally {
    panel.destroy();
    document.body.replaceChildren();
  }
});

test('the Recent Imagery readout mounts in its rail body like the weather readout and is rebuilt or released with the panel', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  document.body.replaceChildren();
  const container = document.body.appendChild(document.createElement('div'));
  const body = document.body.appendChild(document.createElement('div'));
  body.id = 'recent-imagery-panel-body';
  const mounted = [];
  const factory = (container) => {
    const readout = {
      container,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
    mounted.push(readout);
    return readout;
  };
  const panel = new LayerPanel({
    getLayers: () => [],
    isEnabled: () => false,
    setEnabled() {},
    setLayerParams() {},
    hasRowControls: () => false,
    subscribeRowControls() {},
    getRowControls: () => null,
  });
  try {
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 0, 'no body before the panel mounts');
    panel.mount(container);
    assert.equal(mounted.length, 1);
    assert.ok(mounted[0].container === body);
    panel.mount(container);
    assert.equal(mounted[0].destroyed, true, 'a remount rebuilds it');
    assert.equal(mounted.length, 2);
    panel.attachRecentImagery(null);
    assert.equal(mounted[1].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3);
    panel.destroy();
    assert.equal(mounted[2].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3, 'a destroyed panel mounts nothing');
  } finally {
    panel.destroy();
    document.body.replaceChildren();
  }
});

test('an omitted source is visibly unavailable and cannot be toggled on', async () => {
  const { presentLayerToggle } = await import('./layerPanel.js');
  const layer = {
    id: 'flights',
    name: 'Flights',
    enabled: false,
    stats: {
      sourceUnavailable: true,
      status: 'unavailable',
      error: 'Data source not configured: flights',
    },
  };
  const toggle = presentLayerToggle(layer);
  assert.equal(toggle.text, 'UNAVAILABLE');
  assert.equal(toggle.ariaDisabled, true);
  assert.match(toggle.title, /not configured/);
  assert.equal(
    presentLayerToggle({ ...layer, enabled: true }).ariaDisabled,
    false,
    'an active layer can always be switched off',
  );
});

test('row text keeps a hyphenated code whole and never starts a line with the separator', async () => {
  const { rowTextRuns } = await import('./layerRowText.js');
  const text = (runs) => runs.map((run) => run.text).join('');
  const kept = (runs) => runs.filter((run) => run.keep).map((run) => run.text);

  const name = rowTextRuns('Локальный ADS-B');
  assert.equal(text(name), 'Локальный ADS-B');
  assert.deepEqual(kept(name), ['ADS-B']);

  const meta = rowTextRuns('UNAVAILABLE · NASA FIRMS · LIVE · KEY REQUIRED');
  assert.equal(text(meta), 'UNAVAILABLE · NASA FIRMS · LIVE · KEY REQUIRED');
  assert.deepEqual(kept(meta), [' ·', ' ·', ' ·']);
  assert.ok(
    meta.every((run) => !run.text.startsWith('·')),
    'the space before each dot is held to the piece it closes',
  );

  assert.equal(rowTextRuns('Satellites'), null, 'plain text needs no runs');

  const compound = rowTextRuns('Kartierte ALPR-Kameras · ADS-B-Flüge');
  assert.equal(text(compound), 'Kartierte ALPR-Kameras · ADS-B-Flüge');
  assert.deepEqual(
    kept(compound),
    [' ·', 'ADS-B'],
    'a compound may break at its hyphen; the code inside it stays whole',
  );

  const long = rowTextRuns('see https-proxy-endpoint-config-x');
  assert.deepEqual(
    kept(long || []),
    [],
    'a long hyphenated run may still wrap',
  );
});

test('the unavailable chip may abbreviate, but its accessible name keeps the full state', async () => {
  const { presentLayerToggle } = await import('./layerPanel.js');
  const toggle = presentLayerToggle({
    id: 'local-firms',
    name: 'FIRMS Active Fires',
    enabled: false,
    stats: { sourceUnavailable: true, error: 'KEY REQUIRED' },
  });
  assert.equal(toggle.text, 'UNAVAILABLE');
  assert.equal(toggle.feedState, 'unavailable');
  assert.match(toggle.ariaLabel, /^Active Fires: UNAVAILABLE\./);
});

test('the Weather readout receives enabled air-quality alongside weather layers', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const layers = ['wind', 'air-quality', 'other'].map((id) => ({
    id,
    icon: '*',
    enabled: true,
  }));
  layers.push({ id: 'weather-radar', icon: '*', enabled: false });
  const panel = new LayerPanel({
    getLayers: () => layers,
    getRowControls: (id) => ({ readout: true, summary: { label: id } }),
  });
  let entries = null;
  panel._weatherPanel = {
    update: (next) => {
      entries = next;
    },
  };
  panel._refreshWeatherPanel();
  assert.deepEqual(
    entries.map(({ id, summary }) => [id, summary.label]),
    [
      ['wind', 'wind'],
      ['air-quality', 'air-quality'],
    ],
  );
});

// The Utilities group renders in the Utilities panel's list; Data Layers keeps
// the rest.
async function utilitiesFixture({
  withUtilities = true,
  ids = ['satellites', 'directions', 'flights', 'cape-nws'],
  getRowControls = () => null,
} = {}) {
  const { LayerPanel } = await import('./layerPanel.js');
  document.body.replaceChildren();
  const container = document.body.appendChild(document.createElement('div'));
  container.id = 'data-toggles';
  const utilities = document.createElement('div');
  utilities.id = 'utilities-toggles';
  if (withUtilities) document.body.append(utilities);
  const layers = ids.map((id) => ({
    id,
    name: id,
    icon: '*',
    source: 'S',
    enabled: false,
    showInTogglePanel: true,
    stats: {},
  }));
  const calls = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (id) => layers.find((layer) => layer.id === id).enabled,
    setEnabled: (...args) => calls.push(['setEnabled', ...args]),
    setLayerParams: (...args) => calls.push(['setLayerParams', ...args]),
    getRowControls,
    hasRowControls: (id) => getRowControls(id) !== null,
    subscribeRowControls: () => () => {},
  });
  panel.mount(container);
  const headings = (root) =>
    [...root.querySelectorAll('.data-layer-group-heading')].map((node) =>
      node.textContent.trim(),
    );
  const rowIds = (root) =>
    [...root.querySelectorAll('[data-layer-id]')].map(
      (node) => node.dataset.layerId,
    );
  const restore = () => {
    panel.destroy();
    document.body.replaceChildren();
  };
  const layer = (id) => layers.find((entry) => entry.id === id);
  return {
    container,
    utilities,
    panel,
    layers,
    layer,
    calls,
    headings,
    rowIds,
    restore,
  };
}

test('Directions renders in the Utilities list without a heading, and a hidden layer that is off gets no row', async () => {
  const { container, utilities, panel, headings, rowIds, restore } =
    await utilitiesFixture();
  try {
    assert.deepEqual(rowIds(utilities), ['directions']);
    assert.deepEqual(headings(utilities), []);
    assert.deepEqual(rowIds(container), ['flights', 'satellites']);
    assert.deepEqual(headings(container), ['Aviation', 'Space']);
    panel.mount(container);
    assert.deepEqual(
      rowIds(utilities),
      ['directions'],
      'a remount replaces it',
    );
    panel.destroy();
    assert.deepEqual(rowIds(utilities), [], 'destroy releases both lists');
  } finally {
    restore();
  }
});

test('a refresh updates the Directions row in the Utilities list', async () => {
  const { utilities, panel, layers, restore } = await utilitiesFixture();
  try {
    const toggle = () =>
      utilities.querySelector('[data-layer-id="directions"] .data-toggle-btn');
    assert.ok(!toggle().classList.contains('active'));
    layers.find(({ id }) => id === 'directions').enabled = true;
    panel._refreshTogglePanel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(toggle().classList.contains('active'));
  } finally {
    restore();
  }
});

test('without the Utilities list, Directions stays in Data Layers under Utilities', async () => {
  const { container, headings, rowIds, restore } = await utilitiesFixture({
    withUtilities: false,
  });
  try {
    assert.deepEqual(rowIds(container), [
      'flights',
      'satellites',
      'directions',
    ]);
    assert.deepEqual(headings(container), ['Aviation', 'Space', 'Utilities']);
  } finally {
    restore();
  }
});

test('a hidden layer that is on keeps a row so it can be switched off', async () => {
  const { container, panel, layers, rowIds, restore } =
    await utilitiesFixture();
  try {
    layers.find(({ id }) => id === 'cape-nws').enabled = true;
    panel.mount(container);
    assert.ok(rowIds(container).includes('cape-nws'));
  } finally {
    restore();
  }
});

test('Street Level and Recent Imagery switch on from the Utilities list, after Directions and Places', async () => {
  const chips = [
    { id: 'hls', label: 'HLS', params: { source: 'hls' } },
    { id: 'viirs', label: 'VIIRS', params: { source: 'viirs' } },
  ];
  const { container, utilities, calls, headings, rowIds, restore } =
    await utilitiesFixture({
      ids: [
        'recent-imagery',
        'satellites',
        'street-level',
        'directions',
        'osm-places',
        'flights',
      ],
      getRowControls: (id) => (id === 'recent-imagery' ? { chips } : null),
    });
  try {
    assert.deepEqual(rowIds(utilities), [
      'directions',
      'osm-places',
      'street-level',
      'recent-imagery',
    ]);
    assert.deepEqual(headings(utilities), []);
    assert.deepEqual(rowIds(container), ['flights', 'satellites']);
    assert.deepEqual(headings(container), ['Aviation', 'Space']);
    for (const id of ['street-level', 'recent-imagery'])
      utilities
        .querySelector(`[data-layer-id="${id}"] .data-toggle-btn`)
        .click();
    assert.deepEqual(calls, [
      ['setEnabled', 'street-level', true, { origin: 'user' }],
      ['setEnabled', 'recent-imagery', true, { origin: 'user' }],
    ]);
  } finally {
    restore();
  }
  // Once on, Recent Imagery's source chips work from the Utilities row.
  const on = await utilitiesFixture({
    ids: ['recent-imagery'],
    getRowControls: (id) => (id === 'recent-imagery' ? { chips } : null),
  });
  try {
    on.layer('recent-imagery').enabled = true;
    on.panel.mount(on.container);
    const row = on.utilities.querySelector('[data-layer-id="recent-imagery"]');
    assert.deepEqual(
      [...row.querySelectorAll('.data-toggle-chip')].map(
        (node) => node.dataset.chipId,
      ),
      ['hls', 'viirs'],
    );
    row.querySelector('[data-chip-id="viirs"]').click();
    assert.deepEqual(on.calls.at(-1), [
      'setLayerParams',
      'recent-imagery',
      { source: 'viirs' },
      { origin: 'user' },
    ]);
  } finally {
    on.restore();
  }
});

test('without the Utilities list, Street Level and Recent Imagery stay in Data Layers under Utilities', async () => {
  const { container, headings, rowIds, restore } = await utilitiesFixture({
    withUtilities: false,
    ids: ['recent-imagery', 'street-level', 'directions', 'flights'],
  });
  try {
    assert.deepEqual(rowIds(container), [
      'flights',
      'directions',
      'street-level',
      'recent-imagery',
    ]);
    assert.deepEqual(headings(container), ['Aviation', 'Utilities']);
  } finally {
    restore();
  }
});

async function settle(panel) {
  panel._refreshTogglePanel();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('a Local-panel layer gets a row under LOCAL only while it is on, so it can be switched off', async () => {
  const { container, panel, layer, calls, headings, rowIds, restore } =
    await utilitiesFixture({
      ids: [
        'cape-nws',
        'fuel-prices',
        'flights',
        'airport-radio',
        'daily-brief',
        'vdl2',
      ],
    });
  try {
    // VDL2 draws on the map, so it is listed in Aviation even while off.
    assert.deepEqual(rowIds(container), ['flights', 'vdl2']);
    assert.deepEqual(headings(container), ['Aviation']);
    // Switched on after the rows were built: the Local panel, a share link
    // or a voice command.
    layer('airport-radio').enabled = true;
    layer('fuel-prices').enabled = true;
    await settle(panel);
    assert.deepEqual(rowIds(container), [
      'flights',
      'vdl2',
      'fuel-prices',
      'airport-radio',
    ]);
    assert.deepEqual(headings(container), ['Aviation', 'LOCAL']);
    container
      .querySelector('[data-layer-id="airport-radio"] .data-toggle-btn')
      .click();
    assert.deepEqual(calls.at(-1), [
      'setEnabled',
      'airport-radio',
      false,
      { origin: 'user' },
    ]);
    layer('airport-radio').enabled = false;
    await settle(panel);
    assert.deepEqual(rowIds(container), ['flights', 'vdl2', 'fuel-prices']);
    assert.deepEqual(headings(container), ['Aviation', 'LOCAL']);
    // A plain repaint with nothing switched keeps the rows as they are.
    await settle(panel);
    assert.deepEqual(rowIds(container), ['flights', 'vdl2', 'fuel-prices']);
  } finally {
    restore();
  }
});

test('a hidden layer switched on after mount gets no row, even when a Local-panel switch rebuilds the rows', async () => {
  // Scanner audio switches on the hidden 'radio' layer; a Data Layers row for
  // it would let Data Layers switch the scanner audio off.
  const { container, panel, layer, headings, rowIds, restore } =
    await utilitiesFixture({
      ids: ['radio', 'cape-nws', 'flights', 'fuel-prices'],
    });
  try {
    assert.deepEqual(rowIds(container), ['flights']);
    layer('radio').enabled = true;
    await settle(panel);
    assert.deepEqual(rowIds(container), ['flights']);
    // A Local-panel layer switching on rebuilds the rows; the hidden layer
    // that is now on still gets none.
    layer('fuel-prices').enabled = true;
    await settle(panel);
    assert.deepEqual(rowIds(container), ['flights', 'fuel-prices']);
    assert.deepEqual(headings(container), ['Aviation', 'LOCAL']);
  } finally {
    restore();
  }
  // A hidden layer that was on at mount keeps its row, as before, through
  // being switched off and through a Local-panel rebuild.
  const on = await utilitiesFixture({
    ids: ['cape-nws', 'flights', 'fuel-prices'],
  });
  try {
    on.layer('cape-nws').enabled = true;
    on.panel.mount(on.container);
    assert.deepEqual(on.rowIds(on.container), ['flights', 'cape-nws']);
    on.layer('cape-nws').enabled = false;
    await settle(on.panel);
    assert.deepEqual(on.rowIds(on.container), ['flights', 'cape-nws']);
    on.layer('fuel-prices').enabled = true;
    await settle(on.panel);
    assert.deepEqual(on.rowIds(on.container), [
      'flights',
      'fuel-prices',
      'cape-nws',
    ]);
    assert.deepEqual(on.headings(on.container), [
      'Aviation',
      'LOCAL',
      'Other layers',
    ]);
  } finally {
    on.restore();
  }
});

test("a Local-panel rebuild keeps another row's info line in place", async () => {
  let info = 'Loading positions';
  const { container, panel, layer, rowIds, restore } = await utilitiesFixture({
    ids: ['flights', 'fuel-prices'],
    getRowControls: (id) =>
      id === 'flights'
        ? { chips: [{ id: 'all', label: 'All', active: true }], info }
        : null,
  });
  const infoLine = () =>
    container.querySelector(
      '[data-layer-id="flights"] .data-toggle-controls-info',
    );
  try {
    layer('flights').enabled = true;
    await settle(panel);
    assert.equal(infoLine()?.textContent, 'Loading positions');
    // Once shown, the line stays (hidden while empty) so the row does not jump.
    info = '';
    await settle(panel);
    assert.ok(infoLine(), 'the emptied info line keeps its place');
    assert.equal(infoLine().hidden, true);
    layer('fuel-prices').enabled = true;
    await settle(panel);
    assert.deepEqual(rowIds(container), ['flights', 'fuel-prices']);
    assert.ok(infoLine(), 'a rebuild for a Local-panel row keeps it too');
    assert.equal(infoLine().hidden, true);
  } finally {
    restore();
  }
});
