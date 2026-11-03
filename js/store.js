/* ============================================================
   store.js — tiny local-first persistence layer.
   Everything JARVIS knows about you lives in localStorage.
   ============================================================ */

const KEY = 'jarvis.state.v1';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const defaults = () => ({
  version: 1,
  name: null,
  createdAt: Date.now(),
  session: 1,
  tasks: [],
  notes: [],
  reminders: [],
  settings: {
    sound: true,
    voice: true,
    accent: 'cyan',
    timers: { sound: true },
  },
});

function merge(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(saved)) {
    if (Array.isArray(v)) out[k] = v;
    else if (v && typeof v === 'object' && typeof base[k] === 'object' && base[k] !== null)
      out[k] = merge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

function read() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    return merge(base, JSON.parse(raw));
  } catch {
    return base;
  }
}

export const state = read();
state.session = Number(state.session) || 1;

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 140);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[jarvis] could not persist state', err);
  }
}

export function wipe() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  const fresh = defaults();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  flush();
}

/** Approximate footprint of stored data, in bytes. */
export function storedBytes() {
  try {
    return new Blob([JSON.stringify(state)]).size;
  } catch {
    return JSON.stringify(state).length;
  }
}

/** Persist on page hide so nothing is lost if the tab is closed. */
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
