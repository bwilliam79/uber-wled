import { describe, it, expect } from 'vitest';
import { PROBED_CFG, probedCfg, SEGMENTS, LIVE_INFO } from './fixtures';

describe('devices fixtures (probed read-only from 192.168.1.86)', () => {
  it('probedCfg returns an independent deep copy', () => {
    const a = probedCfg();
    a.hw.led.ins[0].len = 999;
    expect(PROBED_CFG.hw.led.ins[0].len).toBe(39);
    expect(probedCfg().hw.led.ins[0].len).toBe(39);
  });

  it('LED output rows carry the unknown per-row keys that must survive saves', () => {
    for (const row of PROBED_CFG.hw.led.ins) {
      expect(row.ledma).toBe(55);
      expect(row.freq).toBe(0);
      expect(row.ref).toBe(false);
      expect(row.order).toBe(34);
    }
  });

  it('sync send block keeps unknown keys (btn/va/ret) for merge-preservation tests', () => {
    expect(PROBED_CFG.if.sync.send).toMatchObject({ btn: false, va: false, ret: 0 });
  });

  it('segments fixture matches the probed 48-LED two-output split', () => {
    expect(SEGMENTS.map((s) => s.id)).toEqual([0, 1]);
    expect(SEGMENTS[1].stop).toBe(48);
    expect(LIVE_INFO.leds.count).toBe(48);
  });
});
