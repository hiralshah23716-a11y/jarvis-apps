/* ============================================================
   audio.js — all sound is synthesised with the Web Audio API,
   so the app ships with zero audio assets.
   ============================================================ */

import { state } from './store.js';

let ctx = null;

function ac() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

const enabled = () => state.settings.sound !== false;

/** Call from a user gesture to unlock audio on iOS/Safari. */
export function unlock() {
  const c = ac();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** A single shaped tone. */
export function tone(freq = 720, duration = 0.07, { type = 'sine', gain = 0.045, slideTo = null, delay = 0 } = {}) {
  if (!enabled()) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const amp = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + duration);

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

export const click = () => tone(1180, 0.035, { type: 'triangle', gain: 0.02 });
export const send = () => {
  tone(560, 0.06, { type: 'sine', gain: 0.035 });
  tone(860, 0.09, { type: 'sine', gain: 0.03, delay: 0.05 });
};
export const receive = () => {
  tone(880, 0.05, { type: 'sine', gain: 0.03 });
  tone(1180, 0.07, { type: 'sine', gain: 0.024, delay: 0.05 });
};
export const error = () => {
  tone(240, 0.16, { type: 'square', gain: 0.03, slideTo: 150 });
};
export const boot = () => {
  tone(320, 0.5, { type: 'sine', gain: 0.03, slideTo: 960 });
  tone(640, 0.7, { type: 'triangle', gain: 0.018, slideTo: 1400, delay: 0.16 });
};
export const listenOn = () => tone(660, 0.09, { type: 'sine', gain: 0.035, slideTo: 990 });
export const listenOff = () => tone(990, 0.09, { type: 'sine', gain: 0.03, slideTo: 620 });

/** Repeating alarm for timers and reminders. Returns a stop function. */
export function alarm(pattern = 'timer') {
  const c = ac();
  if (!c || !enabled()) return () => {};
  const gainNode = c.createGain();
  gainNode.gain.value = 0.07;
  gainNode.connect(c.destination);

  let stopped = false;
  let step = 0;

  const beep = () => {
    if (stopped) return;
    const now = c.currentTime;
    const freq = pattern === 'timer' ? 988 : 740;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.setValueAtTime(freq * 1.5, now + 0.11);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(0.9, now + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(amp).connect(gainNode);
    osc.start(now);
    osc.stop(now + 0.34);
    step += 1;
    if (step >= 8) stopped = true;
  };

  beep();
  const id = setInterval(beep, 480);

  return () => {
    stopped = true;
    clearInterval(id);
    try {
      gainNode.disconnect();
    } catch {
      /* ignore */
    }
  };
}
