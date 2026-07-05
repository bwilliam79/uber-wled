export function humanizeUptime(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** WLED info.wifi.signal is 0-100 (probed: 98). */
export function signalBars(signal: number): 0 | 1 | 2 | 3 | 4 {
  if (signal >= 80) return 4;
  if (signal >= 60) return 3;
  if (signal >= 40) return 2;
  if (signal > 0) return 1;
  return 0;
}
