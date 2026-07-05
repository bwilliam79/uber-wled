const KEY = 'uber-wled.recent-colors';
const MAX = 12;

export function getRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentColor(hex: string): string[] {
  const normalized = hex.toLowerCase();
  const next = [normalized, ...getRecentColors().filter((c) => c !== normalized)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable/full — recents are best-effort
  }
  return next;
}
