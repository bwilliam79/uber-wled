import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttleTrailing, throttle } from '../../lib/throttle';

describe('throttleTrailing', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('fires the first call immediately (leading edge)', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('coalesces calls inside the window to one trailing fire with the latest args', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    t.call(2);
    t.call(3);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(249);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('never exceeds 1 fire per interval during a sustained drag (≤4/sec at 250ms)', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    for (let ms = 0; ms < 1000; ms += 50) {
      t.call(ms);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(250);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(5); // 1 leading + ≤4 trailing over 1s
    expect(fn).toHaveBeenLastCalledWith(950);
  });

  it('fires immediately again after a quiet period', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    vi.advanceTimersByTime(300);
    t.call(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending trailing call; flush fires it immediately', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    t.call(2);
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    t.call(3);
    t.call(4);
    t.flush();
    expect(fn).toHaveBeenLastCalledWith(4);
  });
});

describe('throttle', () => {
  afterEach(() => vi.useRealTimers());

  it('fires immediately on the leading edge', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 250);
    t(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('coalesces calls inside the window into one trailing call with the latest args', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 250);
    t(1); t(2); t(3);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('allows a new leading call after the window has passed', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 250);
    t(1);
    vi.advanceTimersByTime(300);
    t(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
