/**
 * Pure patch builders for the Config tab. BINDING server semantics (Phase B
 * configDiff.ts): objects deep-merge — only patched keys are compared/applied;
 * arrays REPLACE wholesale. Therefore every array this module emits
 * (hw.led.ins, nw.ins) contains COMPLETE rows merged over the device's
 * current cfg rows, so unknown per-row fields (ref, drv, text, …) survive
 * every save.
 */
export type Cfg = Record<string, any>;

/**
 * WLED bus type ids (wled00/const.h TYPE_*). 30 verified on the probed
 * SK6812 RGBW strip; 45 (TYPE_ANALOG_5CH) verified on desk-lights' 5-pin PWM
 * output. Digital 16-39, analog/PWM 40-47, SPI 48-63, HUB75 64-71, virtual/
 * network 80-95 per const.h's TYPE_*_MIN/MAX markers.
 */
export const LED_TYPES: { value: number; label: string }[] = [
  { value: 22, label: 'WS281x (WS2812/WS2815 RGB)' },
  { value: 18, label: 'WS2812 single-white' },
  { value: 19, label: 'WS2812 single-white (x3 per IC)' },
  { value: 20, label: 'WS2812 CCT' },
  { value: 21, label: 'WS2812 WWA' },
  { value: 23, label: 'GS8608' },
  { value: 24, label: 'WS2811 400kHz' },
  { value: 25, label: 'TM1829' },
  { value: 26, label: 'UCS8903 (16-bit RGB)' },
  { value: 27, label: 'APA106' },
  { value: 28, label: 'FW1906 (RGB + CW + WW)' },
  { value: 29, label: 'UCS8904 (16-bit RGBW)' },
  { value: 30, label: 'SK6812 / WS2814 RGBW' },
  { value: 31, label: 'TM1814 (RGBW)' },
  { value: 32, label: 'WS2805 (RGB + WW + CW)' },
  { value: 33, label: 'TM1914 (RGB)' },
  { value: 34, label: 'SM16825 (RGB + WW + CW)' },
  { value: 40, label: 'On/Off (relay, no dimming)' },
  { value: 41, label: 'Analog (PWM) single channel' },
  { value: 42, label: 'Analog (PWM) WW + CW' },
  { value: 43, label: 'Analog (PWM) RGB' },
  { value: 44, label: 'Analog (PWM) RGBW' },
  { value: 45, label: 'Analog (PWM) RGB + WW + CW' },
  { value: 46, label: 'Analog (PWM) RGB + Amber + WW + CW' },
  { value: 50, label: 'WS2801 (SPI)' },
  { value: 51, label: 'APA102 / SK9822 (SPI)' },
  { value: 52, label: 'LPD8806 (SPI)' },
  { value: 53, label: 'P9813 (SPI)' },
  { value: 54, label: 'LPD6803 (SPI)' },
  { value: 65, label: 'HUB75 matrix (16 colors/px)' },
  { value: 66, label: 'HUB75 matrix (64 colors/px)' },
  { value: 80, label: 'Network: DDP (RGB)' },
  { value: 81, label: 'Network: E1.31 (RGB)' },
  { value: 82, label: 'Network: Art-Net (RGB)' },
  { value: 88, label: 'Network: DDP (RGBW)' },
  { value: 89, label: 'Network: Art-Net (RGBW)' }
];

/** Low nibble of the per-output `order` byte (const.h COL_ORDER_*, verified 34 & 0x0f = 2 → BRG). */
export const COLOR_ORDERS: { value: number; label: string }[] = [
  { value: 0, label: 'GRB' }, { value: 1, label: 'RGB' }, { value: 2, label: 'BRG' },
  { value: 3, label: 'RBG' }, { value: 4, label: 'BGR' }, { value: 5, label: 'GBR' }
];

/**
 * High nibble of the per-output `order` byte — WLED's white-channel swap
 * (settings_leds.htm: `order = (WO << 4) | CO`). Verified 34 = 0x22 → CO=2
 * (BRG), WO=2 ("W & G" — the white slot swaps with green). Only meaningful
 * for RGBW-capable bus types; harmless (ignored) on RGB-only busses.
 */
export const WHITE_SWAP_MODES: { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'W & B swap' },
  { value: 2, label: 'W & G swap' },
  { value: 3, label: 'W & R swap' },
  { value: 4, label: 'WW & CW (CCT)' }
];

/** Per-output rgbwm (probed 2 = Accurate, tv-lights 0 = None on an RGB-only run). */
export const AUTO_WHITE_MODES: { value: number; label: string }[] = [
  { value: 0, label: 'None' }, { value: 1, label: 'Brighter' }, { value: 2, label: 'Accurate' },
  { value: 3, label: 'Dual' }, { value: 4, label: 'Max' }
];

