/* ============================================================
   app.js — the conductor.
   Owns the DOM, the render loops, the timer engine, the mic and
   the boot sequence; delegates language to commands.js.
   ============================================================ */

import { state, save, flush, storedBytes } from './store.js';
import * as audio from './audio.js';
import * as speech from './speech.js';
import { createBrain, HELP_GROUPS, humanDuration } from './commands.js';
import { createModules } from './widgets.js';
import { createLoadModel, deviceInfo, batteryInfo } from './stats.js';

const $ = (sel) => document.querySelector(sel);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ACCENTS = ['cyan', 'amber', 'violet', 'emerald'];
const CORE_LABELS = {
  idle: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'TRANSMITTING',
  standby: 'STANDBY',
};
const CORE_POWER = { idle: 64, listening: 90, thinking: 42, speaking: 78, standby: 6 };

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const stripMarkup = (str) => String(str).replace(/\*\*|[*_`]/g, '');

const formatRich = (str) =>
  escapeHtml(str)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

class Jarvis {
  constructor() {
    this.bootedAt = Date.now();
    this.load = createLoadModel();
    this.history = [];
    this.historyIndex = -1;
    this.coreState = 'idle';
    this.busy = false;
    this.queue = Promise.resolve();
    this.interacted = false;
    this.listening = false;
    this.recognizer = null;
    this.alarmStop = null;
    this.timer = { total: 0, remaining: 0, running: false, paused: false, endAt: 0, label: 'Timer' };
    this.series = { cpu: [], ram: [], net: [] };
    this.accentRgb = '56, 232, 255';

    this.dom = {
      log: $('#log'),
      input: $('#command-input'),
      composer: $('#composer'),
      chips: $('#chips'),
      core: $('#core'),
      coreState: $('#core-state'),
      coreMeter: $('#core-meter-fill'),
      coreUptime: $('#core-uptime'),
      coreSession: $('#core-session'),
      led: $('#console-led'),
      clockTime: $('#clock-time'),
      clockDate: $('#clock-date'),
      statusMid: $('#status-mid'),
      statusLeft: $('#status-left'),
      pillNet: $('#pill-net'),
      specs: $('#specs'),
      btnMic: $('#btn-mic'),
      micLabel: $('#mic-label'),
      micHint: $('#mic-hint'),
      btnSound: $('#btn-sound'),
      btnVoice: $('#btn-voice'),
      btnAccent: $('#btn-accent'),
      btnHelp: $('#btn-help'),
      helpModal: $('#help-modal'),
      helpGrid: $('#help-grid'),
      toasts: $('#toasts'),
      boot: $('#boot'),
      bootLine: $('#boot-line'),
      bootBar: $('#boot .boot-bar span'),
      timerPanel: $('.timer-panel'),
      timerTime: $('#timer-time'),
      timerLabel: $('#timer-label'),
      timerMode: $('#timer-mode'),
      dial: $('#dial-progress'),
      btnTimerToggle: $('#btn-timer-toggle'),
      btnTimerReset: $('#btn-timer-reset'),
      presets: $('#presets'),
    };
  }

  /* ══ boot ═════════════════════════════════════════════════ */

  async init() {
    this.dom.coreSession.textContent = `SESSION ${String(state.session).padStart(3, '0')}`;
    document.title = `JARVIS${state.name ? ` · ${state.name}` : ''} — Personal Assistant`;

    this.applyAccent(state.settings.accent || 'cyan', { silent: true });
    this.refreshToggles();
    this.buildHelp();
    this.wireEvents();
    this.buildChips();
    this.modules = createModules(this);
    this.brain = createBrain(this);

    this.modules.render();
    this.initTimerUI();
    this.startClock();
    this.startTelemetry();
    this.startFps();
    this.scheduleReminders();
    this.detectMicSupport();

    this.sys(`JARVIS CORE v1.0 · session ${state.session} · ${state.tasks.length} tasks / ${state.notes.length} notes / ${state.reminders.length} alerts`);
    this.sys(`Local storage: ${(storedBytes() / 1024).toFixed(1)} KB · nothing leaves this device`);

    await this.runBootSequence();

    state.session = Number(state.session || 1) + 1;
    save();

    await this.say(this.brain.bootLine(), { speak: this.interacted });
  }

  async runBootSequence() {
    const lines = [
      'INITIALISING CORE…',
      'LINKING LOCAL STORAGE…',
      'CALIBRATING SENSORS…',
      'ALL SYSTEMS NOMINAL',
    ];
    const total = prefersReduced ? 200 : 2100;
    const per = total / lines.length;
    let done = false;

    const overlay = this.dom.boot;
    const finish = () => {
      if (done) return;
      done = true;
      this.dom.bootBar.style.width = '100%';
      overlay.classList.add('is-done');
      setTimeout(() => overlay.remove(), 620);
    };

    $('#boot-skip')?.addEventListener('click', finish);
    document.addEventListener('keydown', finish, { once: true });

    for (let i = 0; i < lines.length; i += 1) {
      if (done) break;
      this.dom.bootLine.textContent = lines[i];
      this.dom.bootBar.style.width = `${((i + 1) / lines.length) * 100}%`;
      await delay(per);
    }
    if (!prefersReduced) await delay(220);
    finish();
  }

  /* ══ language ═════════════════════════════════════════════ */

  pushMessage(kind, text = '') {
    const el = document.createElement('div');
    el.className = `msg msg--${kind}`;

    if (kind === 'system') {
      const textEl = document.createElement('div');
      textEl.className = 'msg-text';
      textEl.textContent = stripMarkup(text);
      el.append(textEl);
      this.dom.log.append(el);
      this.scrollLog();
      return { el, textEl };
    }

    const glyph = document.createElement('div');
    glyph.className = 'msg-glyph';
    glyph.textContent = kind === 'user' ? '›' : '◈';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = `${kind === 'user' ? 'YOU' : 'JARVIS'} · ${timeNow()}`;

    const textEl = document.createElement('div');
    textEl.className = 'msg-text';
    if (text) textEl.innerHTML = formatRich(text);

    body.append(meta, textEl);
    el.append(glyph, body);
    this.dom.log.append(el);
    this.scrollLog();
    return { el, textEl };
  }

  sys(text) {
    return this.pushMessage('system', text);
  }

  scrollLog() {
    const log = this.dom.log;
    log.scrollTop = log.scrollHeight;
  }

  async say(text, { speak = true } = {}) {
    if (!text) return;
    const { el, textEl } = this.pushMessage('jarvis');
    el.classList.add('is-typing');
    textEl.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    this.setCore('thinking');

    await delay(prefersReduced ? 40 : 260 + Math.random() * 220);
    el.classList.remove('is-typing');

    const visible = stripMarkup(text);
    await this.typeOut(textEl, visible, text);

    if (speak && state.settings.voice) {
      speech.speak(text, {
        onStart: () => this.setCore('speaking'),
        onEnd: () => this.setCore('idle'),
      });
    } else {
      this.setCore('idle');
    }
  }

  typeOut(textEl, visible, fullHtml) {
    if (prefersReduced || visible.length > 900) {
      textEl.innerHTML = formatRich(fullHtml);
      this.scrollLog();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let i = 0;
      const chunk = Math.max(1, Math.round(visible.length / 70));
      const step = () => {
        i = Math.min(visible.length, i + chunk);
        textEl.textContent = visible.slice(0, i);
        this.scrollLog();
        if (i < visible.length) {
          setTimeout(step, 14);
        } else {
          textEl.innerHTML = formatRich(fullHtml);
          this.scrollLog();
          resolve();
        }
      };
      step();
    });
  }

  submit(raw) {
    const text = String(raw || '').trim();
    if (!text) return this.queue;

    this.dom.input.value = '';
    this.history.unshift(text);
    this.history = this.history.slice(0, 40);
    this.historyIndex = -1;

    this.pushMessage('user', text);
    audio.send();
    this.setCore('thinking');
    this.setLed('thinking');

    this.queue = this.queue
      .then(async () => {
        try {
          const result = await this.brain.handle(text);
          if (result && result.text) {
            await this.say(result.text, { speak: !result.silent });
          }
        } catch (err) {
          console.error('[jarvis] command failed', err);
          this.sys('command fault — see console');
          await this.say('Something glitched in my routing layer. Try rephrasing that one.', { speak: false });
        } finally {
          if (!this.listening && this.coreState !== 'speaking') {
            this.setCore('idle');
            this.setLed('idle');
          }
        }
      })
      .catch(() => {});

    return this.queue;
  }

  /* ══ core / status ════════════════════════════════════════ */

  setCore(next) {
    if (!CORE_LABELS[next]) next = 'idle';
    this.coreState = next;
    this.dom.core.dataset.state = next;
    this.dom.coreState.textContent = CORE_LABELS[next];
    this.dom.coreMeter.style.width = `${CORE_POWER[next]}%`;
    if (next !== 'standby') this.setLed(next === 'listening' ? 'listening' : next === 'thinking' ? 'thinking' : next === 'speaking' ? 'speaking' : 'idle');
  }

  setLed(stateName) {
    this.dom.led.dataset.state = stateName;
  }

  uptimeString() {
    const secs = Math.round((Date.now() - this.bootedAt) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  refreshName() {
    document.title = `JARVIS${state.name ? ` · ${state.name}` : ''} — Personal Assistant`;
  }

  /* ══ clock + telemetry ════════════════════════════════════ */

  startClock() {
    const paint = () => {
      const now = new Date();
      this.dom.clockTime.textContent = now.toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      this.dom.clockDate.textContent = now.toLocaleDateString([], {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      this.dom.coreUptime.textContent = `UPTIME ${this.uptimeString()}`;
    };
    paint();
    setInterval(paint, 1000);
  }

  startTelemetry() {
    const info = deviceInfo();
    const set = (key, value) => {
      const node = this.dom.specs.querySelector(`[data-spec="${key}"]`);
      if (node) node.textContent = value;
    };
    set('platform', `${info.platform} · ${info.browser}`);
    set('cores', info.cores);
    set('memory', info.memory);
    set('screen', info.screen);
    set('battery', 'probing…');
    set('storage', `${(storedBytes() / 1024).toFixed(1)} KB`);

    this.dom.pillNet.querySelector('.pill-label').textContent = info.online ? 'LOCAL MODE' : 'OFFLINE';

    const updateBattery = async () => {
      const b = await batteryInfo();
      set('battery', b ? `${b.level}%${b.charging ? ' ⚡' : ''}` : 'Not exposed');
    };
    updateBattery();
    setInterval(updateBattery, 45000);

    const canvases = {
      cpu: this.dom.specs.closest('.telemetry').querySelector('[data-metric="cpu"] canvas'),
      ram: this.dom.specs.closest('.telemetry').querySelector('[data-metric="ram"] canvas'),
      net: this.dom.specs.closest('.telemetry').querySelector('[data-metric="net"] canvas'),
    };

    const sampleOnce = () => {
      const values = this.load();
      this.series.cpu.push(values.cpu);
      this.series.ram.push(values.ram);
      this.series.net.push(values.net);
      for (const key of Object.keys(this.series)) {
        if (this.series[key].length > 48) this.series[key].shift();
      }
      ['cpu', 'ram', 'net'].forEach((key) => {
        const canvas = canvases[key];
        if (!canvas) return;
        this.drawSpark(canvas, this.series[key]);
        const row = canvas.closest('.spark-row');
        const out = row?.querySelector('.spark-value');
        if (out) out.textContent = `${values[key]}%`;
      });
      const row = canvases.cpu?.closest('.telemetry');
      if (row) {
        const temp = row.querySelector('[data-spec="temp"]');
        if (temp) temp.textContent = `${values.temp}°C`;
      }
      if (this.coreState === 'idle') {
        this.dom.coreMeter.style.width = `${48 + values.cpu * 0.45}%`;
      }
    };

    for (let i = 0; i < 24; i += 1) sampleOnce();
    setInterval(sampleOnce, 1000);
    setInterval(() => {
      set('storage', `${(storedBytes() / 1024).toFixed(1)} KB`);
    }, 4000);
  }

  drawSpark(canvas, values) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const w = rect.width;
    const h = rect.height;
    const pad = 2;
    const step = values.length > 1 ? w / (values.length - 1) : w;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${this.accentRgb}, 0.34)`);
    grad.addColorStop(1, `rgba(${this.accentRgb}, 0)`);

    const line = new Path2D();
    values.forEach((v, i) => {
      const x = i * step;
      const y = h - pad - (Math.min(100, Math.max(0, v)) / 100) * (h - pad * 2);
      if (i === 0) line.moveTo(x, y);
      else line.lineTo(x, y);
    });

    const area = new Path2D(line);
    area.lineTo(w, h);
    area.lineTo(0, h);
    area.closePath();

    ctx.fillStyle = grad;
    ctx.fill(area);

    ctx.strokeStyle = `rgba(${this.accentRgb}, 0.95)`;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.shadowColor = `rgba(${this.accentRgb}, 0.8)`;
    ctx.shadowBlur = 6;
    ctx.stroke(line);
    ctx.shadowBlur = 0;

    const lastX = (values.length - 1) * step;
    const lastY = h - pad - (Math.min(100, Math.max(0, values[values.length - 1])) / 100) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  startFps() {
    let frames = 0;
    let last = performance.now();
    const loop = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        const fps = Math.round((frames * 1000) / (now - last));
        this.dom.statusMid.textContent = `FPS ${fps}`;
        frames = 0;
        last = now;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ══ timer ════════════════════════════════════════════════ */

  initTimerUI() {
    this.dom.dial.style.strokeDasharray = '351.858';
    this.dom.dial.style.strokeDashoffset = '351.858';
    this.updateTimerUI();
  }

  startTimer(seconds, label = 'Timer') {
    this.cancelAlarm();
    this.dom.timerPanel.classList.remove('is-alert');
    this.timer = {
      total: seconds,
      remaining: seconds,
      running: true,
      paused: false,
      endAt: performance.now() + seconds * 1000,
      label,
    };
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.tickTimer(), 200);
    this.dom.timerPanel.classList.add('is-running');
    audio.listenOn();
    this.updateTimerUI();
  }

  tickTimer() {
    if (!this.timer.running || this.timer.paused) return;
    this.timer.remaining = Math.max(0, (this.timer.endAt - performance.now()) / 1000);
    if (this.timer.remaining <= 0) {
      this.finishTimer();
      return;
    }
    this.updateTimerUI();
  }

  finishTimer() {
    clearInterval(this.timerInterval);
    const { total, label } = this.timer;
    this.timer.running = false;
    this.timer.remaining = 0;
    this.dom.timerPanel.classList.remove('is-running');
    this.dom.timerPanel.classList.add('is-alert');
    this.updateTimerUI();

    this.alarmStop = audio.alarm('timer');
    this.toast('TIMER COMPLETE', `${label === 'Timer' ? 'Your timer' : label} — ${humanDuration(total)} elapsed.`);
    this.say(`Timer complete${label !== 'Timer' ? `, ${label}` : ''}. ${humanDuration(total)} elapsed.`);
    this.setCore('speaking');

    this.timerAlertTimeout = setTimeout(() => {
      this.cancelAlarm();
      this.dom.timerPanel.classList.remove('is-alert');
      this.dom.timerMode.textContent = 'IDLE';
    }, 12000);
  }

  cancelAlarm() {
    if (this.alarmStop) {
      this.alarmStop();
      this.alarmStop = null;
    }
    clearTimeout(this.timerAlertTimeout);
  }

  stopTimer() {
    const wasActive = this.timer.running || this.timer.paused || this.timer.remaining > 0;
    clearInterval(this.timerInterval);
    this.cancelAlarm();
    this.timer = { total: 0, remaining: 0, running: false, paused: false, endAt: 0, label: 'Timer' };
    this.dom.timerPanel.classList.remove('is-running', 'is-alert');
    this.updateTimerUI();
    return wasActive;
  }

  pauseTimer() {
    if (!this.timer.running || this.timer.paused) return false;
    this.timer.remaining = Math.max(0, (this.timer.endAt - performance.now()) / 1000);
    this.timer.paused = true;
    this.timer.running = false;
    clearInterval(this.timerInterval);
    this.dom.timerPanel.classList.remove('is-running');
    this.updateTimerUI();
    return true;
  }

  resumeTimer() {
    if (!this.timer.paused || this.timer.remaining <= 0) return false;
    this.timer.paused = false;
    this.timer.running = true;
    this.timer.endAt = performance.now() + this.timer.remaining * 1000;
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.tickTimer(), 200);
    this.dom.timerPanel.classList.add('is-running');
    this.updateTimerUI();
    return true;
  }

  updateTimerUI() {
    const { total, remaining, running, paused, label } = this.timer;
    this.dom.timerTime.textContent = clock(remaining);
    this.dom.timerLabel.textContent = total > 0 ? label : 'NO TIMER SET';
    this.dom.btnTimerToggle.textContent = running ? 'PAUSE' : paused ? 'RESUME' : 'START';

    const fraction = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;
    this.dom.dial.style.strokeDashoffset = String(351.858 * (1 - fraction * 1));

    this.dom.timerMode.textContent = total === 0
      ? 'IDLE'
      : running
        ? 'RUNNING'
        : paused
          ? 'PAUSED'
          : remaining <= 0
            ? 'COMPLETE'
            : 'READY';
  }

  /* ══ reminders ════════════════════════════════════════════ */

  scheduleReminders() {
    clearInterval(this.reminderInterval);
    this.checkReminders();
    this.reminderInterval = setInterval(() => this.checkReminders(), 5000);
  }

  checkReminders() {
    const now = Date.now();
    let changed = false;
    state.reminders.forEach((reminder) => {
      if (!reminder.fired && reminder.due <= now) {
        reminder.fired = true;
        changed = true;
        this.fireReminder(reminder);
      }
    });
    if (changed) {
      save();
      this.modules?.render();
    }
  }

  fireReminder(reminder) {
    this.toast('REMINDER', reminder.text);
    this.alarmStop = audio.alarm('reminder');
    setTimeout(() => this.cancelAlarm(), 9000);

    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('JARVIS reminder', { body: reminder.text, tag: reminder.id });
      }
    } catch {
      /* notifications are best-effort */
    }

    this.sys(`alert fired · ${reminder.text}`);
    this.say(`Reminder: ${reminder.text}`);
  }

  async ensureNotificationPermission() {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {
      /* ignore */
    }
  }

  remindFromText(raw) {
    const text = /^(remind me|reminder|set a reminder)\b/i.test(raw) ? raw : `remind me ${raw}`;
    this.submit(text);
  }

  /* ══ voice ════════════════════════════════════════════════ */

  detectMicSupport() {
    if (speech.canListen()) {
      this.dom.micHint.textContent = 'Speak a command — or type below. Audio stays in this browser.';
      return;
    }
    this.dom.btnMic.disabled = true;
    this.dom.micLabel.textContent = 'VOICE UNAVAILABLE';
    this.dom.micHint.textContent = 'This browser has no speech recognition. Typing works everywhere.';
  }

  toggleMic() {
    if (!speech.canListen()) {
      this.toast('VOICE INPUT', 'Speech recognition is not available in this browser. Use the console instead.');
      return;
    }
    if (this.listening) {
      this.recognizer?.stop();
      return;
    }
    if (!this.recognizer) {
      this.recognizer = speech.createRecognizer({
        onStart: () => {
          this.listening = true;
          this.dom.btnMic.setAttribute('aria-pressed', 'true');
          this.dom.micLabel.textContent = 'LISTENING';
          this.setCore('listening');
          this.setLed('listening');
          speech.stopSpeaking();
          audio.listenOn();
        },
        onPartial: (text) => {
          this.dom.input.value = text;
        },
        onEnd: (finalText) => {
          this.listening = false;
          this.dom.btnMic.setAttribute('aria-pressed', 'false');
          this.dom.micLabel.textContent = 'PRESS TO SPEAK';
          audio.listenOff();
          if (!finalText) {
            this.dom.input.value = '';
            this.setCore(this.coreState === 'standby' ? 'standby' : 'idle');
            this.setLed('idle');
          }
        },
        onResult: (finalText) => {
          this.submit(finalText);
        },
        onError: (code) => {
          this.listening = false;
          this.dom.btnMic.setAttribute('aria-pressed', 'false');
          this.dom.micLabel.textContent = 'PRESS TO SPEAK';
          this.setCore('idle');
          this.setLed('idle');
          const messages = {
            'not-allowed': 'Microphone access was blocked. Allow it in your browser settings.',
            'service-not-allowed': 'Microphone access was blocked by the browser.',
            'no-speech': 'I did not hear anything. Try again a little closer to the mic.',
            'audio-capture': 'No microphone was found on this device.',
            network: 'The speech service needs a network connection.',
            aborted: '',
          };
          const message = messages[code] ?? `Voice input error: ${code}.`;
          if (message) {
            this.toast('VOICE INPUT', message);
            audio.error();
          }
        },
      });
    }
    try {
      this.recognizer.start();
    } catch {
      /* start() throws if already running */
    }
  }

  /* ══ module façade ════════════════════════════════════════ */

  refreshModules() {
    this.modules.render();
  }

  openTab(name) {
    this.modules.openTab(name);
  }

  /* ══ settings / chrome ════════════════════════════════════ */

  refreshToggles() {
    this.dom.btnSound.setAttribute('aria-pressed', String(state.settings.sound !== false));
    this.dom.btnVoice.setAttribute('aria-pressed', String(state.settings.voice !== false));
  }

  setVoice(on) {
    state.settings.voice = Boolean(on);
    save();
    this.refreshToggles();
    if (!on) speech.stopSpeaking();
  }

  setSound(on) {
    state.settings.sound = Boolean(on);
    save();
    this.refreshToggles();
    if (on) audio.click();
  }

  applyAccent(name, { silent = false } = {}) {
    const accent = ACCENTS.includes(name) ? name : 'cyan';
    document.documentElement.dataset.accent = accent;
    state.settings.accent = accent;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    this.accentRgb = raw || this.accentRgb;
    if (!silent) save();
  }

  cycleAccent() {
    const current = ACCENTS.indexOf(document.documentElement.dataset.accent);
    const next = ACCENTS[(current + 1) % ACCENTS.length];
    this.applyAccent(next);
    audio.click();
    return next;
  }

  beep(kind) {
    if (kind === 'done') audio.receive();
    else if (kind === 'error') audio.error();
    else audio.click();
  }

  toast(title, body) {
    const el = document.createElement('div');
    el.className = 'toast';

    const icon = document.createElement('div');
    icon.className = 'toast-icon';
    icon.textContent = '◈';

    const wrap = document.createElement('div');
    wrap.className = 'toast-body';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    wrap.append(strong, p);

    el.append(icon, wrap);
    this.dom.toasts.append(el);

    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    }, 5600);

    this.dom.toasts.querySelectorAll('.toast').forEach((t, i, all) => {
      if (all.length - i > 3) t.remove();
    });
  }

  clearLog() {
    this.dom.log.textContent = '';
    this.sys('transcript cleared');
  }

  exportData() {
    const payload = {
      app: 'jarvis',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.toast('BACKUP', 'State exported as JSON.');
  }

  /* ══ standby ═════════════════════════════════════════════ */

  standby() {
    if (this.standbyEl) return;
    const el = document.createElement('div');
    el.className = 'standby';
    el.innerHTML = `
      <div class="standby-inner">
        <div class="standby-dot"></div>
        <p class="standby-title">STANDBY</p>
        <p class="standby-sub">CLICK ANYWHERE OR PRESS ANY KEY TO RESUME</p>
      </div>`;
    document.body.append(el);
    this.standbyEl = el;
    this.setCore('standby');

    const wake = () => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 400);
      this.standbyEl = null;
      this.setCore('idle');
      document.removeEventListener('keydown', wake);
      el.removeEventListener('click', wake);
      this.say('Systems restored. I am here.', { speak: true });
    };
    el.addEventListener('click', wake);
    document.addEventListener('keydown', wake, { once: true });
  }

  /* ══ help ═════════════════════════════════════════════════ */

  buildHelp() {
    this.dom.helpGrid.textContent = '';
    HELP_GROUPS.forEach((group) => {
      const section = document.createElement('div');
      section.className = 'help-group';
      const h3 = document.createElement('h3');
      h3.textContent = group.title;
      const ul = document.createElement('ul');
      group.items.forEach((item) => {
        const li = document.createElement('li');
        const code = document.createElement('code');
        code.textContent = item;
        li.append(code);
        ul.append(li);
      });
      section.append(h3, ul);
      this.dom.helpGrid.append(section);
    });
  }

  openHelp() {
    this.dom.helpModal.hidden = false;
    $('#btn-close-help')?.focus({ preventScroll: true });
  }

  closeHelp() {
    this.dom.helpModal.hidden = true;
    this.dom.input.focus({ preventScroll: true });
  }

  /* ══ chips ════════════════════════════════════════════════ */

  buildChips() {
    const chips = [
      'set a timer for 5 minutes',
      'add task review the pull request',
      'note pick up dry cleaning',
      'remind me in 20 minutes to stretch',
      'status',
      'tell me a joke',
      'convert 10 km to miles',
      'change theme',
    ];
    chips.forEach((label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        audio.click();
        this.submit(label);
      });
      this.dom.chips.append(btn);
    });
  }

  /* ══ events ═══════════════════════════════════════════════ */

  wireEvents() {
    const markInteracted = () => {
      if (this.interacted) return;
      this.interacted = true;
      audio.unlock();
      audio.boot();
    };
    window.addEventListener('pointerdown', markInteracted, { once: true });
    window.addEventListener('keydown', markInteracted, { once: true });

    this.dom.composer.addEventListener('submit', (e) => {
      e.preventDefault();
      audio.unlock();
      this.submit(this.dom.input.value);
    });

    this.dom.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.history.length) return;
        this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
        this.dom.input.value = this.history[this.historyIndex] || '';
        this.dom.input.setSelectionRange(this.dom.input.value.length, this.dom.input.value.length);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyIndex = Math.max(-1, this.historyIndex - 1);
        this.dom.input.value = this.historyIndex >= 0 ? this.history[this.historyIndex] : '';
      }
    });

    this.dom.btnMic.addEventListener('click', () => this.toggleMic());
    this.dom.btnSound.addEventListener('click', () => {
      this.setSound(state.settings.sound === false);
    });
    this.dom.btnVoice.addEventListener('click', () => {
      this.setVoice(state.settings.voice === false);
      if (state.settings.voice) audio.click();
    });
    this.dom.btnAccent.addEventListener('click', () => this.cycleAccent());
    this.dom.btnHelp.addEventListener('click', () => this.openHelp());
    $('#btn-close-help').addEventListener('click', () => this.closeHelp());
    this.dom.helpModal.addEventListener('click', (e) => {
      if (e.target === this.dom.helpModal) this.closeHelp();
    });

    $('#btn-clear').addEventListener('click', () => this.clearLog());
    $('#btn-export').addEventListener('click', () => this.exportData());

    // timer controls
    this.dom.btnTimerToggle.addEventListener('click', () => {
      audio.click();
      if (this.timer.running) this.pauseTimer();
      else if (this.timer.paused) this.resumeTimer();
      else this.startTimer((this.timer.total || 300), this.timer.label);
    });
    this.dom.btnTimerReset.addEventListener('click', () => {
      audio.click();
      this.stopTimer();
    });
    this.dom.presets.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-seconds]');
      if (!btn) return;
      audio.click();
      this.startTimer(parseInt(btn.dataset.seconds, 10), `${btn.textContent.trim()} timer`);
    });

    document.addEventListener('keydown', (e) => {
      const active = document.activeElement?.tagName || '';
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active);
      const onControl = /^(BUTTON|A)$/.test(active);
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.dom.input.focus();
        this.dom.input.select();
        return;
      }
      if (e.key === 'Escape') {
        if (!this.dom.helpModal.hidden) return this.closeHelp();
        if (this.listening) return this.recognizer?.stop();
        if (speech.canSpeak()) speech.stopSpeaking();
        this.dom.input.blur();
        return;
      }
      if (e.key === '?' && !typing) {
        e.preventDefault();
        this.openHelp();
        return;
      }
      if (e.code === 'Space' && !typing && !onControl && !this.standbyEl) {
        e.preventDefault();
        this.toggleMic();
      }
    });

    window.addEventListener('online', () => {
      this.dom.pillNet.querySelector('.pill-label').textContent = 'LOCAL MODE';
      this.toast('NETWORK', 'Connection restored.');
    });
    window.addEventListener('offline', () => {
      this.dom.pillNet.querySelector('.pill-label').textContent = 'OFFLINE';
      this.toast('NETWORK', 'Running fully local — everything still works.');
    });

    window.addEventListener('resize', () => {
      ['cpu', 'ram', 'net'].forEach((key) => {
        const canvas = document.querySelector(`[data-metric="${key}"] canvas`);
        if (canvas) this.drawSpark(canvas, this.series[key]);
      });
    });
  }
}

/* ── go ─────────────────────────────────────────────────── */

const app = new Jarvis();
window.jarvis = app;

app.init().catch((err) => {
  console.error('[jarvis] failed to start', err);
  const boot = document.getElementById('boot');
  if (boot) boot.remove();
});

flush();
