import { describe, it, expect } from 'vitest';
import {
  AUTO_WHITE_MODES, COLOR_ORDERS, GLOBAL_AUTO_WHITE_MODES, LED_TYPES, WHITE_SWAP_MODES,
  buildIdentityPatch, buildLedHardwarePatch, buildLedPrefsPatch, buildSyncPatch,
  buildTimePatch, buildWifiPatch, formatIpv4, isStrandRisk, mergeOutputRow,
  outputDraftFromRow, parseIpv4
} from '../../sections/devices/configPatches';
import { probedCfg } from './fixtures';

describe('outputDraftFromRow', () => {
  it('decodes the probed row: GPIO 16, type 30, order 34 → color order BRG (2), white swap W&G (2)', () => {
    const draft = outputDraftFromRow(probedCfg().hw.led.ins[0]);
    expect(draft).toEqual({
      pin: 16, type: 30, len: 39, start: 0, colorOrder: 2, whiteSwap: 2, rev: true, skip: 0,
      rgbwm: 2, ledma: 55, maxpwr: 0, freq: 0
    });
  });
  it('exposes labeled options for the probed values', () => {
    expect(COLOR_ORDERS.find((o) => o.value === 2)?.label).toBe('BRG');
    expect(WHITE_SWAP_MODES.find((w) => w.value === 2)?.label).toBe('W & G swap');
    expect(LED_TYPES.find((t) => t.value === 30)?.label).toMatch(/SK6812/);
    expect(LED_TYPES.find((t) => t.value === 45)?.label).toMatch(/RGB \+ WW \+ CW/);
    expect(AUTO_WHITE_MODES.find((m) => m.value === 2)?.label).toBe('Accurate');
    expect(GLOBAL_AUTO_WHITE_MODES.find((m) => m.value === 255)?.label).toBe('Disabled');
  });
});

describe('mergeOutputRow', () => {
  it('preserves unknown per-row keys verbatim (ref, drv, text)', () => {
    const row = probedCfg().hw.led.ins[0];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), len: 40 });
    expect(merged).toMatchObject({ ref: false, drv: 0, text: '', len: 40 });
  });
  it('re-encodes both nibbles of order: 0x22 with new color order RGB(1) → 0x21', () => {
    const row = probedCfg().hw.led.ins[0];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), colorOrder: 1 });
    expect(merged.order).toBe(33); // 0x21 = whiteSwap 2 (unchanged) << 4 | colorOrder 1
  });
  it('re-encodes the white-swap nibble independently of color order: 0x22 with whiteSwap None(0) → 0x02', () => {
    const row = probedCfg().hw.led.ins[0];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), whiteSwap: 0 });
    expect(merged.order).toBe(2); // colorOrder 2 (unchanged), whiteSwap 0
  });
  it('writes the pin as the first element of the pin array', () => {
    const row = probedCfg().hw.led.ins[1];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), pin: 4 });
    expect(merged.pin).toEqual([4]);
  });
  it('binds per-output ledma/maxpwr/freq from the draft, not just passed through', () => {
    const row = probedCfg().hw.led.ins[0];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), ledma: 12, maxpwr: 900, freq: 440 });
    expect(merged).toMatchObject({ ledma: 12, maxpwr: 900, freq: 440 });
  });
});

describe('buildLedHardwarePatch', () => {
  it('sends COMPLETE merged rows because arrays replace on the server merge', () => {
    const cfg = probedCfg();
    const drafts = cfg.hw.led.ins.map(outputDraftFromRow);
    drafts[0] = { ...drafts[0], len: 40 };
    const patch = buildLedHardwarePatch(cfg, drafts, { total: 49, maxpwr: 850, rgbwm: 255, fps: 42 });
    expect(patch.hw.led.total).toBe(49);
    expect(patch.hw.led.maxpwr).toBe(850);
    expect(patch.hw.led.ins).toHaveLength(2);
    expect(patch.hw.led.ins[0]).toMatchObject({ len: 40, ledma: 55, ref: false });
    expect(patch.hw.led.ins[1]).toEqual(cfg.hw.led.ins[1]);
  });
  it('writes the global auto-white mode and target FPS (previously dropped entirely)', () => {
    const cfg = probedCfg();
    const patch = buildLedHardwarePatch(cfg, cfg.hw.led.ins.map(outputDraftFromRow), {
      total: 48, maxpwr: 0, rgbwm: 2, fps: 60
    });
    expect(patch.hw.led.rgbwm).toBe(2);
    expect(patch.hw.led.fps).toBe(60);
  });
});

describe('ip helpers', () => {
  it('parses dotted quads', () => expect(parseIpv4('192.168.1.50')).toEqual([192, 168, 1, 50]));
  it('rejects malformed and out-of-range strings', () => {
    expect(parseIpv4('192.168.1')).toBeNull();
    expect(parseIpv4('192.168.1.256')).toBeNull();
    expect(parseIpv4('lights.local')).toBeNull();
  });
  it('formats the probed subnet mask back to text', () =>
    expect(formatIpv4([255, 255, 255, 0])).toBe('255.255.255.0'));
});