/**
 * Global hw.led.rgbwm — same 0-4 scale plus 255 = "Disabled" (verified via
 * WLED's settings_leds.htm `<select name="AW">`: value 255 label "Disabled").
 * All 6 probed devices report 255 here; it is a real, writable device-wide
 * default, not a sentinel meaning "unused" — every output still carries its
 * own independent rgbwm.
 */
export const GLOBAL_AUTO_WHITE_MODES: { value: number; label: string }[] = [
  { value: 255, label: 'Disabled' },
  ...AUTO_WHITE_MODES
];

/** WiFi TX power (wifi.txpwr), quarter-dBm units — verified against settings_wifi.htm's `<select name="TX">`. */
export const TX_POWER_OPTIONS: { value: number; label: string }[] = [
  { value: 78, label: '19.5 dBm (max)' },
  { value: 76, label: '19 dBm' },
  { value: 74, label: '18.5 dBm' },
  { value: 68, label: '17 dBm' },
  { value: 60, label: '15 dBm' },
  { value: 52, label: '13 dBm' },
  { value: 44, label: '11 dBm' },
  { value: 34, label: '8.5 dBm' },
  { value: 28, label: '7 dBm' },
  { value: 20, label: '5 dBm' },
  { value: 8, label: '2 dBm' }
];

/** light.nl.mode (nightlight) — verified against settings_leds.htm's `<select name="TW">`. */
export const NIGHTLIGHT_MODES: { value: number; label: string }[] = [
  { value: 0, label: 'Instant (wait and set)' },
  { value: 1, label: 'Fade' },
  { value: 2, label: 'Fade to color' },
  { value: 3, label: 'Sunrise' }
];

export interface OutputDraft {
  pin: number;
  type: number;
  len: number;
  start: number;
  colorOrder: number; // low nibble of `order`
  whiteSwap: number; // high nibble of `order`
  rev: boolean;
  skip: number;
  rgbwm: number;
  ledma: number; // mA per LED, used to derive the ABL current estimate
  maxpwr: number; // per-output max current override, mA (0 = use global/unlimited)
  freq: number; // PWM switching frequency in Hz, analog output types only
}

export function outputDraftFromRow(row: Cfg): OutputDraft {
  const order = Number(row.order) || 0;
  return {
    pin: Array.isArray(row.pin) ? Number(row.pin[0]) : Number(row.pin),
    type: Number(row.type),
    len: Number(row.len),
    start: Number(row.start),
    colorOrder: order & 0x0f,
    whiteSwap: (order >> 4) & 0x0f,
    rev: Boolean(row.rev),
    skip: Number(row.skip ?? 0),
    rgbwm: Number(row.rgbwm ?? 0),
    ledma: Number(row.ledma ?? 0),
    maxpwr: Number(row.maxpwr ?? 0),
    freq: Number(row.freq ?? 0)
  };
}

/**
 * Full replacement row for hw.led.ins[i]. Spreads the probed row first so
 * unknown keys survive; re-encodes `order` from both the color-order and
 * white-swap nibbles.
 */
export function mergeOutputRow(row: Cfg, draft: OutputDraft): Cfg {
  const pin = Array.isArray(row.pin) ? [draft.pin, ...row.pin.slice(1)] : [draft.pin];
  return {
    ...row,
    pin,
    type: draft.type,
    len: draft.len,
    start: draft.start,
    order: ((draft.whiteSwap & 0x0f) << 4) | (draft.colorOrder & 0x0f),
    rev: draft.rev,
    skip: draft.skip,
    rgbwm: draft.rgbwm,
    ledma: draft.ledma,
    maxpwr: draft.maxpwr,
    freq: draft.freq
  };
}

export function buildIdentityPatch(draft: { name: string; mdns: string }): Cfg {
  return { id: { name: draft.name, mdns: draft.mdns } };
}

export interface LedGlobalsDraft {
  /** Sum of every output's `len` — derived, not independently editable (see LedHardwareForm). */
  total: number;
  /** Global ABL max current, mA (0 = unlimited). */
  maxpwr: number;
  /** hw.led.rgbwm — 0-4 or 255 = Disabled (GLOBAL_AUTO_WHITE_MODES). */
  rgbwm: number;
  /** hw.led.fps — target frame rate. */
  fps: number;
}

export function buildLedHardwarePatch(
  cfg: Cfg,
  drafts: OutputDraft[],
  globals: LedGlobalsDraft
): Cfg {
  const rows: Cfg[] = Array.isArray(cfg.hw?.led?.ins) ? cfg.hw.led.ins : [];
  const ins = rows.map((row, i) => (drafts[i] ? mergeOutputRow(row, drafts[i]) : row));
  return {
    hw: { led: { total: globals.total, maxpwr: globals.maxpwr, rgbwm: globals.rgbwm, fps: globals.fps, ins } }
  };
}

