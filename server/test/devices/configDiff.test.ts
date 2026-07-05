import { describe, it, expect } from 'vitest';
import { buildConfigDiff, rebootRequired } from '../../src/devices/configDiff.js';

// Subset of the real /json/cfg probed live from 192.168.1.86 (WLED 16.0.0).
const CURRENT = {
  id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false },
  nw: { ins: [{ ssid: 'Williams', pskl: 10, ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }] },
  ap: { ssid: 'WLED-AP', pskl: 8, chan: 1, hide: 0 },
  hw: {
    led: {
      total: 48, maxpwr: 0, fps: 42,
      ins: [
        { start: 0, len: 39, pin: [16], order: 34, rev: true, skip: 0, type: 30 },
        { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30 }
      ]
    }
  },
  def: { ps: 1, on: true, bri: 128 }
};

describe('buildConfigDiff', () => {
  it('reports a changed nested scalar with a dot path', () => {
    expect(buildConfigDiff(CURRENT, { id: { name: 'Kitchen Cabinets' } })).toEqual([
      { path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen Cabinets' }
    ]);
  });

  it('returns [] when the patch matches current values (including equal arrays)', () => {
    expect(buildConfigDiff(CURRENT, { ap: { ssid: 'WLED-AP' } })).toEqual([]);
    expect(buildConfigDiff(CURRENT, { nw: { ins: [{ ip: [0, 0, 0, 0] }] } })).toEqual([]);
  });

  it('diffs arrays by index down to the changed leaf', () => {
    const patch = {
      hw: { led: { ins: [
        { start: 0, len: 39, pin: [17], order: 34, rev: true, skip: 0, type: 30 },
        { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30 }
      ] } }
    };
    expect(buildConfigDiff(CURRENT, patch)).toEqual([
      { path: 'hw.led.ins.0.pin.0', from: 16, to: 17 }
    ]);
  });

  it('reports array elements dropped by the patch as removals', () => {
    const patch = { hw: { led: { ins: [{ start: 0, len: 48, pin: [16], order: 34, rev: true, skip: 0, type: 30 }] } } };
    const diff = buildConfigDiff(CURRENT, patch);
    expect(diff).toContainEqual({ path: 'hw.led.ins.0.len', from: 39, to: 48 });
    expect(diff).toContainEqual({
      path: 'hw.led.ins.1',
      from: { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30 },
      to: undefined
    });
  });

  it('reports keys added by the patch with from: undefined', () => {
    expect(buildConfigDiff(CURRENT, { nw: { ins: [{ psk: 'hunter2' }] } })).toEqual([
      { path: 'nw.ins.0.psk', from: undefined, to: 'hunter2' }
    ]);
  });

  it('recurses into structures the current config lacks entirely', () => {
    expect(buildConfigDiff(CURRENT, { eth: { pin: [5] } })).toEqual([
      { path: 'eth.pin.0', from: undefined, to: 5 }
    ]);
  });
});

describe('rebootRequired', () => {
  it('is true iff any path starts with hw., nw., ap., or eth.', () => {
    expect(rebootRequired([{ path: 'id.name', from: 'a', to: 'b' }])).toBe(false);
    expect(rebootRequired([{ path: 'def.ps', from: 1, to: 2 }])).toBe(false);
    expect(rebootRequired([{ path: 'hw.led.ins.0.pin.0', from: 16, to: 17 }])).toBe(true);
    expect(rebootRequired([{ path: 'nw.ins.0.psk', from: undefined, to: 'x' }])).toBe(true);
    expect(rebootRequired([{ path: 'ap.ssid', from: 'a', to: 'b' }])).toBe(true);
    expect(rebootRequired([{ path: 'eth.pin.0', from: undefined, to: 5 }])).toBe(true);
    expect(rebootRequired([])).toBe(false);
  });
});
