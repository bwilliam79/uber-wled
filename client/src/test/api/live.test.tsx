import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveStatus } from '../../api/live';

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() { this.closed = true; }
  emitStatus(payload: unknown) {
    for (const fn of this.listeners.get('status') ?? []) {
      fn({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }
}

describe('useLiveStatus', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens one EventSource at /api/live with sorted, comma-joined ids', () => {
    renderHook(() => useLiveStatus(['b2', 'a1']));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/live?controllers=a1,b2');
  });

  it('opens no connection for an empty id list', () => {
    renderHook(() => useLiveStatus([]));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('updates the map on status events and keeps the last state/info when omitted', () => {
    const { result } = renderHook(() => useLiveStatus(['a1']));
    const es = FakeEventSource.instances[0];
    const state1 = { on: true, bri: 9, transition: 7, ps: -1, pl: -1, nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 }, mainseg: 0, seg: [] };
    const info = { name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030, leds: { count: 48, rgbw: true, cct: 0 } };
    act(() => es.emitStatus({ controllerId: 'a1', reachable: true, state: state1, info }));
    expect(result.current.get('a1')).toEqual({ reachable: true, state: state1, info });
    const state2 = { ...state1, bri: 128 };
    act(() => es.emitStatus({ controllerId: 'a1', reachable: true, state: state2 }));
    expect(result.current.get('a1')!.state!.bri).toBe(128);
    expect(result.current.get('a1')!.info).toEqual(info); // info retained across info-less ticks
  });

  it('resubscribes when the id set changes but not when only the order changes', () => {
    const { rerender } = renderHook(({ ids }) => useLiveStatus(ids), { initialProps: { ids: ['b2', 'a1'] } });
    expect(FakeEventSource.instances).toHaveLength(1);
    rerender({ ids: ['a1', 'b2'] }); // same sorted key → no new connection
    expect(FakeEventSource.instances).toHaveLength(1);
    rerender({ ids: ['a1', 'b2', 'c3'] });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances[1].url).toBe('/api/live?controllers=a1,b2,c3');
  });

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useLiveStatus(['a1']));
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('reconnects after an error with capped exponential backoff (2s then 4s)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderHook(() => useLiveStatus(['a1']));
    act(() => FakeEventSource.instances[0].onerror?.());
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1999); });
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => FakeEventSource.instances[1].onerror?.());
    act(() => { vi.advanceTimersByTime(3999); });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeEventSource.instances).toHaveLength(3);
  });
});
