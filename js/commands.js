/* ============================================================
   commands.js — JARVIS's brain.
   A deterministic, offline natural-language command router.
   No network, no model calls: just careful parsing.
   ============================================================ */

import { state, save, uid } from './store.js';
import { batteryInfo, deviceInfo } from './stats.js';

/* ── text helpers ──────────────────────────────────────────── */

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[?!.]+$/g, '')
    .trim();

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clockString(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function clockStringSeconds(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function dateString(date = new Date()) {
  return `${DAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function humanDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h) parts.push(plural(h, 'hour'));
  if (m) parts.push(plural(m, 'minute'));
  if (sec || parts.length === 0) parts.push(plural(sec, 'second'));
  if (parts.length > 2) return `${parts[0]}, ${parts[1]} and ${parts[2]}`;
  return parts.join(' and ');
}

export function relativeTime(ts) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const suffix = (str) => (diff >= 0 ? `in ${str}` : `${str} ago`);
  if (abs < 45000) return diff >= 0 ? 'in a moment' : 'just now';
  if (mins < 60) return suffix(plural(mins, 'min'));
  const hours = Math.round(mins / 60);
  if (hours < 24) return suffix(plural(hours, 'hr'));
  return suffix(plural(Math.round(hours / 24), 'day'));
}

/* ── number words + durations ──────────────────────────────── */

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100, "a couple": 2,
  couple: 2, half: 0.5, quarter: 0.25,
};

function wordsToNumber(token) {
  if (!token) return NaN;
  if (/^\d+(\.\d+)?$/.test(token)) return parseFloat(token);
  const parts = token.split(/[\s-]+/);
  let total = 0;
  let seen = false;
  for (const p of parts) {
    if (p in WORD_NUMBERS) {
      const v = WORD_NUMBERS[p];
      if (v === 100) total = (total || 1) * 100;
      else total += v;
      seen = true;
    } else {
      return NaN;
    }
  }
  return seen ? total : NaN;
}

const NUM = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety|a couple|couple|half|quarter)';

/** Parse "1:30", "5 minutes", "2h 30m", "90s", "an hour". Returns seconds or NaN. */
export function parseDuration(str) {
  if (!str) return NaN;
  const s = str.trim().toLowerCase();

  const colon = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const [, a, b, c] = colon;
    return c !== undefined ? +a * 3600 + +b * 60 + +c : +a * 60 + +b;
  }

  let total = 0;
  let found = false;

  const re = new RegExp(
    `(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|forty five|fifty|sixty|ninety|couple|half|quarter)\\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\\b`,
    'g',
  );

  let m;
  while ((m = re.exec(s)) !== null) {
    let qty = m[1];
    if (qty === 'a' || qty === 'an') qty = 1;
    else if (qty === 'couple') qty = 2;
    else qty = wordsToNumber(qty);
    if (!Number.isFinite(qty)) continue;

    const unit = m[2][0];
    if (unit === 'h') total += qty * 3600;
    else if (unit === 'm') total += qty * 60;
    else total += qty;
    found = true;
  }

  if (!found) {
    const bare = s.match(new RegExp(`^${NUM}$`));
    if (bare) {
      const n = wordsToNumber(bare[1]);
      if (Number.isFinite(n)) return n * 60; // bare number means minutes
    }
    return NaN;
  }
  return total;
}

/** Parse a clock time like "7pm", "18:30", "7:30 am". */
function parseClockTime(str) {
  const m = str.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3];
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (!mer && h <= 7) h += 12; // "at 5" almost certainly means 5pm
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() < Date.now() - 1000) d.setDate(d.getDate() + 1);
  return d;
}

/* ── safe arithmetic ───────────────────────────────────────── */

const OPS = ['+', '-', '*', '/', '%', '^'];

const WORD_OPS = [
  [/\bplus\b/g, '+'],
  [/\bminus\b/g, '-'],
  [/\b(?:times|multiplied by|multiply by|x)\b/g, '*'],
  [/\b(?:divided by|divide by|over)\b/g, '/'],
  [/\bto the power of\b/g, '^'],
  [/\bmod(?:ulo)?\b/g, '%'],
];

export function evaluateExpression(input) {
  let src = input
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/');
  for (const [re, op] of WORD_OPS) src = src.replace(re, op);
  src = src.replace(/\bpercent of\b/g, '% of');
  src = src.replace(/\s+/g, '');
  if (!src || !/[0-9]/.test(src) || !/[+\-*/%^()]/.test(src)) return null;
  if (!/^[0-9+\-*/%^().]+$/.test(src)) return null;

  let i = 0;
  const peek = () => src[i];

  const parseExpr = () => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  };

  const parseTerm = () => {
    let value = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[i++];
      const rhs = parsePower();
      if (op === '*') value *= rhs;
      else if (op === '/') value /= rhs;
      else value %= rhs;
    }
    return value;
  };

  const parsePower = () => {
    const base = parseUnary();
    if (peek() === '^') {
      i += 1;
      return Math.pow(base, parsePower());
    }
    return base;
  };

  const parseUnary = () => {
    if (peek() === '-') { i += 1; return -parseUnary(); }
    if (peek() === '+') { i += 1; return parseUnary(); }
    return parseAtom();
  };

  const parseAtom = () => {
    if (peek() === '(') {
      i += 1;
      const v = parseExpr();
      if (peek() !== ')') throw new Error('unbalanced');
      i += 1;
      return v;
    }
    const start = i;
    while (i < src.length && /[0-9.]/.test(src[i])) i += 1;
    if (start === i) throw new Error('expected number');
    return parseFloat(src.slice(start, i));
  };

  try {
    const value = parseExpr();
    if (i !== src.length) return null;
    if (!Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.abs(n) >= 1e12 || (Math.abs(n) < 1e-6 && n !== 0)
    ? n.toExponential(4)
    : Number(n.toFixed(6));
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/* ── unit conversion ───────────────────────────────────────── */

const UNIT_ALIASES = {
  km: 'km', kilometre: 'km', kilometres: 'km', kilometer: 'km', kilometers: 'km',
  m: 'm', metre: 'm', metres: 'm', meter: 'm', meters: 'm',
  cm: 'cm', centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm',
  mm: 'mm', millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm',
  mi: 'mi', mile: 'mi', miles: 'mi',
  ft: 'ft', foot: 'ft', feet: 'ft',
  in: 'in', inch: 'in', inches: 'in',
  yd: 'yd', yard: 'yd', yards: 'yd',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  c: 'c', celsius: 'c', centigrade: 'c',
  f: 'f', fahrenheit: 'f',
  k: 'k', kelvin: 'k',
};

const UNITS = {
  length: { m: 1, cm: 0.01, mm: 0.001, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  mass: { g: 1, mg: 0.001, kg: 1000, lb: 453.59237, oz: 28.349523125 },
  volume: { l: 1, ml: 0.001, gal: 3.785411784 },
  speed: { kph: 1, mph: 1.609344, ms: 3.6 },
};
UNITS.speed.kph = 1;
UNITS.speed['km/h'] = 1;
UNITS.speed['kmh'] = 1;

function convertTemperature(value, from, to) {
  const toC = from === 'c' ? value : from === 'f' ? (value - 32) * (5 / 9) : value - 273.15;
  if (to === 'c') return toC;
  if (to === 'f') return toC * (9 / 5) + 32;
  return toC + 273.15;
}

export function convertUnits(value, fromRaw, toRaw) {
  const from = UNIT_ALIASES[fromRaw];
  const to = UNIT_ALIASES[toRaw];
  if (!from || !to) return null;
  if (from === to) return { value, family: 'same' };

  const tempSet = new Set(['c', 'f', 'k']);
  if (tempSet.has(from) && tempSet.has(to)) {
    return { value: convertTemperature(value, from, to), family: 'temperature' };
  }
  for (const [family, table] of Object.entries(UNITS)) {
    if (table[from] !== undefined && table[to] !== undefined) {
      return { value: (value * table[from]) / table[to], family };
    }
  }
  return null;
}

/* ── jokes ─────────────────────────────────────────────────── */

const JOKES = [
  "I'd tell you a UDP joke, but you might not get it.",
  'There are only two hard problems in computing: cache invalidation, naming things, and off-by-one errors.',
  "I asked the Wi-Fi why it was so cold. It said it had too many open windows.",
  'A byte walks into a bar and orders a pint. The bartender asks, "What\'s wrong?" The byte says, "I\'m feeling a bit off."',
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  'I would tell you a joke about recursion, but I would tell you a joke about recursion first.',
  'The ATM said "insufficient funds" so I asked, "Insufficient funds for what?" and it said, "For a better joke."',
  'My code does not have bugs. It has randomly generated features.',
  "I'm not saying the cloud is just someone else's computer, but I did find a sticky note on it.",
  'There is no place like 127.0.0.1.',
];

/* ── help directory ────────────────────────────────────────── */

export const HELP_GROUPS = [
  {
    title: 'Time',
    items: ['time', 'date', 'timer 5 minutes', 'pause timer', 'cancel timer'],
  },
  {
    title: 'Reminders',
    items: ['remind me in 20 minutes to stretch', 'remind me at 7pm to call home', 'show reminders'],
  },
  {
    title: 'Tasks',
    items: ['add task review the PR', 'show tasks', 'complete task 2', 'clear tasks'],
  },
  {
    title: 'Notes',
    items: ['note buy oat milk', 'show notes', 'clear notes'],
  },
  {
    title: 'Compute',
    items: ['12 * 8 + 4', '20% of 250', 'convert 10 km to miles', '72 f to c'],
  },
  {
    title: 'System',
    items: ['status', 'battery', 'flip a coin', 'roll a d20', 'tell me a joke'],
  },
  {
    title: 'Interface',
    items: ['change theme', 'mute', 'export data', 'clear console', 'standby'],
  },
];

/* ── the brain ─────────────────────────────────────────────── */

export function createBrain(app) {
  const S = () => state;

  const reply = (text, opts = {}) => ({ text, ...opts });

  const greetName = () => (S().name ? `, ${S().name}` : '');

  /* ---- sub-handlers ---- */

  function addTask(text) {
    const task = { id: uid(), text: cap(text.trim()), done: false, createdAt: Date.now() };
    S().tasks.unshift(task);
    save();
    app.refreshModules();
    return task;
  }

  function addNote(text) {
    const note = { id: uid(), text: cap(text.trim()), createdAt: Date.now() };
    S().notes.unshift(note);
    save();
    app.refreshModules();
    return note;
  }

  function nextReminderId() {
    return uid();
  }

  function addReminder(text, when) {
    const reminder = { id: nextReminderId(), text: cap(text.trim()), due: when.getTime() };
    S().reminders.push(reminder);
    S().reminders.sort((a, b) => a.due - b.due);
    save();
    app.refreshModules();
    app.scheduleReminders();
    return reminder;
  }

  async function statusReply() {
    const info = deviceInfo();
    const battery = await batteryInfo();
    const done = S().tasks.filter((t) => t.done).length;
    const lines = [
      `**All systems nominal.** Uptime ${app.uptimeString()}.`,
      `Device ${info.platform} · ${info.browser} · ${info.cores} cores · ${info.memory} memory.`,
      battery ? `Battery ${battery.level}%${battery.charging ? ', charging' : ''}.` : 'Battery telemetry unavailable on this browser.',
      `${S().tasks.length - done} open task${S().tasks.length - done === 1 ? '' : 's'}, ${S().notes.length} note${S().notes.length === 1 ? '' : 's'}, ${S().reminders.length} active reminder${S().reminders.length === 1 ? '' : 's'}.`,
      'Storage is local: nothing has left this device.',
    ];
    return lines.join('\n');
  }

  /* ---- main router ---- */

  async function handle(raw) {
    const original = String(raw || '').trim();
    const t = normalize(original);
    if (!t) return reply('I did not catch that. Try "help" to see what I can do.');

    /* — greetings & identity — */
    if (/^(wake up|wake|resume)$/.test(t)) {
      app.setCore('idle');
      return reply('I am here. All systems nominal.');
    }

    if (/^(hi|hey|hello|yo|hiya|good (morning|afternoon|evening))\b/.test(t)) {
      const h = new Date().getHours();
      const partOfDay = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
      app.setCore('speaking');
      return reply(`Good ${partOfDay}${greetName()}. All systems are online and the console is yours.`);
    }

    if (/^(what'?s my name|who am i|do you know my name)\b/.test(t)) {
      return reply(
        S().name
          ? `You told me to call you **${S().name}**.`
          : 'You have not told me yet. Say "call me" followed by your name and I will remember it.',
      );
    }

    if (/^(who|what) are you\b|^your name\b|^introduce yourself/.test(t)) {
      return reply(
        'I am **JARVIS** — a local-first assistant interface. I run entirely in this browser: timers, tasks, notes, reminders, arithmetic and unit conversion. No account, no server, no telemetry leaving the device.',
      );
    }

    let m = t.match(/^(?:call me|my name is|i am|i'm)\s+([a-z][a-z .'-]{1,30})$/);
    if (m) {
      const name = cap(m[1].trim().replace(/\s+/g, ' '));
      S().name = name;
      save();
      app.refreshName();
      return reply(`Noted. I will call you **${name}** from now on.`);
    }

    if (/^(thanks|thank you|cheers|nice one|good job)\b/.test(t)) {
      return reply(`Always${greetName()}.`);
    }

    if (/^(help|commands|what can you do|capabilities|what do you do)\b/.test(t)) {
      app.openHelp();
      return reply(
        'Console directory opened. Core abilities: **timers**, **reminders**, **tasks**, **notes**, arithmetic, unit conversion, system status and a few diversions. Full list is on screen — or just ask naturally.',
      );
    }

    /* — timer control — */
    if (/^(stop|cancel|kill|abort)\b.*\b(timer|countdown|alarm)\b/.test(t) || /^(stop|cancel) (the )?(timer|countdown)$/.test(t)) {
      const had = app.stopTimer();
      return reply(had ? 'Timer cleared.' : 'There is no timer running.');
    }
    if (/^(pause) (the )?(timer|countdown)$/.test(t)) {
      return reply(app.pauseTimer() ? 'Timer paused.' : 'There is no timer running.');
    }
    if (/^(resume|continue) (the )?(timer|countdown)$/.test(t)) {
      return reply(app.resumeTimer() ? 'Timer resumed.' : 'Nothing to resume.');
    }

    m = t.match(/^(?:set |start |create |begin )?(?:a |an )?(?:timer|countdown|alarm)(?: (?:for|of))? ?(.*)$/);
    if (m) {
      const tail = m[1] || '';
      const labelMatch = tail.match(/\b(?:to|for|called)\s+([a-z].*)$/);
      const durationPart = labelMatch ? tail.slice(0, labelMatch.index) : tail;
      let seconds = parseDuration(durationPart.trim());
      if (!Number.isFinite(seconds) || seconds <= 0) {
        const guess = parseDuration(tail.trim());
        if (Number.isFinite(guess) && guess > 0) seconds = guess;
      }
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return reply('How long should the timer run? Try "set a timer for 5 minutes".');
      }
      if (seconds > 24 * 3600) return reply('That is beyond my timer range — try something under 24 hours.');
      const label = labelMatch ? labelMatch[1].replace(/^(the|a|an)\s+/, '') : 'Timer';
      app.startTimer(seconds, label);
      return reply(`Timer armed for **${humanDuration(seconds)}**. I will sound the alert when it expires.`);
    }

    /* — reminders — */
    if (/^(remind me|set a reminder|reminder)\b/.test(t)) {
      let body = t.replace(/^(remind me|set a reminder|reminder)\b/, '').trim();
      body = body.replace(/^(to|that|about)\s+/, '');

      const inMatch = body.match(/\bin\s+([a-z0-9:. ]+?)(?:\s+to\s+(.*))?$/);
      const atMatch = body.match(/\bat\s+([0-9: ]+(?:am|pm)?)(?:\s+to\s+(.*))?$/);

      let when = null;
      let text = body;

      if (inMatch) {
        const seconds = parseDuration(inMatch[1]);
        if (Number.isFinite(seconds) && seconds > 0) {
          when = new Date(Date.now() + seconds * 1000);
          text = (inMatch[2] || body.slice(0, inMatch.index)).trim();
        }
      } else if (atMatch) {
        when = parseClockTime(atMatch[1]);
        if (when) text = (atMatch[2] || body.slice(0, atMatch.index)).trim();
      }

      text = text.replace(/^(to|that|about)\s+/, '').replace(/\s+/g, ' ').trim();
      if (!when) {
        return reply('When should I remind you? Try "remind me in 20 minutes to stretch" or "remind me at 7pm to call home".');
      }
      if (!text) text = 'Reminder';

      await app.ensureNotificationPermission();
      const r = addReminder(text, when);
      app.refreshModules();
      return reply(
        `Reminder set for **${relativeTime(r.due)}** (${clockString(when)}): ${cap(text)}.`,
      );
    }

    if (/^(show|list|what are|check) (my )?(reminders|alerts)$/.test(t)) {
      app.openTab('reminders');
      if (!S().reminders.length) return reply('No reminders scheduled.');
      const lines = S().reminders.map(
        (r, i) => `${i + 1}. ${r.text} — ${relativeTime(r.due)} (${clockString(new Date(r.due))})`,
      );
      return reply(`**${S().reminders.length} reminder${S().reminders.length === 1 ? '' : 's'}:**\n${lines.join('\n')}`);
    }

    if (/^(clear|delete|remove) (all )?(reminders|alerts)$/.test(t)) {
      S().reminders = [];
      save();
      app.refreshModules();
      app.scheduleReminders();
      return reply('All reminders cleared.');
    }

    /* — tasks — */
    if (/^(show|list|what are|check) (my )?(tasks|todos|to-dos|list)$/.test(t)) {
      app.openTab('tasks');
      const open = S().tasks.filter((x) => !x.done);
      if (!S().tasks.length) return reply('Your task list is empty. Say "add task" followed by the item.');
      const lines = S().tasks.map(
        (x, i) => `${i + 1}. ${x.done ? '✓' : '○'} ${x.text}`,
      );
      return reply(`**${plural(open.length, 'open task')} of ${S().tasks.length}:**\n${lines.join('\n')}`);
    }

    m = t.match(/^(?:add|create|new) (?:a )?(?:task|todo|to-do|item)(?: to)?:? (.+)$/);
    if (!m) m = t.match(/^(?:task|todo|to-do)[:] (.+)$/);
    if (m) {
      const task = addTask(m[1]);
      app.openTab('tasks');
      return reply(`Added: **${task.text}**. ${plural(S().tasks.filter((x) => !x.done).length, 'open task')} remaining.`);
    }

    m = t.match(/^(?:complete|finish|done with|check off) (?:task )?(\d+|first|last)$/);
    if (m) {
      const list = S().tasks;
      let idx = -1;
      if (m[1] === 'first') idx = 0;
      else if (m[1] === 'last') idx = list.length - 1;
      else idx = parseInt(m[1], 10) - 1;
      if (idx < 0 || idx >= list.length) return reply('That task number does not exist.');
      list[idx].done = true;
      save();
      app.refreshModules();
      return reply(`Marked **${list[idx].text}** complete.`);
    }

    m = t.match(/^(?:delete|remove) (?:task )?(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      if (idx < 0 || idx >= S().tasks.length) return reply('That task number does not exist.');
      const [gone] = S().tasks.splice(idx, 1);
      save();
      app.refreshModules();
      return reply(`Deleted **${gone.text}**.`);
    }

    if (/^(clear|delete|remove) (all )?(tasks|todos|to-dos)$/.test(t)) {
      S().tasks = [];
      save();
      app.refreshModules();
      return reply('Task list cleared.');
    }

    /* — notes — */
    if (/^(show|list|read|what are) (my )?notes$/.test(t)) {
      app.openTab('notes');
      if (!S().notes.length) return reply('No notes yet. Say "note" followed by something to keep.');
      const lines = S().notes.map((n, i) => `${i + 1}. ${n.text}`);
      return reply(`**${plural(S().notes.length, 'note')}:**\n${lines.join('\n')}`);
    }

    m = t.match(/^(?:note|take a note|make a note|jot down|remember)\b[: ]+(.+)$/);
    if (m) {
      const note = addNote(m[1]);
      app.openTab('notes');
      return reply(`Noted: **${note.text}**.`);
    }

    if (/^(clear|delete|remove) (all )?notes$/.test(t)) {
      S().notes = [];
      save();
      app.refreshModules();
      return reply('Notes cleared.');
    }

    /* — percentage — */
    m = t.match(/^(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      const v = (parseFloat(m[1]) / 100) * parseFloat(m[2]);
      return reply(`**${formatNumber(v)}**`);
    }

    m = t.match(/^what is (\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      const v = (parseFloat(m[1]) / 100) * parseFloat(m[2]);
      return reply(`**${formatNumber(v)}**`);
    }

    /* — unit conversion — */
    m = t.match(/^(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*([a-z°/]+)\s*(?:to|in|into)\s*([a-z°/]+)$/);
    if (m) {
      const value = parseFloat(m[1]);
      const from = m[2].replace(/°/g, '').trim();
      const to = m[3].replace(/°/g, '').trim();
      const result = convertUnits(value, from, to);
      if (!result) {
        return reply(`I cannot convert **${from}** to **${to}** yet. I handle length, mass, volume, speed and temperature.`);
      }
      const label = (u) => ({ c: '°C', f: '°F', k: 'K' })[u] || u;
      return reply(`**${formatNumber(value)} ${label(from)} = ${formatNumber(result.value)} ${label(to)}**`);
    }

    /* — arithmetic — */
    const mathBody = t
      .replace(/^(calculate|compute|what is|what's|how much is|solve|evaluate)\s+/, '')
      .replace(/^(the )?(answer to|result of)\s+/, '')
      .replace(/[=]$/, '')
      .trim();
    if (mathBody !== t || /^[-+(\d]/.test(mathBody)) {
      const value = evaluateExpression(mathBody);
      if (value !== null) return reply(`**${formatNumber(value)}**`);
    }

    /* — system — */
    if (/^(status|system status|diagnostics|system check|report|how are you|systems? (report|status))$/.test(t)) {
      return reply(await statusReply());
    }

    if (/^(battery|power|charge)$/.test(t)) {
      const b = await batteryInfo();
      if (!b) return reply('This browser does not expose battery telemetry.');
      return reply(`Battery at **${b.level}%**${b.charging ? ' and charging' : ''}.`);
    }

    if (/^(what('s| is) )?(the )?(weather|forecast)\b/.test(t)) {
      return reply(
        'Weather needs an outbound data source, and this interface runs local-only. I can still convert temperatures — try "72 f to c".',
      );
    }

    /* — diversions — */
    if (/\b(joke|make me laugh)\b/.test(t)) {
      return reply(JOKES[Math.floor(Math.random() * JOKES.length)]);
    }

    if (/\b(flip|toss) (a |the )?coin\b/.test(t)) {
      return reply(`**${Math.random() < 0.5 ? 'Heads' : 'Tails'}.**`);
    }

    if (/\broll\b/.test(t)) {
      const dice = t.match(/d(\d{1,3})/);
      const sides = dice ? parseInt(dice[1], 10) : 6;
      if (sides < 2 || sides > 1000) return reply('Pick a die between 2 and 1000 sides.');
      return reply(`**${1 + Math.floor(Math.random() * sides)}** (d${sides})`);
    }

    m = t.match(/random number(?: between (\d+) and (\d+))?/);
    if (m) {
      const lo = m[1] ? parseInt(m[1], 10) : 1;
      const hi = m[2] ? parseInt(m[2], 10) : 100;
      if (hi <= lo) return reply('The upper bound needs to be larger than the lower bound.');
      return reply(`**${lo + Math.floor(Math.random() * (hi - lo + 1))}**`);
    }

    /* — interface control — */
    if (/^(mute|be quiet|silence|stop talking|quiet)$/.test(t)) {
      app.setVoice(false);
      return reply('Spoken replies muted. I will stay quiet unless you unmute me.', { silent: true });
    }
    if (/^(unmute|speak|talk to me|voice on)$/.test(t)) {
      app.setVoice(true);
      return reply('Voice restored.');
    }
    if (/^(change|switch|cycle) (the )?(theme|colour|color|accent)$/.test(t) || /^theme$/.test(t)) {
      const accent = app.cycleAccent();
      return reply(`Accent set to **${accent}**.`);
    }
    if (/^(clear|wipe|reset) (the )?(console|log|transcript)$/.test(t)) {
      app.clearLog();
      return null;
    }
    if (/^(export|backup|download) (my )?(data|everything|state)$/.test(t)) {
      app.exportData();
      return reply('Backup exported as JSON. Keep it somewhere safe.');
    }
    if (/^(standby|sleep|shut down|shutdown|power down)$/.test(t)) {
      app.standby();
      return reply('Entering standby. Click anywhere or press any key to resume.', { silent: true });
    }
    if (/^(what time|time)\b/.test(t) && !/timer/.test(t)) {
      return reply(`It is **${clockStringSeconds()}**${S().name ? `, ${S().name}` : ''}.`);
    }
    if (/^(what('?s| is) (the )?date|date|what day is it)/.test(t)) {
      return reply(`Today is **${dateString()}**.`);
    }

    /* — fallback with fuzzy suggestion — */
    const suggestions = [
      ['timer', 'set a timer for 5 minutes'],
      ['task', 'add task review the release notes'],
      ['note', 'note buy oat milk'],
      ['remind', 'remind me in 20 minutes to stretch'],
      ['status', 'status'],
      ['help', 'help'],
      ['joke', 'tell me a joke'],
      ['time', 'time'],
    ];
    let hint = '';
    for (const [key, example] of suggestions) {
      if (t.includes(key)) { hint = ` Try “${example}”.`; break; }
    }
    return reply(
      `I do not have a routine for that yet.${hint || ' Type “help” for the full command directory.'}`,
    );
  }

  /* ---- boot greeting ---- */
  function bootLine() {
    const h = new Date().getHours();
    const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const name = S().name ? `, ${S().name}` : '';
    return `${part}${name}. JARVIS online. ${app.uptimeString()} of runtime, all subsystems responding. Type "help" for a command list, or press the mic to talk.`;
  }

  return { handle, bootLine, addTask, addNote, addReminder, statusReply, greetName };
}