export function parseIpv4(text: string): number[] | null {
  const m = text.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

export function formatIpv4(value: unknown): string {
  return Array.isArray(value) && value.length === 4 ? value.join('.') : '0.0.0.0';
}

export interface WifiDraft {
  ssid: string;
  password: string; // '' = keep the stored password (WLED never returns it, only pskl)
  staticIp: string;
  gateway: string;
  subnet: string;
  apSsid: string;
  apPassword: string;
  apChannel: number;
  apHide: boolean;
  /** Top-level `wifi` radio settings — previously unbound entirely. */
  wifiSleep: boolean; // wifi.sleep: modem-sleep power saving (adds latency)
  wifiForceG: boolean; // wifi.phy: force 802.11g-only mode
  txPower: number; // wifi.txpwr, quarter-dBm (TX_POWER_OPTIONS)
}

export function buildWifiPatch(cfg: Cfg, draft: WifiDraft): Cfg {
  const row0: Cfg = (cfg.nw?.ins?.[0] as Cfg) ?? {};
  const merged: Cfg = {
    ...row0,
    ssid: draft.ssid,
    ip: parseIpv4(draft.staticIp) ?? [0, 0, 0, 0],
    gw: parseIpv4(draft.gateway) ?? [0, 0, 0, 0],
    sn: parseIpv4(draft.subnet) ?? [255, 255, 255, 0]
  };
  if (draft.password !== '') merged.psk = draft.password;
  const ap: Cfg = { ssid: draft.apSsid, chan: draft.apChannel, hide: draft.apHide ? 1 : 0 };
  if (draft.apPassword !== '') ap.psk = draft.apPassword;
  return {
    nw: { ins: [merged] },
    ap,
    wifi: { sleep: draft.wifiSleep, phy: draft.wifiForceG, txpwr: draft.txPower }
  };
}

export interface SyncDraft {
  port0: number; port1: number;
  recvBri: boolean; recvCol: boolean; recvFx: boolean; recvPal: boolean;
  recvSeg: boolean; recvSb: boolean; recvGroups: number;
  sendEn: boolean; sendDir: boolean; sendHue: boolean; sendGroups: number;
  /** if.sync.espnow and the two send flags that were probed but never bound. */
  espnow: boolean;
  sendBtn: boolean;
  sendVa: boolean;
}

export function buildSyncPatch(draft: SyncDraft): Cfg {
  return {
    if: {
      sync: {
        port0: draft.port0,
        port1: draft.port1,
        espnow: draft.espnow,
        recv: {
          bri: draft.recvBri, col: draft.recvCol, fx: draft.recvFx, pal: draft.recvPal,
          seg: draft.recvSeg, sb: draft.recvSb, grp: draft.recvGroups
        },
        send: {
          en: draft.sendEn, dir: draft.sendDir, btn: draft.sendBtn, va: draft.sendVa,
          hue: draft.sendHue, grp: draft.sendGroups
        }
      }
    }
  };
}

export interface TimeDraft {
  ntpEnabled: boolean; ntpHost: string; timezone: number;
  offsetSeconds: number; ampm: boolean; latitude: number; longitude: number;
}

export function buildTimePatch(draft: TimeDraft): Cfg {
  return {
    if: {
      ntp: {
        en: draft.ntpEnabled, host: draft.ntpHost, tz: draft.timezone,
        offset: draft.offsetSeconds, ampm: draft.ampm, lt: draft.latitude, ln: draft.longitude
      }
    }
  };
}

export interface LedPrefsDraft {
  bootPreset: number; bootOn: boolean; bootBri: number;
  transitionDurationMs: number; gammaColor: number; brightnessFactor: number;
  /** light.nl — nightlight defaults, previously entirely unbound. */
  nlMode: number;
  nlDurationMin: number;
  nlTargetBri: number;
  nlMacro: number;
}

export function buildLedPrefsPatch(draft: LedPrefsDraft): Cfg {
  return {
    def: { ps: draft.bootPreset, on: draft.bootOn, bri: draft.bootBri },
    light: {
      'scale-bri': draft.brightnessFactor,
      gc: { col: draft.gammaColor },
      tr: { dur: Math.round(draft.transitionDurationMs / 100) },
      nl: { mode: draft.nlMode, dur: draft.nlDurationMin, tbri: draft.nlTargetBri, macro: draft.nlMacro }
    }
  };
}

/**
 * Diff paths whose change can strand the device off the network or kill its
 * LED output: any WiFi client/AP setting, or any GPIO pin assignment under hw.
 * (Paths are the server's dot-joined form, e.g. `hw.led.ins.0.pin.0`.)
 */
export function isStrandRisk(path: string): boolean {
  if (path.startsWith('nw.') || path.startsWith('ap.')) return true;
  return path.startsWith('hw.') && path.split('.').includes('pin');
}
