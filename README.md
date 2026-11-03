# JARVIS

A local-first, JARVIS-style assistant interface that runs entirely in the browser.
No accounts, no server, no build step — open it and start talking or typing.

![no dependencies](https://img.shields.io/badge/dependencies-none-38e8ff) ![vanilla JS](https://img.shields.io/badge/vanilla-JS-38e8ff) ![local only](https://img.shields.io/badge/data-local--only-38e8ff)

## What it does

- **Command console** — a natural-language router that understands timers, reminders,
  tasks, notes, arithmetic, unit conversion, system queries and a few diversions.
- **Voice input & spoken replies** — Web Speech API (`SpeechRecognition` +
  `SpeechSynthesis`) with a JARVIS-ish voice preference, and full graceful fallback
  to typing in browsers without support.
- **Chronometer** — countdown timer with a progress dial, pause/resume, presets and a
  synthesised alarm (Web Audio API, no audio files).
- **Modules** — persistent tasks, notes and scheduled alerts, all saved to
  `localStorage` on every change.
- **Telemetry** — real device facts (cores, memory, battery, screen, storage) plus
  animated CPU / memory / network sparklines drawn on canvas.
- **Interface** — animated arc-reactor core, HUD panels, four accent themes, sound
  effects, boot sequence, standby mode, keyboard shortcuts, reduced-motion support
  and a responsive layout down to phone width.

## Run it

No tooling needed. Any static server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Voice input requires Chrome, Edge or Safari and a `localhost`/HTTPS origin.
> Typing works everywhere, including `file://`.

## Try these

```
set a timer for 5 minutes
remind me in 20 minutes to stretch
remind me at 7pm to call home
add task review the pull request
complete task 2
note buy oat milk
12 * 8 + 4
20% of 250
convert 10 km to miles
72 f to c
status
battery
flip a coin
tell me a joke
change theme
mute
standby
```

Press <kbd>?</kbd> in the app for the full directory.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> | Focus the console |
| <kbd>Space</kbd> | Start/stop listening |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Walk command history |
| <kbd>Esc</kbd> | Close overlay / stop speaking |
| <kbd>?</kbd> | Command directory |

## Structure

```
index.html          markup and static chrome
css/base.css        design tokens, reset, topbar, panels, modal, boot
css/hud.css         core reactor, telemetry, console, chronometer, modules, responsive
js/app.js           orchestrator: DOM, render loops, timer engine, mic, boot
js/commands.js      the command router, parser, safe maths, unit conversion
js/widgets.js       tasks / notes / alerts panes
js/speech.js        speech synthesis + recognition wrappers
js/audio.js         Web Audio sound design (beeps, alarms)
js/stats.js         device probes + simulated load model
js/store.js         localStorage persistence
```

## Notes on privacy & honesty

Everything JARVIS stores lives in `localStorage` under `jarvis.state.v1`; Export
downloads a JSON copy. There are no analytics, no remote calls and no API keys.
The telemetry sparklines are a smooth simulated load model — browsers do not expose
real CPU or network figures — and the interface says so rather than pretending.