describe('buildWifiPatch', () => {
  const draft = {
    ssid: 'Williams', password: '', staticIp: '0.0.0.0', gateway: '0.0.0.0',
    subnet: '255.255.255.0', apSsid: 'WLED-AP', apPassword: '', apChannel: 6, apHide: false,
    wifiSleep: false, wifiForceG: false, txPower: 78
  };
  it('omits psk entirely when the password field is blank (write-only semantics)', () => {
    const patch = buildWifiPatch(probedCfg(), draft);
    expect('psk' in patch.nw.ins[0]).toBe(false);
    expect('psk' in patch.ap).toBe(false);
  });
  it('carries unknown row keys and includes psk only when typed', () => {
    const patch = buildWifiPatch(probedCfg(), { ...draft, password: 'hunter22' });
    expect(patch.nw.ins[0]).toMatchObject({ ssid: 'Williams', pskl: 10, bssid: '', psk: 'hunter22' });
    expect(patch.nw.ins[0].sn).toEqual([255, 255, 255, 0]);
  });
  it('maps AP fields (chan + hide as 0/1)', () => {
    const patch = buildWifiPatch(probedCfg(), { ...draft, apHide: true });
    expect(patch.ap).toMatchObject({ ssid: 'WLED-AP', chan: 6, hide: 1 });
  });
  it('binds the top-level wifi radio settings (sleep/phy/txpwr), previously unbound entirely', () => {
    const patch = buildWifiPatch(probedCfg(), { ...draft, wifiSleep: true, wifiForceG: true, txPower: 44 });
    expect(patch.wifi).toEqual({ sleep: true, phy: true, txpwr: 44 });
  });
});

describe('buildIdentityPatch / buildSyncPatch / buildTimePatch / buildLedPrefsPatch', () => {
  it('identity patch is a minimal object merge', () =>
    expect(buildIdentityPatch({ name: 'Cabinet Lights', mdns: 'cabinet-lights' }))
      .toEqual({ id: { name: 'Cabinet Lights', mdns: 'cabinet-lights' } }));
  it('sync patch nests only the edited keys (objects deep-merge server-side)', () => {
    const patch = buildSyncPatch({
      port0: 21324, port1: 65506,
      recvBri: true, recvCol: true, recvFx: true, recvPal: true, recvSeg: true, recvSb: false, recvGroups: 1,
      sendEn: false, sendDir: true, sendHue: true, sendGroups: 1,
      espnow: false, sendBtn: false, sendVa: false
    });
    expect(patch.if.sync.recv.seg).toBe(true);
    expect('nodes' in patch.if).toBe(false); // untouched keys stay out of the patch
  });
  it('sync patch binds espnow and the send.btn/send.va flags, previously unbound entirely', () => {
    const patch = buildSyncPatch({
      port0: 21324, port1: 65506,
      recvBri: true, recvCol: true, recvFx: true, recvPal: true, recvSeg: false, recvSb: false, recvGroups: 1,
      sendEn: false, sendDir: true, sendHue: true, sendGroups: 1,
      espnow: true, sendBtn: true, sendVa: true
    });
    expect(patch.if.sync.espnow).toBe(true);
    expect(patch.if.sync.send).toMatchObject({ btn: true, va: true });
  });
  it('time patch mirrors the probed if.ntp shape', () => {
    expect(buildTimePatch({
      ntpEnabled: true, ntpHost: '0.wled.pool.ntp.org', timezone: 5,
      offsetSeconds: 0, ampm: false, latitude: 33.24, longitude: -96.78
    })).toEqual({
      if: { ntp: { en: true, host: '0.wled.pool.ntp.org', tz: 5, offset: 0, ampm: false, lt: 33.24, ln: -96.78 } }
    });
  });
  it('led prefs patch converts transition ms to WLED 100ms units and binds nightlight', () => {
    expect(buildLedPrefsPatch({
      bootPreset: 1, bootOn: false, bootBri: 128,
      transitionDurationMs: 700, gammaColor: 2.8, brightnessFactor: 100,
      nlMode: 1, nlDurationMin: 60, nlTargetBri: 0, nlMacro: 0
    })).toEqual({
      def: { ps: 1, on: false, bri: 128 },
      light: { 'scale-bri': 100, gc: { col: 2.8 }, tr: { dur: 7 }, nl: { mode: 1, dur: 60, tbri: 0, macro: 0 } }
    });
  });
});

describe('isStrandRisk', () => {
  it('flags WiFi client and AP paths', () => {
    expect(isStrandRisk('nw.ins.0.ssid')).toBe(true);
    expect(isStrandRisk('nw.ins.0.psk')).toBe(true);
    expect(isStrandRisk('ap.chan')).toBe(true);
  });
  it('flags GPIO pin paths anywhere under hw.', () => {
    expect(isStrandRisk('hw.led.ins.0.pin.0')).toBe(true);
    expect(isStrandRisk('hw.relay.pin')).toBe(true);
  });
  it('does not flag safe paths', () => {
    expect(isStrandRisk('hw.led.total')).toBe(false);
    expect(isStrandRisk('id.name')).toBe(false);
    expect(isStrandRisk('if.sync.port0')).toBe(false);
    expect(isStrandRisk('light.tr.dur')).toBe(false);
  });
});
