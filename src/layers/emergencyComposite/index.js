// src/layers/emergencyComposite/index.js
import { msg, t } from '../../i18n/index.js';
import {
  EMERGENCY_COMPOSITE_ATTRIBUTION,
  EMERGENCY_COMPOSITE_LAYER_ID,
  EMERGENCY_COMPOSITE_LINKS,
  EMERGENCY_COMPOSITE_OVERLAY_COHORT_LIMIT,
  EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID,
  EMERGENCY_COMPOSITE_REFRESH_MS,
} from './policy.js';
import {
  createEmergencyCompositeSummaryEntry,
  getAnalystRecords,
} from './model.js';
export * from './model.js';
export { createEmergencyCompositeSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const fallbackMsg = (text) => text;

/**
 * Own one emergency-composite display and its refresh lifecycle.
 *
 * HazardNow-style composite over official sources that answer: NWS alerts,
 * IPAWS (archive — 24 h delayed by design), Fire Wire CAD, and the fallout
 * plume, on one panel with the official source named on each quadrant.
 * Evacuation guidance appears only as quoted official text (the NWS alert
 * instruction); otherwise the panel says "no evacuation order in effect"
 * — a real steady state, not a missing fetch. Shelter and recovery links
 * are link-outs (Red Cross, NJ OEM, FEMA Disaster Assistance, NRC event
 * reports, Ready.gov): the panel never claims to know whether shelters
 * are open. A quadrant whose source is down shows unavailable with its
 * stale date, never an empty quadrant presented as "all clear".
 */
export function createEmergencyCompositeLayer({
  source,
  overlayHost,
  openUrl = (url) => globalThis.open?.(url, '_blank'),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Emergency composite requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Emergency composite requires an overlay host');
  let _viewer = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const layer = {
    id: EMERGENCY_COMPOSITE_LAYER_ID,
    name: 'Emergency composite',
    icon: '🚨',
    source: EMERGENCY_COMPOSITE_ATTRIBUTION,
    updateInterval: EMERGENCY_COMPOSITE_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Emergency composite layer is already initialized');
      _viewer = viewer;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      rowControlsListener = null;
      overlayHost.setVisible(EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:EmergencyComposite] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      overlayHost.setVisible(EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      overlayHost.clearSource(EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale =
          snapshot?.alerts?.stale === true ||
          snapshot?.incidents?.stale === true ||
          snapshot?.hazmat?.stale === true;
        if (_enabled) {
          overlayHost.setEntries(
            EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID,
            [createEmergencyCompositeSummaryEntry(snapshot)],
            {
              cohortLimit: EMERGENCY_COMPOSITE_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:EmergencyComposite] Updated: ${snapshot?.alerts?.active ?? 0} alerts, ${snapshot?.incidents?.activeIncidents ?? 0} incidents${_stale ? ' (stale)' : ''}`,
        );
        notify();
        return true;
      } catch (e) {
        console.warn('[Data:EmergencyComposite] Fetch error:', e);
        _lastError =
          e?.message || fallbackMsg('Emergency composite unavailable');
        notify();
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      rowControlsListener = null;
    },

    /**
     * Row controls: one chip per shelter/evacuation link-out (links, not
     * data), an info line (one label per quadrant), and one list item per
     * quadrant. Refresh is automatic every 5 minutes; there is nothing
     * else to click.
     */
    getRowControls() {
      const snapshot = _snapshot;
      const info = snapshot
        ? createEmergencyCompositeSummaryEntry(snapshot).info
        : t('No data yet');
      const alerts = snapshot?.alerts ?? null;
      const incidents = snapshot?.incidents ?? null;
      const hazmat = snapshot?.hazmat ?? null;
      const evacuation = snapshot?.evacuation ?? null;
      const alertsText = !alerts?.available
        ? t('Unavailable — the NWS layer has not reported')
        : alerts.active > 0
          ? t(
              '{n} active — {warnings} warnings, {watches} watches, {advisories} advisories',
              {
                n: alerts.active,
                warnings: alerts.warnings,
                watches: alerts.watches,
                advisories: alerts.advisories,
              },
            ) +
            (alerts.topEvents.length > 0
              ? ` · ${alerts.topEvents.join(', ')}`
              : '')
          : t('No active alerts for the county');
      const incidentsText = !incidents?.available
        ? t('Unavailable — the CAD feed has not reported')
        : incidents.quiet
          ? t('Quiet — no active incidents')
          : t('{n} active incidents', { n: incidents.activeIncidents });
      const ipawsItems = hazmat?.ipaws?.items ?? [];
      const hazmatText = !hazmat?.available
        ? t('Unavailable — IPAWS and the plume have not reported')
        : [
            ipawsItems.length > 0
              ? t('IPAWS: {n} alerts (archive, 24 h delayed)', {
                  n: ipawsItems.length,
                })
              : t(
                  'IPAWS: no alerts in the recent window (archive, 24 h delayed)',
                ),
            hazmat.plume?.active
              ? t('Plume scenario active ({n} path nodes)', {
                  n: hazmat.plume.nodes,
                })
              : t('No plume scenario running'),
          ].join(' · ');
      const evacuationText = evacuation?.guidance
        ? `${t('Evacuation guidance — {event}', { event: evacuation.guidance.event ?? msg('National Weather Service') })}: ${evacuation.guidance.text}`
        : t(
            'No evacuation order in effect — see NJ OEM for the latest guidance',
          );
      const listItems = [
        { id: 'alerts', lead: t('Alerts'), text: alertsText },
        { id: 'incidents', lead: t('Incidents'), text: incidentsText },
        { id: 'hazmat', lead: t('Hazmat'), text: hazmatText },
        {
          id: 'shelter-evacuation',
          lead: t('Shelter + evacuation'),
          text: evacuationText,
        },
      ].map((item, index) => ({ ...item, ordinal: index + 1, disabled: true }));
      return {
        chips: EMERGENCY_COMPOSITE_LINKS.map((link) => ({
          id: `open-${link.id}`,
          label: t(link.label),
          title: t(link.note),
          disabled: false,
          onClick: () => openUrl(link.url),
        })),
        info,
        infoTitle: t(
          'Official sources only: NWS alerts, FEMA IPAWS (archive — 24 h delayed by design, a backfill not a real-time alerter), Fire Wire CAD, and the fallout plume. Evacuation guidance appears only as quoted official text. Shelter and recovery links are link-outs — the panel never claims to know whether shelters are open.',
        ),
        legend: null,
        list: {
          ariaLabel: t('Emergency composite quadrants'),
          items: listItems,
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the active NWS alerts and IPAWS items as plain JSON-safe
     * objects for the analyst query engine. On-demand only — zero
     * per-frame cost, no listeners, no caching. Returns [] while disabled
     * or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      if (limit < 1) return [];
      return getAnalystRecords(_snapshot).slice(0, limit);
    },

    getStats() {
      return {
        count:
          (_snapshot?.alerts?.active ?? 0) +
          (_snapshot?.incidents?.activeIncidents ?? 0) +
          (_snapshot?.hazmat?.ipaws?.items?.length ?? 0),
        alertsActive: _snapshot?.alerts?.active ?? 0,
        incidentsActive: _snapshot?.incidents?.activeIncidents ?? 0,
        ipawsItems: _snapshot?.hazmat?.ipaws?.items?.length ?? 0,
        plumeActive: _snapshot?.hazmat?.plume?.active ?? false,
        evacuationGuidance: _snapshot?.evacuation?.guidance ?? null,
        stale: _stale,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
