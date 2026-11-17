import { READINESS_DONE_KEY } from './policy.js';

// This module is the ONLY readiness file that touches localStorage. It
// lives in the layer package (application side) and deliberately NOT in
// the source package or the reference sources: sources stay pure and
// fetch-only, so a source package must never reach browser globals.

/** In-memory storage with the localStorage shape (tests + no-storage fallback). */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function defaultStorage() {
  try {
    const storage = globalThis?.localStorage;
    if (storage && typeof storage.getItem === 'function') return storage;
  } catch {
    /* storage is unavailable (private mode, SSR) — fall through */
  }
  return memoryStorage();
}

/**
 * The done-state store. Local-only by construction: it reads and writes
 * one localStorage key and makes no network call anywhere in the path.
 * `storage` is injectable for tests; the default is the real localStorage
 * when present, an in-memory store otherwise.
 */
export function createReadinessStore({ storage = defaultStorage() } = {}) {
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(READINESS_DONE_KEY) ?? 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  const write = (done) => {
    try {
      storage.setItem(READINESS_DONE_KEY, JSON.stringify(done));
    } catch {
      /* a full or blocked store never breaks the panel */
    }
  };
  return {
    isDone: (itemId) => read()[itemId] === true,
    doneIds: () => Object.keys(read()).filter((id) => read()[id] === true),
    toggle: (itemId) => {
      const done = read();
      if (done[itemId] === true) delete done[itemId];
      else done[itemId] = true;
      write(done);
      return done[itemId] === true;
    },
    clear: () => {
      try {
        storage.removeItem(READINESS_DONE_KEY);
      } catch {
        /* ignored */
      }
    },
  };
}
