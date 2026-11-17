// src/layers/readiness/index.js
import { t } from '../../i18n/index.js';
import {
  READINESS_ATTRIBUTION,
  READINESS_DEFAULT_HOUSEHOLD_SIZE,
  READINESS_HOUSEHOLD_SIZES,
  READINESS_LAYER_ID,
  READINESS_OVERLAY_SOURCE_ID,
  READINESS_REFRESH_MS,
} from './policy.js';
import { createReadinessSummaryEntry, mapAnalystRecord } from './model.js';
import {
  READINESS_CHECKLISTS,
  goBagSummary,
  readinessRows,
} from './records.js';
import { createReadinessStore } from './store.js';
export * from './model.js';
export { createReadinessSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const fallbackMsg = (text) => text;

/**
 * Own one readiness display and its refresh lifecycle.
 *
 * The checklists are static (bundled checklists.json, curated from
 * Ready.gov / FEMA, public domain); the urgency is live — the source
 * reads the NWS, tides, outages, drought, and space-weather layers and
 * marks items "due now" when their driver is active. The done-state is
 * local-only (localStorage; the server never sees a household's prep
 * state) and toggles by clicking a list item (the historyReplay params
 * lane: list items carry { toggleItem } and the layer applies it in
 * setParams — no network call anywhere in the toggle path). The go-bag
 * builder is 3 days × household size (Ready.gov: 1 gallon of water per
 * person per day). On a failed refresh the last good drivers stay drawn,
 * marked stale; a missing driver layer falls its items back to the
 * baseline, labeled "live status unavailable".
 */
export function createReadinessLayer({ source, overlayHost, store } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Readiness requires a snapshot source');
  if (!overlayHost) throw new TypeError('Readiness requires an overlay host');
  const _store = store ?? createReadinessStore();
  let _viewer = null;
  let _snapshot = null;
  let _rows = [];
  let _dueCount = 0;
  let _householdSize = READINESS_DEFAULT_HOUSEHOLD_SIZE;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const refreshRows = () => {
    const drivers = _snapshot?.drivers ?? {};
    _rows = readinessRows(READINESS_CHECKLISTS, drivers).map((row) => ({
      ...row,
      done: _store.isDone(row.id),
    }));
    _dueCount = _rows.filter((row) => row.due).length;
  };

  const layer = {
    id: READINESS_LAYER_ID,
    name: 'Readiness',
    icon: '🛠️',
    source: READINESS_ATTRIBUTION,
    updateInterval: READINESS_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Readiness layer is already initialized');
      _viewer = viewer;
      _snapshot = null;
      _rows = [];
      _dueCount = 0;
      _householdSize = READINESS_DEFAULT_HOUSEHOLD_SIZE;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      rowControlsListener = null;
      refreshRows();
      overlayHost.setVisible(READINESS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Readiness] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      overlayHost.setVisible(READINESS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      overlayHost.clearSource(READINESS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(READINESS_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = snapshot?.stale === true;
        refreshRows();
        if (_enabled) {
          overlayHost.setEntries(
            READINESS_OVERLAY_SOURCE_ID,
            [
              createReadinessSummaryEntry({
                snapshot: { ...snapshot, dueCount: _dueCount },
                householdSize: _householdSize,
              }),
            ],
            {
              cohortLimit: 1,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Readiness] Updated: ${_dueCount} item(s) due now${_stale ? ' (stale)' : ''}`,
        );
        notify();
        return true;
      } catch (e) {
        console.warn('[Data:Readiness] Fetch error:', e);
        _lastError = e?.message || fallbackMsg('Readiness unavailable');
        notify();
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(READINESS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(READINESS_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _rows = [];
      _dueCount = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      rowControlsListener = null;
    },

    /**
     * Params lane: list items toggle their done-state via
     * { toggleItem: '<checklist>:<item>' }; household-size chips set the
     * go-bag size via { householdSize: n }. Local-only — no network call.
     */
    setParams(params = {}, { origin } = {}) {
      if (typeof params?.toggleItem === 'string') {
        const known = _rows.some((row) => row.id === params.toggleItem);
        if (!known) return false;
        _store.toggle(params.toggleItem);
        refreshRows();
        notify();
        return true;
      }
      if (Number.isFinite(params?.householdSize)) {
        const size = Math.max(
          1,
          Math.min(12, Math.floor(params.householdSize)),
        );
        if (size === _householdSize) return false;
        _householdSize = size;
        if (_enabled) {
          overlayHost.setEntries(
            READINESS_OVERLAY_SOURCE_ID,
            [
              createReadinessSummaryEntry({
                snapshot: { ...(_snapshot ?? {}), dueCount: _dueCount },
                householdSize: _householdSize,
              }),
            ],
            { cohortLimit: 1, moving: false },
          );
        }
        notify();
        return true;
      }
      return false;
    },

    /** Clear all done-state (the "Reset checks" chip). Local-only. */
    clearDone() {
      _store.clear();
      refreshRows();
      notify();
    },

    /**
     * Row controls: household-size chips + a reset chip, an info line
     * (go-bag summary + due-now count), and the full checklist as one
     * clickable list — click an item to toggle its done-state. Due items
     * lead the list, then the baseline, each with its checklist and the
     * live reason that made it due.
     */
    getRowControls() {
      const unavailable = _snapshot?.unavailable ?? [];
      const doneCount = _rows.filter((row) => row.done).length;
      const info =
        `${goBagSummary(_householdSize)} · ` +
        (_dueCount > 0
          ? `${_dueCount} ${t(_dueCount === 1 ? 'item due now' : 'items due now')}`
          : t('baseline kit')) +
        ` · ${doneCount}/${_rows.length} ${t('checked')}` +
        (unavailable.length > 0
          ? ` · ${t('live status unavailable')}: ${unavailable.join(', ')}`
          : '');
      const ordered = [..._rows].sort((a, b) => {
        if (a.due !== b.due) return a.due ? -1 : 1;
        if (a.done !== b.done) return a.done ? 1 : -1;
        return 0;
      });
      const listItems = ordered.map((row, index) => ({
        id: row.id,
        ordinal: index + 1,
        lead: `${row.done ? '✓ ' : ''}${row.text}`,
        text:
          `${row.checklistTitle} · ` +
          (row.due
            ? `${t('Due now')}: ${row.dueReasons.join(', ')}`
            : t('Baseline')),
        disabled: false,
        params: { toggleItem: row.id },
      }));
      return {
        chips: [
          ...READINESS_HOUSEHOLD_SIZES.map((size) => ({
            id: `household-${size}`,
            label: t('Household of {size}', { size }),
            title: t('Go-bag for a household of {size}', { size }),
            disabled: size === _householdSize,
            params: { householdSize: size },
          })),
          {
            id: 'reset-checks',
            label: t('Reset checks'),
            title: t('Clear all checked items (stored only in this browser)'),
            disabled: doneCount === 0,
            onClick: () => this.clearDone(),
          },
        ],
        info,
        infoTitle: t(
          'Checklists curated from Ready.gov / FEMA (public domain) — full guides at ready.gov/kit and ready.gov/plan, NJ guidance at nj.gov/njoem. Urgency is live: an item is "due now" when its driver is active in the county right now. Checked items are stored only in this browser.',
        ),
        legend: null,
        list: {
          ariaLabel: t('Readiness checklists'),
          items: listItems,
        },
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the checklist rows as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_rows) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _rows) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _rows.length,
        doneCount: _rows.filter((row) => row.done).length,
        dueCount: _dueCount,
        householdSize: _householdSize,
        unavailable: [...(_snapshot?.unavailable ?? [])],
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
