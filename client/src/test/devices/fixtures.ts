import type { Controller, DevicePreset, DeviceSegment, FirmwareStatus } from '../../api/client';
import type { LiveInfo, LiveState, LiveStatusEntry } from '../../api/live';

/**
 * Verbatim read-only probe of http://192.168.1.86/json/cfg (2026-07-05, WLED
 * 16.0.0 "Niji", vid 2605030), trimmed to the sections Phase F touches plus
 * the usermod block. The unknown per-row keys (ledma/freq/ref/drv/text) and
 * unknown sync keys (espnow/btn/va/ret) are the canary values: they MUST
 * survive every patch this phase builds.
 */
export const PROBED_CFG = {
  rev: [1, 0],
  vid: 2605030,
  id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false },
  nw: {
    espnow: false,
    linked_remote: [''],
    ins: [
      { ssid: 'Williams', pskl: 10, bssid: '', ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }
    ],
    dns: [8, 8, 8, 8]
  },
  ap: { ssid: 'WLED-AP', pskl: 8, chan: 1, hide: 0, behav: 0, ip: [4, 3, 2, 1] },
  wifi: { sleep: false, phy: false, txpwr: 78 },
  hw: {
    led: {
      total: 48, maxpwr: 0, cct: false, cr: false, ic: false, cb: 0, fps: 42, rgbwm: 255,
      ins: [
        { start: 0, len: 39, pin: [16], order: 34, rev: true, skip: 0, type: 30,
          ref: false, rgbwm: 2, freq: 0, maxpwr: 0, ledma: 55, drv: 0, text: '' },
        { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30,
          ref: false, rgbwm: 2, freq: 0, maxpwr: 0, ledma: 55, drv: 0, text: '' }
      ]
    },
    relay: { pin: 15, rev: true, odrain: false }
  },
  light: {
    'scale-bri': 100, 'pal-mode': 0, aseg: true,
    gc: { bri: 1, col: 2.8, val: 2.8 },
    tr: { dur: 7, rpc: 5, hrp: true },
    nl: { mode: 1, dur: 60, tbri: 0, macro: 0 }
  },
  def: { ps: 1, on: false, bri: 128 },
  if: {
    sync: {
      port0: 21324, port1: 65506, espnow: false,
      recv: { bri: true, col: true, fx: true, pal: true, grp: 1, seg: false, sb: false },
      send: { en: false, dir: true, btn: false, va: false, hue: true, grp: 1, ret: 0 }
    },
    ntp: { en: true, host: '0.wled.pool.ntp.org', tz: 5, offset: 0, ampm: false, ln: -96.78, lt: 33.24 }
  },
  um: {
    AudioReactive: {
      enabled: false, 'add-palettes': false,
      analogmic: { pin: -1 },
      config: { squelch: 10, gain: 30, AGC: 1 },
      sync: { port: 11988, mode: 0 }
    }
  }
};

/** Deep copy so tests can mutate freely. */
export function probedCfg(): Record<string, any> {
  return structuredClone(PROBED_CFG);
}

export const CONTROLLERS: Controller[] = [
  { id: 'c1', name: 'Cabinet Lights', host: '192.168.1.86', source: 'discovered', stale: false, pinnedAssetPattern: 'ESP32' },
  { id: 'c2', name: 'Porch', host: '10.0.0.51', source: 'manual', stale: true, pinnedAssetPattern: null }
];

/** /json/info probe subset (uptime 2791487 s = 32d 7h; signal 98; fs in KiB). */
export const LIVE_INFO: LiveInfo = {
  name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
  leds: { count: 48, rgbw: true, cct: false, seglc: [3, 3], fps: 42, pwr: 470, maxseg: 32 },
  wifi: { bssid: 'AA:BB:CC:DD:EE:FF', rssi: -51, signal: 98, channel: 6 },
  fs: { u: 28, t: 983 },
  arch: 'esp32', core: 'v3.3.6', mac: 'c0c3dc112233', ip: '192.168.1.86',
  uptime: 2791487, freeheap: 120876,
  u: { AudioReactive: {} }
};

export const SEGMENTS: DeviceSegment[] = [
  { id: 0, start: 0, stop: 39, len: 39, grp: 1, spc: 0, of: 0, on: true, bri: 255,
    rev: false, mi: false, n: 'Cabinet run', fx: 0, pal: 0,
    col: [[255, 160, 60, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { id: 1, start: 39, stop: 48, len: 9, grp: 1, spc: 0, of: 0, on: true, bri: 200,
    rev: false, mi: false, fx: 12, pal: 4,
    col: [[0, 80, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
];

// Excess fields mirror the real /json/state payload; cast because Phase D's
// LiveSegment declares only the fields the Control surface reads.
export const LIVE_STATE = {
  on: true, bri: 128, transition: 7, ps: 1, pl: -1,
  nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 },
  mainseg: 0,
  seg: SEGMENTS
} as unknown as LiveState;

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 1, name: 'Warm evening', isPlaylist: false, quicklook: { fx: 0, pal: 0, on: true, bri: 128 } },
  { id: 2, name: 'Party loop', isPlaylist: true }
];

export const FIRMWARE_OK: FirmwareStatus = {
  installedVersion: '16.0.0', latestTag: 'v16.1.0', updateAvailable: true,
  isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: []
};

export function liveEntry(overrides: Partial<LiveStatusEntry> = {}): LiveStatusEntry {
  return { reachable: true, state: LIVE_STATE, info: LIVE_INFO, ...overrides };
}

export function liveMap(entries: Record<string, LiveStatusEntry>): Map<string, LiveStatusEntry> {
  return new Map(Object.entries(entries));
}
