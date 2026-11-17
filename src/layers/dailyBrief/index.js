// src/layers/dailyBrief/index.js
import { msg, t } from '../../i18n/index.js';
import {
  DAILY_BRIEF_ATTRIBUTION,
  DAILY_BRIEF_LAYER_ID,
  DAILY_BRIEF_OVERLAY_SOURCE_ID,
  DAILY_BRIEF_REFRESH_MS,
} from './policy.js';
import { createDailyBriefSummaryEntry, mapAnalystRecord } from './model.js';
import { briefStatusLabel } from './records.js';
export * from './model.js';
export { createDailyBriefSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const fallbackMsg = (text) => text;

/**
 * Own one daily-brief display and its refresh lifecycle.
 *
 * The brief is written in the sidecar (/api/news/brief, the blog writer
 * over the last 24 h of stored items + alerts) — the layer never writes
 * or summarizes anything itself. The map shows one county label pinned to
 * the latest brief (headline + date + confidence + status); the row
 * controls list the three sections (What happened / Still active / What
 * to watch). A brief in review shows as in review; a brief older than
 * 24 h shows as stale with its date; with no writer configured the panel
 * says so and no brief is faked. On a failed refresh the last good brief
 * stays drawn, marked stale.
 */
export function createDailyBriefLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Daily brief requires a snapshot source');
  if (!overlayHost) throw new TypeError('Daily brief requires an overlay host');
  let _viewer = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const layer = {
    id: DAILY_BRIEF_LAYER_ID,
    name: 'Daily brief',
    icon: '📰',
    source: DAILY_BRIEF_ATTRIBUTION,
    updateInterval: DAILY_BRIEF_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Daily brief layer is already initialized');
      _viewer = viewer;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      rowControlsListener = null;
      overlayHost.setVisible(DAILY_BRIEF_OVERLAY_SOURCE_ID, false);
      console.log('[Data:DailyBrief] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      overlayHost.setVisible(DAILY_BRIEF_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      overlayHost.clearSource(DAILY_BRIEF_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DAILY_BRIEF_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = snapshot?.brief?.stale === true;
        if (_enabled) {
          overlayHost.setEntries(
            DAILY_BRIEF_OVERLAY_SOURCE_ID,
            [createDailyBriefSummaryEntry({ snapshot })],
            {
              cohortLimit: 1,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:DailyBrief] Updated: ${snapshot?.brief?.slug ?? 'no brief'}${_stale ? ' (stale)' : ''}`,
        );
        notify();
        return true;
      } catch (e) {
        console.warn('[Data:DailyBrief] Fetch error:', e);
        _lastError = e?.message || fallbackMsg('Daily brief unavailable');
        notify();
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(DAILY_BRIEF_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DAILY_BRIEF_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      rowControlsListener = null;
    },

    /**
     * Row controls: an info line (headline + date + confidence + status)
     * plus one row per brief section. No chips — the brief refreshes
     * automatically every 15 minutes; there is nothing to click.
     */
    getRowControls() {
      const brief = _snapshot?.brief ?? null;
      const info = brief
        ? `${brief.headline}` +
          (brief.dateLabel ? ` · ${brief.dateLabel}` : '') +
          (brief.confidence !== null && brief.confidence !== undefined
            ? ` · ${t('Confidence')}: ${Math.round(brief.confidence * 100)}%`
            : '') +
          ` · ${t(briefStatusLabel(brief))}`
        : _snapshot?.writerEnabled
          ? t('No daily brief yet — the first brief is written at 07:00 local')
          : t('Daily brief unavailable — writer not configured');
      const listItems = (brief?.sections ?? []).map((section, index) => ({
        id: section.heading,
        ordinal: index + 1,
        lead: t(section.heading),
        text:
          section.text.length > 240
            ? `${section.text.slice(0, 237)}…`
            : section.text,
        disabled: true,
      }));
      return {
        chips: [],
        info,
        infoTitle: t(
          'The blog writer over the last 24 h of stored alerts and news. Auto-published only when confidence is 0.75 or higher, no named individuals, and no EMS or patient content — otherwise it waits in the review queue. A brief older than 24 h is labeled stale with its date.',
        ),
        legend: null,
        list:
          listItems.length > 0
            ? {
                ariaLabel: t('Brief sections'),
                items: listItems,
              }
            : null,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the latest brief as a plain JSON-safe object for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while disabled or empty.
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
        count: _snapshot?.brief ? 1 : 0,
        status: _snapshot?.brief?.status ?? null,
        confidence: _snapshot?.brief?.confidence ?? null,
        stale: _stale,
        writerEnabled: _snapshot?.writerEnabled ?? null,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
