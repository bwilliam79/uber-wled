import { describe, it, expect } from 'vitest';
import { allocateBit, NoFreeSyncBitError, SYNC_BITS, MAX_SYNC_GROUPS } from '../../src/sync/bitmask.js';

describe('allocateBit', () => {
  it('returns the lowest bit when none are used', () => {
    expect(allocateBit([])).toBe(1);
  });

  it('skips bits already in use', () => {
    expect(allocateBit([1, 2, 4])).toBe(8);
  });

  it('does not care about the order used bits are supplied in', () => {
    expect(allocateBit([8, 1, 4])).toBe(2);
  });

  it('throws NoFreeSyncBitError when all 8 bits are taken', () => {
    expect(() => allocateBit([...SYNC_BITS])).toThrow(NoFreeSyncBitError);
  });

  it('MAX_SYNC_GROUPS matches the number of bits', () => {
    expect(MAX_SYNC_GROUPS).toBe(8);
    expect(SYNC_BITS).toHaveLength(8);
  });
});
