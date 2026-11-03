/* ============================================================
   speech.js — Web Speech API wrappers.
   Speech synthesis gives JARVIS a voice; SpeechRecognition lets
   you talk to it. Both degrade gracefully to plain typing.
   ============================================================ */

import { state } from './store.js';

/* ── synthesis ─────────────────────────────────────────────── */

const synth = window.speechSynthesis || null;
let voices = [];
let chosen = null;

const PREFERRED = [
  'google uk english male',
  'daniel',
  'arthur',
  'oliver',
  'microsoft ryan',
  'microsoft guy',
  'google us english',
  'alex',
  'fred',
];

function pickVoice() {
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  for (const want of PREFERRED) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(want));
    if (hit) return hit;
  }
  const local = pool.find((v) => v.localService);
  return local || pool[0];
}

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices() || [];
  chosen = pickVoice();
}

if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
  // Safari fires no event until the first utterance in some versions.
  setTimeout(loadVoices, 400);
  setTimeout(loadVoices, 1600);
}

/** Remove markup and emoji so the synthesiser doesn't read them aloud. */
export function forSpeech(text) {
  return String(text)
    .replace(/[*_`#>]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text, { onStart, onEnd } = {}) {
  if (!synth || state.settings.voice === false) {
    onEnd?.();
    return false;
  }
  const clean = forSpeech(text);
  if (!clean) {
    onEnd?.();
    return false;
  }
  try {
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(clean.slice(0, 900));
    if (chosen) utter.voice = chosen;
    utter.rate = 1.02;
    utter.pitch = 0.86;
    utter.volume = 1;
    utter.onstart = () => onStart?.();
    utter.onend = () => onEnd?.();
    utter.onerror = () => onEnd?.();
    synth.speak(utter);
    return true;
  } catch {
    onEnd?.();
    return false;
  }
}

export function stopSpeaking() {
  try {
    synth?.cancel();
  } catch {
    /* ignore */
  }
}

export const canSpeak = () => Boolean(synth);

/* ── recognition ───────────────────────────────────────────── */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const canListen = () => Boolean(SR);

/**
 * Create a one-shot/toggleable recogniser.
 * @param {{onResult:(text:string)=>void, onStart?:()=>void,
 *          onEnd?:()=>void, onError?:(code:string)=>void}} handlers
 */
export function createRecognizer(handlers = {}) {
  if (!SR) return null;
  const rec = new SR();
  rec.lang = navigator.language && /^en/i.test(navigator.language) ? navigator.language : 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';

  rec.onstart = () => {
    finalText = '';
    handlers.onStart?.();
  };

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += chunk;
      else interim += chunk;
    }
    handlers.onPartial?.((finalText + interim).trim());
  };

  rec.onerror = (event) => {
    handlers.onError?.(event.error || 'unknown');
  };

  rec.onend = () => {
    const text = finalText.trim();
    handlers.onEnd?.(text);
    if (text) handlers.onResult?.(text);
  };

  return rec;
}
