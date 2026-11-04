// Cape May Dispatch feeds as ordinary data layers: enable, refresh, click card.
import * as Cesium from 'cesium';
import {
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from '../../data/contextStore.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { capeJson, capeJsonOptional } from './client.js';
import {
  mapAirports,
  mapBuoys,
  mapCad,
  mapCameras,
  mapFloodGauges,
  mapNws,
  mapOutages,
  mapRadio,
  mapTfrs,
  mapTomTom,
  mapWebcams,
  mapWind,
} from './model.js';

const SOURCE = 'Cape May Dispatch';
const FAST_MS = 60_000;
const SLOW_MS = 300_000;

async function settle(path, signal) {
  try {
    return { value: await capeJson(path, { signal }), error: null };
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw error;
    return { value: null, error: error?.message || 'cape-network' };
  }
}

const LOADERS = {
  'cape-tomtom': async (signal) => {
    const status = await capeJsonOptional('tomtom/status', { signal });
    if (status && (!status.configured || status.budget?.circuit_open)) {
      return { records: [], error: 'cape-tomtom-unavailable' };
    }
    const traffic = await settle('tomtom/traffic', signal);
    return {
      records: mapTomTom(traffic.value),
      error: traffic.error,
    };
  },
  'cape-flood': async (signal) => {
    const gauges = await settle('flood_gauges', signal);
    const plan = await capeJsonOptional('flood_map/plan', { signal });
    return {
      records: mapFloodGauges(gauges.value),
      error: gauges.error,
      raster: Boolean(plan),
    };
  },
  'cape-cameras': async (signal) => {
    const [traffic, nj511, fx] = await Promise.all([
      settle('traffic_cameras', signal),
      settle('intel/nj511_cameras', signal),
      settle('fx/cameras', signal),
    ]);
    const records = mapCameras({
      traffic: traffic.value,
      nj511: nj511.value,
      fx: fx.value,
    });
    const error =
      !records.length && (traffic.error || nj511.error || fx.error)
        ? traffic.error || nj511.error || fx.error
        : null;
    return { records, error };
  },
  'cape-webcams': async (signal) => {
    const webcams = await settle('webcams', signal);
    return { records: mapWebcams(webcams.value), error: webcams.error };
  },
  'cape-nws': async (signal) => {
    const [hazards, feeds] = await Promise.all([
      settle('hazards', signal),
      settle('feeds', signal),
    ]);
    return {
      records: mapNws(hazards.value, feeds.value),
      error: hazards.error && feeds.error ? hazards.error : null,
    };
  },
  'cape-outages': async (signal) => {
    const outages = await settle('power_outages', signal);
    return { records: mapOutages(outages.value), error: outages.error };
  },
  'cape-cad': async (signal) => {
    const [incidents, units, calls] = await Promise.all([
      settle('cad/incidents', signal),
      settle('cad/units', signal),
      settle('cad/calls', signal),
    ]);
    const records = mapCad({
      incidents: incidents.value,
      units: units.value,
      calls: calls.value,
    });
    const error =
      !records.length && (incidents.error || units.error || calls.error)
        ? incidents.error || units.error || calls.error
        : null;
    return { records, error };
  },
  'cape-buoys': async (signal) => {
    const buoys = await settle('buoys', signal);
    return { records: mapBuoys(buoys.value), error: buoys.error };
  },
  'cape-airports': async (signal) => {
    const airports = await settle('airport_wx', signal);
    return { records: mapAirports(airports.value), error: airports.error };
  },
  'cape-tfrs': async (signal) => {
    const tfrs = await settle('aviation/tfrs', signal);
    return { records: mapTfrs(tfrs.value), error: tfrs.error };
  },
  'cape-wind': async (signal) => {
    const wind = await settle('wx/wind', signal);
    return { records: mapWind(wind.value), error: wind.error };
  },
  'cape-radio': async (signal) => {
    const radio = await settle('radio/feeds', signal);
    const mapped = mapRadio(radio.value || { feeds: [] });
    return {
      records: radio.value ? mapped.records : [],
      count: radio.value ? mapped.count : 0,
      error: radio.error,
    };
  },
};

function hierarchy(ring) {
  return new Cesium.PolygonHierarchy(
    ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
  );
}

function createCapeFeedLayer({ id, name, icon, updateInterval }) {
  let viewer = null;
  let dataSource = null;
  let clickHandler = null;
  let imagery = null;
  let enabled = false;
  let count = 0;
  let lastUpdate = null;
  let lastError = null;
  let loading = false;

  function clearRecords() {
    removeEntityContextsForLayer(id);
    dataSource?.entities.removeAll();
  }

  function addRecord(record) {
    const color = Cesium.Color.fromCssColorString(record.accent || '#9ca3af');
    const position = Cesium.Cartesian3.fromDegrees(
      record.lon,
      record.lat,
      record.height || 0,
    );
    const entity = dataSource.entities.add({
      position,
      point:
        record.kind === 'point'
          ? {
              pixelSize: record.pixelSize || 8,
              color,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          : undefined,
      polyline:
        record.kind === 'polyline'
          ? {
              positions: Cesium.Cartesian3.fromDegreesArray(
                record.positions.flat(),
              ),
              width: 5,
              material: color,
              clampToGround: true,
            }
          : undefined,
      polygon:
        record.kind === 'polygon'
          ? {
              hierarchy: hierarchy(record.positions),
              material: color.withAlpha(record.alpha ?? 0.25),
              outline: true,
              outlineColor: color,
              classificationType: Cesium.ClassificationType.BOTH,
            }
          : undefined,
      ellipse:
        record.kind === 'ellipse'
          ? {
              semiMajorAxis: record.radiusM,
              semiMinorAxis: record.radiusM,
              material: color.withAlpha(record.alpha ?? 0.22),
              classificationType: Cesium.ClassificationType.BOTH,
            }
          : undefined,
    });
    const contextId = `${id}:${record.id}`;
    entity.gevTrackedId = contextId;
    entity.gevDisplayPosition = () => position;
    entity.gevLabelModel = {
      // i18n-ignore
      title: record.title,
      details: record.details,
      accent: record.accent,
    };
    registerEntityContext(entity, {
      id: contextId,
      layerId: id,
      layerName: name,
      source: SOURCE,
      label: record.title,
      latitude: record.lat,
      longitude: record.lon,
      properties: {
        kind: record.kind,
        summary: record.details.slice(0, 6).join(' · '),
      },
    });
  }

  function onClick(click) {
    if (!isPointerFree() || !enabled || !dataSource || !viewer) return;
    const picked = viewer.scene.pick(click.position);
    const entity = picked?.id;
    if (!entity || entity.entityCollection !== dataSource.entities) return;
    selectEntityContext(entity);
    governorRequestRender(`${id}-select`);
  }

  return {
    id,
    name,
    icon,
    source: SOURCE,
    updateInterval,

    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(id);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      if (id === 'cape-flood') {
        try {
          imagery = viewer.imageryLayers.addImageryProvider(
            new Cesium.UrlTemplateImageryProvider({
              url: '/api/cape/flood_map/tile/{z}/{x}/{y}.png',
              rectangle: Cesium.Rectangle.fromDegrees(-75.4, 38.8, -74.3, 39.6),
              minimumLevel: 8,
              maximumLevel: 16,
              credit: SOURCE,
            }),
          );
          imagery.alpha = 0.55;
          imagery.show = false;
        } catch (error) {
          console.warn('Cape flood raster unavailable:', error);
          imagery = null;
        }
      }
      if (!clickHandler && viewer.scene?.canvas) {
        clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        clickHandler.setInputAction(
          onClick,
          Cesium.ScreenSpaceEventType.LEFT_CLICK,
        );
      }
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      enabled = false;
      if (dataSource) dataSource.show = false;
      if (imagery) imagery.show = false;
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !dataSource) return false;
      loading = true;
      try {
        const loaded = await LOADERS[id](signal);
        if (signal?.aborted || !enabled) return false;
        clearRecords();
        for (const record of loaded.records || []) addRecord(record);
        count =
          typeof loaded.count === 'number'
            ? loaded.count
            : loaded.records.length;
        if (imagery) imagery.show = enabled && loaded.raster === true;
        lastUpdate = Date.now();
        lastError = loaded.error || null;
        loading = false;
        governorRequestRender(`${id}-update`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        lastError = error?.message || 'cape-network';
        loading = false;
        return true;
      }
    },

    destroy(host) {
      enabled = false;
      clearRecords();
      clickHandler?.destroy();
      clickHandler = null;
      if (imagery) {
        host?.imageryLayers?.remove(imagery, true);
        imagery = null;
      }
      if (dataSource) {
        host?.dataSources?.remove(dataSource, true);
        dataSource = null;
      }
      viewer = null;
      count = 0;
      lastUpdate = null;
      lastError = null;
      loading = false;
    },

    getStats() {
      return {
        count,
        lastUpdate,
        error: lastError,
        loading,
        source: SOURCE,
      };
    },
  };
}

/** Every Cape feed that belongs in DATA LAYERS, in panel order. */
export function createCapeLayers() {
  return [
    createCapeFeedLayer({
      id: 'cape-cad',
      name: 'CAD incidents',
      icon: '✚',
      updateInterval: FAST_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-tomtom',
      name: 'TomTom incidents',
      icon: '⚠',
      updateInterval: FAST_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-cameras',
      name: 'Cape cameras',
      icon: '◉',
      updateInterval: SLOW_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-webcams',
      name: 'Webcams',
      icon: '◎',
      updateInterval: SLOW_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-flood',
      name: 'Flood gauges',
      icon: '≈',
      updateInterval: FAST_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-nws',
      name: 'NWS alerts',
      icon: '⚑',
      updateInterval: FAST_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-outages',
      name: 'Power outages',
      icon: '⏻',
      updateInterval: FAST_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-wind',
      name: 'Wind stations',
      icon: '⌁',
      updateInterval: SLOW_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-buoys',
      name: 'Buoys',
      icon: '⚓',
      updateInterval: SLOW_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-airports',
      name: 'Airport weather',
      icon: '✈',
      updateInterval: SLOW_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-tfrs',
      name: 'Local TFRs',
      icon: '▣',
      updateInterval: SLOW_MS,
    }),
    createCapeFeedLayer({
      id: 'cape-radio',
      name: 'Dispatch radio',
      icon: '◈',
      updateInterval: FAST_MS,
    }),
  ];
}
