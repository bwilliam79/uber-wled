import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createSettingsRepository } from '../../src/settings/repository.js';
import { createLiveSessionManager, type LiveEvent } from '../../src/live/sessions.js';
import type { WledInfo, WledState } from '../../src/wled/types.js';

// Real shapes probed from 192.168.1.86 (WLED 16.0.0).
const STATE: WledState = {
  on: true, bri: 9, ps: -1,
  seg: [{ id: 0, start: 0, stop: 39, len: 39, on: true, bri: 255, fx: 0, pal: 0, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }]
};
const INFO: WledInfo = { name: 'Cabinet Lights', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' };

describe('live session manager', () => {
  let db: ReturnType<typeof createDb>;
  let controllerId: string;
  let wled: { getState: ReturnType<typeof vi.fn>; getInfo: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    wled = { getState: vi.fn(async () => STATE), getInfo: vi.fn(async () => INFO) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls immediately on first subscribe and includes info on the first tick', async () => {
    const manager = createLiveSessionManager(db, wled);
    const events: LiveEvent[] = [];
    manager.subscribe([controllerId], (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(0); // flush the immediate first poll
    expect(wled.getState).toHaveBeenCalledTimes(1);
    expect(wled.getInfo).toHaveBeenCalledTimes(1);
    expect(events[0]).toEqual({ controllerId, reachable: true, state: STATE, info: INFO });
  });

  it('polls at the interval from settings.livePollIntervalSeconds', async () => {
    createSettingsRepository(db).update({ livePollIntervalSeconds: 5 });
    const manager = createLiveSessionManager(db, wled);
    manager.subscribe([controllerId], () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(wled.getState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(wled.getState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(wled.getState).toHaveBeenCalledTimes(2);
  });

  it('refreshes info only every 10th tick', async () => {
    const manager = createLiveSessionManager(db, wled); // default interval 2s
    manager.subscribe([controllerId], () => {});
    await vi.advanceTimersByTimeAsync(0);          // tick 0 (info)
    await vi.advanceTimersByTimeAsync(9 * 2_000);  // ticks 1-9 (no info)
    expect(wled.getState).toHaveBeenCalledTimes(10);
    expect(wled.getInfo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);      // tick 10 (info again)
    expect(wled.getInfo).toHaveBeenCalledTimes(2);
  });

  it('a listener joining an already-running, mid-cycle session gets an immediate info-inclusive catch-up, not a wait for the next scheduled (possibly info-less) tick', async () => {
    // Regression test: a controller's session can be kept alive by one
    // subscriber (e.g. the Devices page) for a long time. A second
    // subscriber joining later (e.g. Home, opened afterward) previously got
    // nothing until the session's shared tick counter naturally reached its
    // next scheduled interval — and even then, only every 10th tick actually
    // carries `info`, so a newly-opened page's controller name could show
    // the stale fallback for a long time.
    const manager = createLiveSessionManager(db, wled); // default interval 2s
    const eventsA: LiveEvent[] = [];
    manager.subscribe([controllerId], (e) => eventsA.push(e));
    await vi.advanceTimersByTimeAsync(0);   // tick 0 (info) consumed by A
    await vi.advanceTimersByTimeAsync(2_000); // tick 1 (no info) — now mid-cycle, not on an info tick
    wled.getInfo.mockClear();
    wled.getState.mockClear();

    const eventsB: LiveEvent[] = [];
    manager.subscribe([controllerId], (e) => eventsB.push(e));
    await vi.advanceTimersByTimeAsync(0); // flush B's catch-up microtask only — no timer advance
    expect(eventsB).toHaveLength(1);
    expect(eventsB[0]).toEqual({ controllerId, reachable: true, state: STATE, info: INFO });
    expect(wled.getInfo).toHaveBeenCalledTimes(1);

    // The catch-up must not have counted as a regular tick: the session was
    // at tick 2 before B joined (ticks 0 and 1 already consumed), so the
    // next *scheduled* info tick should still land at tick 10, not tick 9.
    wled.getInfo.mockClear();
    await vi.advanceTimersByTimeAsync(7 * 2_000); // ticks 2-8
    expect(wled.getInfo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000); // tick 9 — still not an info tick
    expect(wled.getInfo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000); // tick 10 — info tick
    expect(wled.getInfo).toHaveBeenCalledTimes(1);
  });

  it('refcounts: two subscribers share one session; polling stops after the last unsubscribes', async () => {
    const manager = createLiveSessionManager(db, wled);
    const unsubA = manager.subscribe([controllerId], () => {});
    const unsubB = manager.subscribe([controllerId], () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.activeSessionCount()).toBe(1);
    unsubA();
    expect(manager.activeSessionCount()).toBe(1);
    unsubB();
    expect(manager.activeSessionCount()).toBe(0);
    const calls = wled.getState.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wled.getState).toHaveBeenCalledTimes(calls); // no polls after teardown
  });

  it('unsubscribe is idempotent', async () => {
    const manager = createLiveSessionManager(db, wled);
    const unsubA = manager.subscribe([controllerId], () => {});
    const unsubB = manager.subscribe([controllerId], () => {});
    unsubA();
    unsubA(); // double-call must not steal B's refcount
    expect(manager.activeSessionCount()).toBe(1);
    unsubB();
    expect(manager.activeSessionCount()).toBe(0);
  });

  it('emits reachable:false when the device errors, then keeps polling', async () => {
    wled.getState.mockRejectedValueOnce(new Error('timeout'));
    const manager = createLiveSessionManager(db, wled);
    const events: LiveEvent[] = [];
    manager.subscribe([controllerId], (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(0);
    expect(events[0]).toEqual({ controllerId, reachable: false });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(events[1].reachable).toBe(true);
  });

  it('emits a single reachable:false for an unknown controller id without starting a session', () => {
    const manager = createLiveSessionManager(db, wled);
    const events: LiveEvent[] = [];
    manager.subscribe(['ghost'], (e) => events.push(e));
    expect(events).toEqual([{ controllerId: 'ghost', reachable: false }]);
    expect(manager.activeSessionCount()).toBe(0);
  });
});
