/**
 * Populated stand-in data for local UI work and tests.
 * Documentation addresses only (RFC 5737). No real names, hosts, or MAC addresses.
 * Production builds never install this; `installDevFixtures` no-ops unless
 * `import.meta.env.DEV` and `VITE_FIXTURES=1`.
 */

const CONTROLLERS = [
  { id: 'fx-a', name: 'Controller A', host: '192.0.2.10', source: 'manual', stale: false, pinnedAssetPattern: 'ESP32' },
  { id: 'fx-b', name: 'Controller B', host: '198.51.100.20', source: 'discovered', stale: false, pinnedAssetPattern: null }
];

const THEMES = [
  {
    id: 'theme-a', name: 'Theme A', effect: 0, palette: 0,
    colors: [[255, 140, 0], [0, 0, 0], [0, 0, 0]],
    brightness: 160, speed: 128, intensity: 128, directions: null
  }
];

const SCHEDULES = [
  {
    id: 'sched-a', name: 'Schedule A', triggerType: 'weekly', cronExpr: null,
    daysOfWeek: [1, 3, 5], timeOfDay: '18:00', offsetMinutes: 0,
    latitude: null, longitude: null, groupId: 'room-a', controllers: null,
    actionType: 'theme', actionPayload: { themeId: 'theme-a' },
    offTrigger: null, enabled: true
  }
];

const EVENTS = [
  {
    id: 'event-a', name: 'Date A', category: 'custom',
    dateRule: { kind: 'fixed', month: 11, day: 5 }, recursYearly: true, enabled: true,
    groupId: null, controllers: [{ controllerId: 'fx-a', wledSegId: null }],
    triggerTime: { type: 'fixed', time: '20:00' }, offTrigger: null,
    actionType: 'power', actionPayload: { on: false }
  }
];

const GROUPS = [
  { id: 'room-a', name: 'Room A', icon: null, sortOrder: 0, members: [{ controllerId: 'fx-a', wledSegId: 0 }] }
];

const SYNC_GROUPS = [
  { id: 'sync-a', name: 'Sync A', active: false, bitmask: null, memberControllerIds: ['fx-a', 'fx-b'] }
];

const SETTINGS = {
  includePrereleaseFirmware: false,
  homeLatitude: null,
  homeLongitude: null,
  discoveryRescanIntervalMinutes: 5,
  scheduleImportDisableOnDeviceDefault: false,
  controllerStatusPollIntervalMinutes: 5,
  livePollIntervalSeconds: 2
};

function firmware(id: string) {
  const pinned = id === 'fx-a';
  return {
    installedVersion: '0.15.0',
    latestTag: pinned ? 'v0.15.1' : 'v0.15.0',
    updateAvailable: pinned,
    isPrerelease: false,
    pinnedAssetPattern: pinned ? 'ESP32' : null,
    candidateAssets: [{ name: 'WLED_0.15.1_ESP32.bin', downloadUrl: 'https://example.invalid/wled.bin' }],
    recommendedAssetName: 'WLED_0.15.1_ESP32.bin',
    detectedArch: 'esp32',
    unreachable: false
  };
}

function liveEvent(id: string, name: string, host: string) {
  return {
    controllerId: id,
    reachable: true,
    info: {
      name, ver: '0.15.0',
      leds: { count: 60, rgbw: false, cct: 0, fps: 42 },
      arch: 'esp32', ip: host
    },
    state: {
      on: true, bri: 128, transition: 7, ps: -1, pl: -1,
      nl: { on: false, dur: 60, mode: 0, tbri: 0, rem: -1 },
      mainseg: 0,
      seg: [{ id: 0, start: 0, stop: 60, on: true, bri: 128, col: [[255, 140, 0]], fx: 0, sx: 128, ix: 128, pal: 0, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false }]
    }
  };
}

export const FIXTURE_LIVE = [
  liveEvent('fx-a', 'Controller A', '192.0.2.10'),
  liveEvent('fx-b', 'Controller B', '198.51.100.20')
];

/** JSON body for a known dev GET, or undefined to let the request through. */
export function fixtureJson(url: string, method: string): unknown | undefined {
  if (method !== 'GET') return undefined;
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (path === '/api/controllers') return CONTROLLERS;
  if (path === '/api/themes') return THEMES;
  if (path === '/api/schedules') return SCHEDULES;
  if (path === '/api/calendar-events') return EVENTS;
  if (path === '/api/groups') return GROUPS;
  if (path === '/api/sync-groups') return SYNC_GROUPS;
  if (path === '/api/settings') return SETTINGS;
  if (path === '/api/version') return { version: '2.22.1' };
  if (path === '/api/auto-backups') return [];
  const firmwareMatch = path.match(/^\/api\/controllers\/([^/]+)\/firmware$/);
  if (firmwareMatch) return firmware(firmwareMatch[1]);
  const statusMatch = path.match(/^\/api\/controllers\/([^/]+)\/status$/);
  if (statusMatch) {
    const known = CONTROLLERS.some((item) => item.id === statusMatch[1]);
    if (!known) return undefined;
    const live = FIXTURE_LIVE.find((item) => item.controllerId === statusMatch[1]);
    return {
      controllerId: statusMatch[1],
      reachable: true,
      info: live?.info ?? null,
      state: live?.state ?? null,
      polledAt: '2026-11-05T00:00:00.000Z'
    };
  }
  return undefined;
}

export function installDevFixtures(): void {
  if (!import.meta.env.DEV || import.meta.env.VITE_FIXTURES !== '1') return;
  const original = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = fixtureJson(url, method);
    if (body !== undefined) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return original(input, init);
  }) as typeof window.fetch;

  class FixtureEventSource extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    url: string;
    readyState = 1;
    withCredentials = false;
    onopen: ((this: EventSource, ev: Event) => void) | null = null;
    onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;
    onerror: ((this: EventSource, ev: Event) => void) | null = null;
    constructor(url: string) {
      super();
      this.url = url;
      queueMicrotask(() => {
        for (const event of FIXTURE_LIVE) {
          this.dispatchEvent(new MessageEvent('status', { data: JSON.stringify(event) }));
        }
      });
    }
    close() {
      this.readyState = 2;
    }
  }
  window.EventSource = FixtureEventSource as unknown as typeof EventSource;
}
