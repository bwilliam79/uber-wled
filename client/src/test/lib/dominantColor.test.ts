import { describe, it, expect } from 'vitest';
import { dominantColor, OFF_GLOW, OFFLINE_GLOW } from '../../lib/dominantColor';

describe('dominantColor', () => {
  it('returns the offline grey when no state is available', () => {
    expect(dominantColor(undefined)).toBe(OFFLINE_GLOW);
  });

  it('returns the muted off color when master power is off', () => {
    expect(dominantColor({ on: false, bri: 255, seg: [{ on: true, len: 10, col: [[255, 0, 0]] }] }))
      .toBe(OFF_GLOW);
  });

  it('picks the primary color of the longest on segment, scaled by master brightness', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: true, len: 5, col: [[0, 0, 255]] },
        { on: true, len: 30, col: [[255, 80, 0]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(255, 80, 0)');
  });

  it('sums weight across segments sharing the same color', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: true, len: 20, col: [[0, 0, 255]] },
        { on: true, len: 15, col: [[255, 0, 0]] },
        { on: true, len: 15, col: [[255, 0, 0]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(255, 0, 0)');
  });

  it('treats a segment without len as weight 1 (Phase D LiveSegment.len is optional)', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: true, col: [[255, 0, 0]] },
        { on: true, len: 5, col: [[0, 0, 255]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(0, 0, 255)');
  });

  it('ignores off segments and black color slots', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: false, len: 100, col: [[0, 255, 0]] },
        { on: true, len: 10, col: [[0, 0, 0, 0]] },
        { on: true, len: 5, col: [[120, 0, 200]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(120, 0, 200)');
  });

  it('maps a white-channel-only slot to warm white', () => {
    const state = { on: true, bri: 255, seg: [{ on: true, len: 10, col: [[0, 0, 0, 200]] }] };
    expect(dominantColor(state)).toBe('rgb(255, 214, 170)');
  });

  it('never dims below the visibility floor (real device fixture, master bri 9)', () => {
    // captured 2026-07-04 from GET http://192.168.1.86/json/state:
    // seg0 len 39 col[0]=[255,255,255,0] on; seg1 len 9 col[0]=[0,0,0,0] on
    const state = {
      on: true, bri: 9,
      seg: [
        { on: true, len: 39, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
        { on: true, len: 9, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(89, 89, 89)'); // 255 * 0.35 floor, rounded
  });

  it('falls back to the off color when everything on is black', () => {
    expect(dominantColor({ on: true, bri: 255, seg: [{ on: true, len: 10, col: [[0, 0, 0, 0]] }] }))
      .toBe(OFF_GLOW);
  });
});
