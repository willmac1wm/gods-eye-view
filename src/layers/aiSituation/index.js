// src/layers/aiSituation/index.js
import { msg, t } from '../../i18n/index.js';
import {
  AI_SITUATION_ATTRIBUTION,
  AI_SITUATION_LAYER_ID,
  AI_SITUATION_OVERLAY_SOURCE_ID,
  AI_SITUATION_REFRESH_MS,
  AI_SITUATION_SUGGESTED_QUESTIONS,
  AI_SITUATION_UNOFFICIAL_BANNER,
} from './policy.js';
import { createAiSituationSummaryEntry, getAnalystRecords } from './model.js';
import { accuracyLabel, predictionStatusLabel } from './records.js';
export * from './model.js';
export { createAiSituationSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const fallbackMsg = (text) => text;

/**
 * Own one AI-situation display and its refresh lifecycle.
 *
 * The sidecar owns the retrieval, the model call, and the forecaster
 * rules (/api/qa, /api/predictions, /api/ai/status) — the layer never
 * scores, summarizes, or invents anything itself. The map shows one
 * county label pinned to the latest prediction (or the accuracy record
 * when there is none); the row controls offer the suggested questions
 * as chips (each chip POSTs its question and the answer renders in the
 * list with its citations, the Unofficial banner, and its confidence),
 * plus the predictions list with the public accuracy record. A
 * prediction whose outcome cannot be checked stays open, labeled
 * "outcome uncheckable — still open". On a failed refresh the last
 * good snapshot stays drawn, marked stale.
 */
export function createAiSituationLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('AI situation requires a snapshot source');
  if (typeof source?.askQuestion !== 'function')
    throw new TypeError('AI situation requires a Q&A source');
  if (!overlayHost)
    throw new TypeError('AI situation requires an overlay host');
  let _viewer = null;
  let _snapshot = null;
  let _qa = null;
  let _qaLoading = false;
  let _qaSeq = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let rowControlsListener = null;

  const notify = () => rowControlsListener?.();

  const layer = {
    id: AI_SITUATION_LAYER_ID,
    name: 'AI situation',
    icon: '🤖',
    source: AI_SITUATION_ATTRIBUTION,
    updateInterval: AI_SITUATION_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('AI situation layer is already initialized');
      _viewer = viewer;
      _snapshot = null;
      _qa = null;
      _qaLoading = false;
      _qaSeq = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      rowControlsListener = null;
      overlayHost.setVisible(AI_SITUATION_OVERLAY_SOURCE_ID, false);
      console.log('[Data:AiSituation] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      overlayHost.setVisible(AI_SITUATION_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      overlayHost.clearSource(AI_SITUATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AI_SITUATION_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = false;
        if (_enabled) {
          overlayHost.setEntries(
            AI_SITUATION_OVERLAY_SOURCE_ID,
            [createAiSituationSummaryEntry({ snapshot })],
            {
              cohortLimit: 1,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:AiSituation] Updated: ${snapshot?.predictions?.length ?? 0} predictions`,
        );
        notify();
        return true;
      } catch (e) {
        console.warn('[Data:AiSituation] Fetch error:', e);
        _lastError = e?.message || fallbackMsg('AI situation unavailable');
        _stale = true;
        notify();
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(AI_SITUATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AI_SITUATION_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _qa = null;
      _qaLoading = false;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      rowControlsListener = null;
    },

    /**
     * setParams handles { question } — a suggested-question chip. The
     * ask is async: the chip marks the panel loading, the answer (or
     * the error) lands when the POST returns, and a newer question
     * wins over an older in-flight one. Returns true when the question
     * is accepted, false for anything else.
     */
    setParams(params = {}, { origin } = {}) {
      if (typeof params?.question !== 'string' || !params.question.trim())
        return false;
      const question = params.question.trim();
      const seq = (_qaSeq += 1);
      _qaLoading = true;
      _qa = { question, loading: true };
      notify();
      source
        .askQuestion(question)
        .then((answer) => {
          if (seq !== _qaSeq) return;
          _qa = answer;
          _qaLoading = false;
          notify();
        })
        .catch((e) => {
          if (seq !== _qaSeq) return;
          _qa = {
            question,
            answer: fallbackMsg('Q&A unavailable'),
            citations: [],
            confidence: null,
            unofficial: true,
            emergencyNote: null,
            error: e?.message || fallbackMsg('Q&A unavailable'),
          };
          _qaLoading = false;
          notify();
        });
      return true;
    },

    /**
     * Row controls: the suggested-question chips, an info line (accuracy
     * + writer state), and a list of the latest Q&A answer (when asked)
     * followed by the predictions. No free-text input in v1 — the
     * row-controls renderer has no text-input control.
     */
    getRowControls() {
      const info =
        `${t(accuracyLabel(_snapshot?.accuracy))}` +
        (_snapshot?.writerEnabled
          ? ` · ${t('Writer enabled')}`
          : ` · ${t('Writer not configured')}`) +
        (_stale ? ` · ${t('stale')}` : '');
      const listItems = [];
      if (_qa) {
        listItems.push({
          id: 'qa-answer',
          ordinal: 1,
          lead: _qa.question,
          text: _qaLoading
            ? t('Asking…')
            : _qa.answer.length > 240
              ? `${_qa.answer.slice(0, 237)}…`
              : _qa.answer,
          disabled: true,
        });
        if (!_qaLoading && _qa.citations?.length > 0) {
          _qa.citations.forEach((citation, index) => {
            listItems.push({
              id: `qa-citation-${index}`,
              ordinal: 2 + index,
              lead: t('Source'),
              text: citation.source
                ? `${citation.source} — ${citation.recordId}`
                : citation.recordId,
              disabled: true,
            });
          });
        }
        if (
          !_qaLoading &&
          _qa.answer === msg("I don't have a record of that")
        ) {
          (_qa.closestTopics ?? []).forEach((topic, index) => {
            listItems.push({
              id: `qa-topic-${index}`,
              ordinal: 10 + index,
              lead: t('Closest stored topic'),
              text: topic.title,
              disabled: true,
            });
          });
        }
      }
      (_snapshot?.predictions ?? []).forEach((prediction, index) => {
        listItems.push({
          id: `prediction-${prediction.id ?? index}`,
          ordinal: 20 + index,
          lead: `${t('Prediction')} · ${t(predictionStatusLabel(prediction))}`,
          text:
            prediction.text.length > 240
              ? `${prediction.text.slice(0, 237)}…`
              : prediction.text,
          disabled: true,
        });
      });
      return {
        chips: AI_SITUATION_SUGGESTED_QUESTIONS.map((question, index) => ({
          id: `question-${index}`,
          label: t(question),
          title: t('Ask the situation Q&A'),
          disabled: _qaLoading,
          params: { question },
        })),
        info,
        infoTitle: t(AI_SITUATION_UNOFFICIAL_BANNER),
        legend: null,
        list:
          listItems.length > 0
            ? {
                ariaLabel: t('Answers and predictions'),
                items: listItems,
              }
            : null,
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * Snapshot the predictions as plain JSON-safe objects for the
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
      return getAnalystRecords(_snapshot).slice(0, limit);
    },

    getStats() {
      return {
        count: _snapshot?.predictions?.length ?? 0,
        accuracy: _snapshot?.accuracy ?? null,
        writerEnabled: _snapshot?.writerEnabled ?? null,
        stale: _stale,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
