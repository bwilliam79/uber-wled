/**
 * Pure patch builders for the Config tab. BINDING server semantics (Phase B
 * configDiff.ts): objects deep-merge — only patched keys are compared/applied;
 * arrays REPLACE wholesale. Therefore every array this module emits
 * (hw.led.ins, nw.ins) contains COMPLETE rows merged over the device's
 * current cfg rows, so unknown per-row fields (ledma, freq, ref, drv, text,
 * …) survive every save.
 */
export type Cfg = Record<string, any>;

/** WLED bus type ids — 30 verified on the probed SK6812 RGBW strip; the rest from WLED const.h. */
export const LED_TYPES: { value: number; label: string }[] = [
  { value: 22, label: 'WS281x (WS2812/WS2815 RGB)' },
  { value: 30, label: 'SK6812 / WS2814 RGBW' },
  { value: 31, label: 'TM1814 (RGBW)' },
  { value: 24, label: 'WS2811 400kHz' },
  { value: 18, label: 'WS2812 single-white' },
  { value: 20, label: 'WS2812 CCT' },
  { value: 21, label: 'WS2812 WWA' },
  { value: 27, label: 'APA106' },
  { value: 25, label: 'TM1829' },
  { value: 26, label: 'UCS8903 (16-bit RGB)' },
  { value: 29, label: 'UCS8904 (16-bit RGBW)' },
  { value: 50, label: 'WS2801 (SPI)' },
  { value: 51, label: 'APA102 / SK9822 (SPI)' },
  { value: 52, label: 'LPD8806 (SPI)' },
  { value: 53, label: 'P9813 (SPI)' },
  { value: 54, label: 'LPD6803 (SPI)' }
];

/** Low nibble of the per-output `order` byte (probed 34 = 0x22 → BRG). */
export const COLOR_ORDERS: { value: number; label: string }[] = [
  { value: 0, label: 'GRB' }, { value: 1, label: 'RGB' }, { value: 2, label: 'BRG' },
  { value: 3, label: 'RBG' }, { value: 4, label: 'BGR' }, { value: 5, label: 'GBR' }
];

/** Per-output rgbwm (probed 2 = Accurate). Global hw.led.rgbwm 255 = per-bus and is never written. */
export const AUTO_WHITE_MODES: { value: number; label: string }[] = [
  { value: 0, label: 'None' }, { value: 1, label: 'Brighter' }, { value: 2, label: 'Accurate' },
  { value: 3, label: 'Dual' }, { value: 4, label: 'Max' }
];

export interface OutputDraft {
  pin: number;
  type: number;
  len: number;
  start: number;
  colorOrder: number; // low nibble of `order` only
  rev: boolean;
  skip: number;
  rgbwm: number;
}

export function outputDraftFromRow(row: Cfg): OutputDraft {
  return {
    pin: Array.isArray(row.pin) ? Number(row.pin[0]) : Number(row.pin),
    type: Number(row.type),
    len: Number(row.len),
    start: Number(row.start),
    colorOrder: (Number(row.order) || 0) & 0x0f,
    rev: Boolean(row.rev),
    skip: Number(row.skip ?? 0),
    rgbwm: Number(row.rgbwm ?? 0)
  };
}

/**
 * Full replacement row for hw.led.ins[i]. Spreads the probed row first so
 * unknown keys survive; preserves the white-swap high nibble of `order`.
 */
export function mergeOutputRow(row: Cfg, draft: OutputDraft): Cfg {
  const highNibble = (Number(row.order) || 0) & 0xf0;
  const pin = Array.isArray(row.pin) ? [draft.pin, ...row.pin.slice(1)] : [draft.pin];
  return {
    ...row,
    pin,
    type: draft.type,
    len: draft.len,
    start: draft.start,
    order: highNibble | (draft.colorOrder & 0x0f),
    rev: draft.rev,
    skip: draft.skip,
    rgbwm: draft.rgbwm
  };
}

export function buildIdentityPatch(draft: { name: string; mdns: string }): Cfg {
  return { id: { name: draft.name, mdns: draft.mdns } };
}

export function buildLedHardwarePatch(
  cfg: Cfg,
  drafts: OutputDraft[],
  globals: { total: number; maxpwr: number }
): Cfg {
  const rows: Cfg[] = Array.isArray(cfg.hw?.led?.ins) ? cfg.hw.led.ins : [];
  const ins = rows.map((row, i) => (drafts[i] ? mergeOutputRow(row, drafts[i]) : row));
  return { hw: { led: { total: globals.total, maxpwr: globals.maxpwr, ins } } };
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
  return { nw: { ins: [merged] }, ap };
}

export interface SyncDraft {
  port0: number; port1: number;
  recvBri: boolean; recvCol: boolean; recvFx: boolean; recvPal: boolean;
  recvSeg: boolean; recvSb: boolean; recvGroups: number;
  sendEn: boolean; sendDir: boolean; sendHue: boolean; sendGroups: number;
}

export function buildSyncPatch(draft: SyncDraft): Cfg {
  return {
    if: {
      sync: {
        port0: draft.port0,
        port1: draft.port1,
        recv: {
          bri: draft.recvBri, col: draft.recvCol, fx: draft.recvFx, pal: draft.recvPal,
          seg: draft.recvSeg, sb: draft.recvSb, grp: draft.recvGroups
        },
        send: { en: draft.sendEn, dir: draft.sendDir, hue: draft.sendHue, grp: draft.sendGroups }
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
}

export function buildLedPrefsPatch(draft: LedPrefsDraft): Cfg {
  return {
    def: { ps: draft.bootPreset, on: draft.bootOn, bri: draft.bootBri },
    light: {
      'scale-bri': draft.brightnessFactor,
      gc: { col: draft.gammaColor },
      tr: { dur: Math.round(draft.transitionDurationMs / 100) }
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
