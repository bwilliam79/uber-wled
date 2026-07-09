// A tiny persisted cache of device-reported (friendly) controller names.
//
// The stored `controller.name` is frozen at add/discovery time and is often
// the raw mDNS service name (e.g. "cabinet-lights"); the friendly name a user
// set on the device (e.g. "Cabinet Lights") only arrives via the live status
// stream. Every name-showing page opens its own stream starting from empty, so
// the name visibly flashes mDNS → friendly on each mount. Remembering the last
// friendly name (in localStorage) lets those pages render it immediately —
// the live stream still corrects it if the device is renamed.

const STORAGE_KEY = 'uwled.deviceNames';
let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
}

export function cachedDeviceName(id: string): string | undefined {
  return load()[id];
}

export function rememberDeviceName(id: string, name: string | undefined | null): void {
  if (!name) return;
  const c = load();
  if (c[id] === name) return;
  c[id] = name;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore persistence failures (private mode, quota) */
  }
}
