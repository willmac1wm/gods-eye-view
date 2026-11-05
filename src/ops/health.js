/**
 * Compact per-desk health strip — last fetch OK/fail, latency, source, stale,
 * poll age. Mount once per page; call `probe()` around each load.
 */
import { esc } from './ui.js';

function fmtAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/**
 * @param {HTMLElement|null} host
 * @param {{ desk?: string, pollMs?: number }} opts
 */
export function createPageHealth(host, { desk = 'desk', pollMs = 60_000 } = {}) {
  const state = {
    desk,
    pollMs,
    lastOk: null,
    lastError: null,
    latencyMs: null,
    source: null,
    stale: false,
    at: null,
    startedAt: Date.now(),
  };

  function render() {
    if (!host) return;
    const age = state.at != null ? Date.now() - state.at : null;
    const stale =
      state.stale ||
      (state.pollMs > 0 && age != null && age > state.pollMs * 2.5);
    const tone =
      state.lastOk === false ? 'error' : stale ? 'warn' : state.lastOk ? 'ok' : '';
    const status =
      state.lastOk === false
        ? 'FAIL'
        : stale
          ? 'STALE'
          : state.lastOk
            ? 'OK'
            : '…';
    host.innerHTML = `
      <div class="ops-health" data-tone="${esc(tone)}" role="status">
        <span class="ops-health-pill">${esc(status)}</span>
        <span><b>${esc(desk)}</b></span>
        <span>lat ${esc(fmtAge(state.latencyMs))}</span>
        <span>age ${esc(fmtAge(age))}</span>
        <span>poll ${esc(fmtAge(state.pollMs))}</span>
        <span>src ${esc(state.source || '—')}</span>
        ${state.lastError ? `<span class="ops-health-err">${esc(state.lastError)}</span>` : ''}
      </div>`;
  }

  function setPollMs(ms) {
    if (Number.isFinite(ms) && ms > 0) state.pollMs = ms;
    render();
  }

  /**
   * Wrap an async loader. Records latency / ok / fail / optional meta.
   * @param {() => Promise<{source?: string, stale?: boolean}|void>} fn
   */
  async function probe(fn) {
    const t0 = performance.now();
    try {
      const meta = (await fn()) || {};
      state.lastOk = true;
      state.lastError = null;
      state.latencyMs = performance.now() - t0;
      state.at = Date.now();
      if (meta.source != null) state.source = meta.source;
      state.stale = Boolean(meta.stale);
      render();
      return meta;
    } catch (error) {
      state.lastOk = false;
      state.lastError = error?.message || String(error);
      state.latencyMs = performance.now() - t0;
      state.at = Date.now();
      render();
      throw error;
    }
  }

  function tick() {
    render();
  }

  render();
  const ageTimer = setInterval(tick, 5_000);

  return {
    probe,
    setPollMs,
    render,
    get state() {
      return { ...state };
    },
    destroy() {
      clearInterval(ageTimer);
    },
  };
}

/**
 * Ensure a health host element exists at the top of main (after hero).
 * @param {string} [id]
 */
export function ensureHealthHost(id = 'ops-health') {
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement('div');
  el.id = id;
  el.className = 'ops-health-host';
  const main = document.querySelector('.ops-main');
  const hero = main?.querySelector('.ops-hero');
  if (hero?.nextSibling) main.insertBefore(el, hero.nextSibling);
  else if (main) main.prepend(el);
  else document.body.prepend(el);
  return el;
}
