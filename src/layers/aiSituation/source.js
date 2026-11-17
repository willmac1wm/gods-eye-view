import {
  AI_SITUATION_PREDICTIONS_URL,
  AI_SITUATION_QA_URL,
  AI_SITUATION_STATUS_URL,
} from './policy.js';
import {
  normalizeAiStatus,
  normalizePredictionsSnapshot,
  normalizeQaAnswer,
  validatePredictionsSnapshot,
  validateQaAnswer,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Reads predictions + AI status from the sidecar via the Node proxy
 * (/api/predictions, /api/ai/status, mounted in
 * server/providers/sidecar.js) and asks questions at /api/qa. The
 * sidecar owns the retrieval, the model call, and the forecaster rules
 * — this client only fetches and validates what comes back. It never
 * scores, summarizes, or invents anything itself.
 *
 * Attribution (baked into the layer panel): the Q&A answers only from
 * stored records, with a citation per claim, and says "I don't have a
 * record of that" when nothing is stored; the forecaster is rules
 * first, LLM second, and every prediction is stored with its
 * confidence, its exact sources, and what would change it.
 */
export function createAiSituationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const getJson = async (url, { signal, init } = {}) => {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, {
      signal,
      cache: 'no-store',
      ...init,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      /* status below remains authoritative */
    }
    signal?.throwIfAborted();
    if (!response.ok) throw new Error(`AI situation HTTP ${response.status}`);
    return payload;
  };

  return {
    async getSnapshot({ signal } = {}) {
      const [predictionsPayload, statusPayload] = await Promise.all([
        getJson(AI_SITUATION_PREDICTIONS_URL, { signal }),
        getJson(AI_SITUATION_STATUS_URL, { signal }),
      ]);
      const predictions = validatePredictionsSnapshot(
        normalizePredictionsSnapshot(predictionsPayload),
      );
      if (!predictions) throw new Error('Malformed predictions response');
      const status = normalizeAiStatus(statusPayload);
      if (!status) throw new Error('Malformed AI status response');
      return {
        predictions: predictions.predictions,
        accuracy: predictions.accuracy,
        writerEnabled: status.writerEnabled,
        snapshots: status.snapshots,
      };
    },

    async askQuestion(question, { signal } = {}) {
      const text = String(question ?? '').trim();
      if (!text) throw new TypeError('AI situation requires a question');
      // GET, not POST: the Node sidecar proxy is GET/HEAD-only (405 for
      // any other method), and a question changes no state — it is a
      // read. The proxy caches the answer for 30 s per question.
      const payload = await getJson(
        `${AI_SITUATION_QA_URL}?question=${encodeURIComponent(text)}`,
        { signal },
      );
      const answer = validateQaAnswer(normalizeQaAnswer(payload));
      if (!answer) throw new Error('Malformed Q&A response');
      return { ...answer, question: text };
    },
  };
}
