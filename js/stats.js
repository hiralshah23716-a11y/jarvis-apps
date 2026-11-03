/* ============================================================
   stats.js — telemetry.
   Real device facts where the browser exposes them, and a stable
   simulated load model for the animated sparklines (the browser
   will not give us true CPU/network figures, so we're honest
   about it in the readout rather than inventing precision).
   ============================================================ */

export function deviceInfo() {
  const nav = navigator;
  const ua = nav.userAgent || '';

  let platform = nav.userAgentData?.platform || nav.platform || 'Unknown';
  platform = platform.replace(/^MacIntel$/, 'macOS').replace(/^Win32$/, 'Windows');

  const memory = nav.deviceMemory ? `${nav.deviceMemory} GB` : 'Not exposed';
  const cores = nav.hardwareConcurrency ? String(nav.hardwareConcurrency) : '—';

  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  const screenStr = window.screen ? `${window.screen.width}×${window.screen.height}` : '—';
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

  return {
    platform,
    browser,
    cores,
    memory,
    screen: `${screenStr} · ${browser}`,
    online: nav.onLine,
    dpr: window.devicePixelRatio ? `${window.devicePixelRatio.toFixed(1)}×` : '—',
    lang: nav.language || '—',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '—',
    connection: conn?.effectiveType ? conn.effectiveType.toUpperCase() : null,
    downlink: conn?.downlink ?? null,
  };
}

export async function batteryInfo() {
  if (!navigator.getBattery) return null;
  try {
    const b = await navigator.getBattery();
    return {
      level: Math.round(b.level * 100),
      charging: b.charging,
      supported: true,
    };
  } catch {
    return null;
  }
}

/** Random-walk load model: plausible, smooth, never wild. */
export function createLoadModel() {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const load = { cpu: 14, ram: 32, net: 18 };
  const target = { cpu: 20, ram: 34, net: 22 };
  let tick = 0;

  const drift = (current, goal, spread, k) =>
    clamp(current + (goal - current) * k + (Math.random() - 0.5) * spread, 1, 99);

  return function sample() {
    tick += 1;
    if (tick % 7 === 0) {
      target.cpu = clamp(10 + Math.random() * 55, 5, 92);
      target.ram = clamp(24 + Math.random() * 40, 18, 88);
      target.net = Math.random() > 0.55 ? clamp(20 + Math.random() * 70, 4, 97) : 4 + Math.random() * 14;
    }

    load.cpu = drift(load.cpu, target.cpu, 7, 0.28);
    load.ram = drift(load.ram, target.ram, 4, 0.16);
    load.net = drift(load.net, target.net, 16, 0.4);

    // Pull real heap usage in where Chrome exposes it.
    if (performance.memory?.usedJSHeapSize && performance.memory.jsHeapSizeLimit) {
      const real = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
      load.ram = clamp(load.ram * 0.4 + real * 12, 4, 96);
    }

    return {
      cpu: Math.round(load.cpu),
      ram: Math.round(load.ram),
      net: Math.round(load.net),
      temp: Math.round(38 + load.cpu * 0.28),
    };
  };
}
