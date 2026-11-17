// src/layers/countyRisk/index.js
import { msg, t } from '../../i18n/index.js';
import { COUNTY_RISK_BANDS } from '../../data/countyRisk.js';
import {
  COUNTY_RISK_ATTRIBUTION,
  COUNTY_RISK_BAND_COLORS,
  COUNTY_RISK_COMPONENT_LABELS,
  COUNTY_RISK_LAYER_ID,
  COUNTY_RISK_OVERLAY_COHORT_LIMIT,
  COUNTY_RISK_OVERLAY_SOURCE_ID,
  COUNTY_RISK_REFRESH_MS,
} from './policy.js';
import {
  createCountyRiskOverlayEntries,
  createCountyRiskSummaryEntry,
  mapAnalystRecord,
} from './model.js';
import { formatComponentLine } from './records.js';
export * from './model.js';
export { createCountyRiskSource } from './source.js';
export * from './records.js';
export * from './inputs.js';

/**
 * Own one county risk display and its refresh lifecycle.
 *
 * The score is rules-computed from the live layer states (NWS alerts,
 * tides, outages, GDACS, quakes, fires, lightning, space weather) — never
 * a bare LLM number. The map shows a county summary label plus one label
 * per available component; a missing component is listed on the summary,
 * never counted as zero. A band change is logged with the component
 * values that caused it. On a failed refresh the last good score stays
 * drawn, marked stale.
 */
export function createCountyRiskLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('County risk requires a snapshot source');
  if (!overlayHost) throw new TypeError('County risk requires an overlay host');
  let _viewer = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _prevBand = null;
  let _lastTransition = null;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const layer = {
    id: COUNTY_RISK_LAYER_ID,
    name: 'County risk',
    icon: '🛡️',
    source: COUNTY_RISK_ATTRIBUTION,
    updateInterval: COUNTY_RISK_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('County risk layer is already initialized');
      _viewer = viewer;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _prevBand = null;
      _lastTransition = null;
      rowControlsListener = null;
      overlayHost.setVisible(COUNTY_RISK_OVERLAY_SOURCE_ID, false);
      console.log('[Data:CountyRisk] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      overlayHost.setVisible(COUNTY_RISK_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      overlayHost.clearSource(COUNTY_RISK_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(COUNTY_RISK_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = snapshot?.stale === true;
        const band = snapshot?.band?.label ?? null;
        if (band !== _prevBand) {
          const from = _prevBand;
          _lastTransition = {
            from,
            to: band,
            at: Date.now(),
            score: snapshot?.score ?? null,
            components: Object.fromEntries(
              Object.entries(snapshot?.components ?? {}).map(([key, c]) => [
                key,
                c?.available ? c.value : null,
              ]),
            ),
          };
          console.info(
            `[Data:CountyRisk] Band ${from ?? 'none'} → ${band ?? 'none'} (score ${snapshot?.score ?? 'n/a'})`,
            _lastTransition.components,
          );
          _prevBand = band;
        }
        if (_enabled) {
          overlayHost.setEntries(
            COUNTY_RISK_OVERLAY_SOURCE_ID,
            [
              createCountyRiskSummaryEntry({ snapshot }),
              ...createCountyRiskOverlayEntries({ snapshot }),
            ],
            {
              cohortLimit: COUNTY_RISK_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:CountyRisk] Updated: ${snapshot?.score ?? 'n/a'} (${band ?? 'no band'})${_stale ? ' (stale)' : ''}`,
        );
        notify();
        return true;
      } catch (e) {
        console.warn('[Data:CountyRisk] Fetch error:', e);
        _lastError = e?.message || msg('County risk unavailable');
        notify();
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(COUNTY_RISK_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(COUNTY_RISK_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _prevBand = null;
      _lastTransition = null;
      rowControlsListener = null;
    },

    /**
     * Row controls: the band legend plus one row per component with its
     * value and the rule that set it. No chips — the score refreshes
     * automatically every 5 minutes; there is nothing to click.
     */
    getRowControls() {
      const snapshot = _snapshot;
      const info =
        snapshot?.score === null || snapshot?.score === undefined
          ? t('County risk unavailable — no input layer has data yet')
          : `${t('County risk')}: ${snapshot.band?.label ?? ''} ${snapshot.score}/100` +
            (snapshot.stale ? ` · ${t('some inputs are stale')}` : '') +
            (snapshot.missingInputs?.length > 0
              ? ` · ${t('Missing')}: ${snapshot.missingInputs
                  .map((name) => COUNTY_RISK_COMPONENT_LABELS[name] ?? name)
                  .join(', ')}`
              : '');
      const listItems = Object.entries(snapshot?.components ?? {}).map(
        ([key, component], index) => ({
          id: key,
          ordinal: index + 1,
          lead: COUNTY_RISK_COMPONENT_LABELS[key] ?? key,
          text: component?.available
            ? formatComponentLine(
                COUNTY_RISK_COMPONENT_LABELS[key] ?? key,
                component,
              )
            : t('No data'),
          disabled: true,
        }),
      );
      return {
        chips: [],
        info,
        infoTitle: t(
          'Rules-based score from live layer states. Thresholds are draft — William sets the final numbers. A missing input is excluded and its weight renormalized, never counted as zero. All inputs missing means no score at all, never a default 0 shown as all clear.',
        ),
        legend: COUNTY_RISK_BANDS.map((band) => ({
          label: t(band.label),
          color: COUNTY_RISK_BAND_COLORS[band.label],
          count: null,
        })),
        list:
          listItems.length > 0
            ? {
                ariaLabel: t('Risk components'),
                items: listItems,
              }
            : null,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the score as a plain JSON-safe object for the analyst
     * query engine. On-demand only — zero per-frame cost, no listeners,
     * no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      if (limit < 1) return [];
      return [mapAnalystRecord(_snapshot, 0)];
    },

    getStats() {
      return {
        count: _snapshot ? 1 : 0,
        score: _snapshot?.score ?? null,
        band: _snapshot?.band?.label ?? null,
        stale: _stale,
        missingInputs: [...(_snapshot?.missingInputs ?? [])],
        lastTransition: _lastTransition,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
