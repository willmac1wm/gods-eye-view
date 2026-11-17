// src/layers/hifldInstallations/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  HIFLD_INSTALLATIONS_OVERLAY_COHORT_LIMIT,
  HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID,
} from './policy.js';
import { sortHifldSitesForOverlay } from './records.js';

export { HIFLD_INSTALLATIONS_OVERLAY_COHORT_LIMIT };

/**
 * Overlay accent by MIRTA status: active green, closed gray, anything
 * else amber. The status code is MIRTA's own, shown verbatim — never
 * re-scored here. The freeze note lives in the panel, not on the pin.
 */
export function statusAccent(status) {
  if (status === 'act') return '#7cff9b';
  if (status === 'clsd') return '#9aa5ad';
  return '#ffc46b';
}

/**
 * One label per site, NJ/DE first then active, capped at 100 (the
 * panel lists all 744). A site's position is the MIRTA point; the
 * title is the site name as inventoried.
 */
export function createHifldOverlayEntries({ sites = [] } = {}) {
  return sortHifldSitesForOverlay(sites)
    .slice(0, HIFLD_INSTALLATIONS_OVERLAY_COHORT_LIMIT)
    .map((site) => ({
      id: `${HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID}-${site.id}`,
      position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
      variant: 'label',
      title: `🪖 ${site.name}`,
      subtitle: `${msg('Military installation')} · ${site.state.toUpperCase()} · ${site.status}`,
      accent: Cesium.Color.fromCssColorString(
        statusAccent(site.status),
      ).toCssColorString(),
      priority: 1,
      collisionGroup: 'ambient-label',
      paintLane: 'ambient-label',
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    }));
}

/** Analyst seam. Pure — no Cesium types. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    kind: 'installation',
    id: text(raw?.id) || `HIFLD-${String(index).padStart(4, '0')}`,
    name: text(raw?.name),
    state: text(raw?.state),
    status: text(raw?.status),
    component: text(raw?.component),
    joint: raw?.joint === true,
    installationId: text(raw?.installationId),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
  };
}
