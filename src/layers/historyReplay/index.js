import { msg, t } from '../../i18n/index.js';
import {
  createHistoryOverlayEntries,
  createHistorySummaryEntry,
  mapAnalystRecord,
} from './model.js';
import {
  HISTORY_ATTRIBUTION,
  HISTORY_BUCKET_MS,
  HISTORY_LAYER_ID,
  HISTORY_LIMIT,
  HISTORY_OVERLAY_COHORT_LIMIT,
  HISTORY_OVERLAY_SOURCE_ID,
  HISTORY_PLAY_STEP_MS,
  HISTORY_PLAY_TICK_MS,
  HISTORY_STEP_MS,
  HISTORY_WINDOW_MS,
} from './policy.js';
import { formatReplayTime, positionsAt, timeBuckets } from './records.js';
export * from './model.js';
export { createHistorySource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const fallbackMsg = (text) => text;

/**
 * Own one history-replay display and its playback lifecycle.
 *
 * Rows come from the sidecar's own store (/api/history/*, read-only in
 * sidecar/app/history.py) — the layer never invents a position. At cursor
 * T the map shows one pin per aircraft at its latest stored position at
 * or before T, plus feed items from the 15 minutes before T. The row
 * controls rewind (±15 min chips), play/pause, jump to Latest, and a
 * 15-minute bucket list that jumps the cursor; setParams({ replayMs })
 * is the same jump for the params lane (and for a future slider panel).
 * Playback advances 5 minutes of replay time per second and stops at
 * the end of the fetched window — it never loops silently past the
 * store. On a failed refresh the last good window stays drawn, marked
 * stale. An empty window is a real result, shown with its bounds.
 */
export function createHistoryLayer({
  source,
  overlayHost,
  setTimeoutImpl = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutImpl = (id) => globalThis.clearTimeout(id),
} = {}) {
  if (typeof source?.getStatus !== 'function')
    throw new TypeError('History replay requires a status source');
  if (typeof source?.getWindow !== 'function')
    throw new TypeError('History replay requires a window source');
  if (!overlayHost)
    throw new TypeError('History replay requires an overlay host');
  let _viewer = null;
  let _status = null;
  let _aircraft = [];
  let _feed = [];
  let _fromMs = null;
  let _untilMs = null;
  let _cursorMs = null;
  let _playing = false;
  let _timer = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  function render() {
    if (!_enabled) return;
    const shown = positionsAt(_aircraft, _cursorMs ?? -Infinity);
    const feedShown =
      _cursorMs == null
        ? 0
        : _feed.filter(
            (row) =>
              Number.isFinite(row?.pubMs) &&
              row.pubMs <= _cursorMs &&
              row.pubMs > _cursorMs - 15 * 60_000,
          ).length;
    overlayHost.setEntries(
      HISTORY_OVERLAY_SOURCE_ID,
      [
        createHistorySummaryEntry({
          status: _status,
          cursorMs: _cursorMs,
          fromMs: _fromMs,
          untilMs: _untilMs,
          aircraftShown: Math.min(shown.length, HISTORY_OVERLAY_COHORT_LIMIT),
          feedShown,
        }),
        ...createHistoryOverlayEntries({
          aircraftRows: _aircraft,
          feedRows: _feed,
          cursorMs: _cursorMs,
        }),
      ],
      {
        cohortLimit: HISTORY_OVERLAY_COHORT_LIMIT + 1,
        moving: false,
      },
    );
  }

  function stopTimer() {
    if (_timer !== null) {
      clearTimeoutImpl(_timer);
      _timer = null;
    }
  }

  function tick() {
    _timer = null;
    if (!_playing || _cursorMs == null || _untilMs == null) return;
    const next = _cursorMs + HISTORY_PLAY_STEP_MS;
    if (next >= _untilMs) {
      _cursorMs = _untilMs;
      _playing = false;
      render();
      notify();
      return;
    }
    _cursorMs = next;
    render();
    notify();
    _timer = setTimeoutImpl(tick, HISTORY_PLAY_TICK_MS);
  }

  function setCursor(ms, { notifyControls = true } = {}) {
    if (!Number.isFinite(ms)) return false;
    if (_fromMs != null) ms = Math.max(_fromMs, ms);
    if (_untilMs != null) ms = Math.min(_untilMs, ms);
    if (ms === _cursorMs) return true;
    _cursorMs = ms;
    render();
    if (notifyControls) notify();
    return true;
  }

  const layer = {
    id: HISTORY_LAYER_ID,
    name: 'History replay',
    icon: '🕘',
    source: HISTORY_ATTRIBUTION,
    // No auto-refresh: history is queried on demand (enable + Latest).
    updateInterval: 0,

    init(viewer) {
      if (_viewer)
        throw new Error('History replay layer is already initialized');
      _viewer = viewer;
      _status = null;
      _aircraft = [];
      _feed = [];
      _fromMs = null;
      _untilMs = null;
      _cursorMs = null;
      _playing = false;
      _timer = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(HISTORY_OVERLAY_SOURCE_ID, false);
      console.log('[Data:History] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      overlayHost.setVisible(HISTORY_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      stopTimer();
      _playing = false;
      overlayHost.clearSource(HISTORY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HISTORY_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      try {
        const status = await source.getStatus();
        _status = status;
        const newest = status?.newestMs;
        if (!Number.isFinite(newest)) {
          _aircraft = [];
          _feed = [];
          _fromMs = null;
          _untilMs = null;
          _cursorMs = null;
          _stale = false;
          render();
          _lastUpdate = Date.now();
          _lastError = null;
          return true;
        }
        const untilMs = newest;
        const fromMs = untilMs - HISTORY_WINDOW_MS;
        const window = await source.getWindow({ fromMs, untilMs });
        _aircraft = window.aircraft.rows;
        _feed = window.feed.rows;
        _fromMs = window.fromMs ?? fromMs;
        _untilMs = window.untilMs ?? untilMs;
        _cursorMs = _untilMs;
        _stale = false;
        if (_enabled) render();
        _lastUpdate = Date.now();
        _lastError = null;
        notify();
        console.log(
          `[Data:History] Updated: ${_aircraft.length} aircraft, ${_feed.length} feed in window`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:History] Fetch error:', e);
        _lastError = e?.message || fallbackMsg('History unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      stopTimer();
      _playing = false;
      overlayHost.clearSource(HISTORY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HISTORY_OVERLAY_SOURCE_ID, false);
      _status = null;
      _aircraft = [];
      _feed = [];
      _fromMs = null;
      _untilMs = null;
      _cursorMs = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      rowControlsListener = null;
    },

    /** Rewind/play controls, callable by the panel, voice, or tests. */
    setReplayTime(ms) {
      return setCursor(ms);
    },

    stepBy(ms) {
      if (_cursorMs == null || !Number.isFinite(ms)) return false;
      return setCursor(_cursorMs + ms);
    },

    play() {
      if (_playing || _cursorMs == null || _untilMs == null) return false;
      if (_cursorMs >= _untilMs) return false;
      _playing = true;
      _timer = setTimeoutImpl(tick, HISTORY_PLAY_TICK_MS);
      notify();
      return true;
    },

    pause() {
      if (!_playing) return false;
      _playing = false;
      stopTimer();
      notify();
      return true;
    },

    async jumpToLatest() {
      return this.update(_viewer);
    },

    getReplayState() {
      return {
        cursorMs: _cursorMs,
        fromMs: _fromMs,
        untilMs: _untilMs,
        playing: _playing,
        aircraftRows: _aircraft.length,
        feedRows: _feed.length,
      };
    },

    /** Params lane: the row-control bucket list jumps via { replayMs }. */
    setParams(params = {}, { origin } = {}) {
      if (!Number.isFinite(params?.replayMs)) return false;
      return setCursor(params.replayMs);
    },

    /**
     * Row controls: rewind chips, play/pause, Latest, and the 15-minute
     * bucket list that jumps the cursor. The info line carries the
     * cursor time and the counts at it, so the row always says where
     * in history the map is standing.
     */
    getRowControls() {
      const cursorText = formatReplayTime(_cursorMs) ?? t('No stored history');
      const shown = positionsAt(_aircraft, _cursorMs ?? -Infinity).length;
      const buckets = timeBuckets(_aircraft, _feed, _fromMs, _untilMs);
      return {
        chips: [
          {
            id: 'rewind-15',
            label: t('−15 MIN'),
            title: t('Step the replay 15 minutes back'),
            disabled: !_enabled || _cursorMs == null,
            onClick: () => this.stepBy(-HISTORY_STEP_MS),
          },
          {
            id: _playing ? 'pause' : 'play',
            label: _playing ? t('PAUSE') : t('PLAY'),
            title: _playing
              ? t('Pause the replay')
              : t('Play the replay forward, 5 minutes per second'),
            disabled:
              !_enabled ||
              _cursorMs == null ||
              (!_playing && _cursorMs >= _untilMs),
            onClick: () => (_playing ? this.pause() : this.play()),
          },
          {
            id: 'forward-15',
            label: t('+15 MIN'),
            title: t('Step the replay 15 minutes forward'),
            disabled: !_enabled || _cursorMs == null,
            onClick: () => this.stepBy(HISTORY_STEP_MS),
          },
          {
            id: 'latest',
            label: t('LATEST'),
            title: t('Refetch the newest stored window'),
            disabled: !_enabled,
            onClick: () => this.jumpToLatest(),
          },
        ],
        info:
          _cursorMs == null
            ? t('No stored history yet')
            : `${cursorText} · ${shown} ${msg('aircraft')}`,
        list:
          buckets.length > 0
            ? {
                ariaLabel: t('Replay windows, 15 minutes each'),
                items: buckets.map((bucket, index) => ({
                  id: String(bucket.startMs),
                  ordinal: index + 1,
                  lead: formatReplayTime(bucket.startMs) ?? '',
                  text: `${bucket.aircraft} ${msg('aircraft')} · ${bucket.feed} ${msg('feed')}`,
                  params: { replayMs: bucket.startMs },
                  disabled: _cursorMs === bucket.startMs,
                })),
              }
            : null,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot stored rows as plain JSON-safe objects for the analyst
     * query engine. On-demand only — zero per-frame cost, no listeners,
     * no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _aircraft) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      for (const row of _feed) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _aircraft.length + _feed.length,
        aircraftRows: _aircraft.length,
        feedRows: _feed.length,
        cursorMs: _cursorMs,
        fromMs: _fromMs,
        untilMs: _untilMs,
        playing: _playing,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
