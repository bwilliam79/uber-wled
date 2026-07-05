import { describe, it, expect } from 'vitest';
import { stripStrokeColor, OFFLINE_STROKE, type LiveControllerStatus } from '../../../sections/layout/stripColors';

// Real segments from 192.168.1.86 /json/state (2026-07-04): a white RGBW segment
// at full segment brightness, and a second segment currently set to black.
const realSeg0 = { id: 0, on: true, bri: 255, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };
const realSeg1 = { id: 1, on: true, bri: 255, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };

const onlineState: LiveControllerStatus = {
  reachable: true,
  state: { on: true, bri: 9, seg: [realSeg0, realSeg1] }
};

describe('stripStrokeColor', () => {
  const stripSeg0 = { controllerId: 'c1', wledSegId: 0 };

  it('renders the live segment color when the controller is reachable and on', () => {
    const live = new Map([['c1', onlineState]]);
    expect(stripStrokeColor(stripSeg0, live)).toBe('rgb(255, 255, 255)');
    expect(stripStrokeColor({ controllerId: 'c1', wledSegId: 1 }, live)).toBe('rgb(0, 0, 0)');
  });

  it('renders the muted off color when the whole controller is off', () => {
    const live = new Map([['c1', { ...onlineState, state: { ...onlineState.state!, on: false } }]]);
    expect(stripStrokeColor(stripSeg0, live)).toBe('#334155');
  });

  it('renders the muted off color when just the segment is off', () => {
    const live = new Map([['c1', {
      reachable: true,
      state: { on: true, bri: 9, seg: [{ ...realSeg0, on: false }] }
    }]]);
    expect(stripStrokeColor(stripSeg0, live)).toBe('#334155');
  });

  it('renders grey when the controller is missing, unreachable, or has no state yet', () => {
    expect(stripStrokeColor(stripSeg0, new Map())).toBe(OFFLINE_STROKE);
    expect(stripStrokeColor(stripSeg0, new Map([['c1', { reachable: false }]]))).toBe(OFFLINE_STROKE);
    expect(stripStrokeColor(stripSeg0, new Map([['c1', { reachable: true }]]))).toBe(OFFLINE_STROKE);
  });

  it('renders grey when the mapped segment id does not exist on the device', () => {
    const live = new Map([['c1', onlineState]]);
    expect(stripStrokeColor({ controllerId: 'c1', wledSegId: 9 }, live)).toBe(OFFLINE_STROKE);
  });
});
