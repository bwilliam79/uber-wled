import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveWsPixels } from '../../api/liveWsPixels';

type Listener = (ev: unknown) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  binaryType = 'blob';
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = FakeWebSocket.CLOSED; this.emit('close', {}); }
  emit(type: string, ev: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  open() { this.readyState = FakeWebSocket.OPEN; this.emit('open', {}); }
  emitFrame(bytes: number[]) {
    const buf = new Uint8Array(bytes).buffer;
    this.emit('message', { data: buf });
  }
}

function frameBytes(rgbTriplets: number[][]): number[] {
  return [0x4c, 1, ...rgbTriplets.flat()];
}

describe('useLiveWsPixels', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens one ws://<host>/ws connection per unique host and sends {lv:true} once open', () => {
    renderHook(() => useLiveWsPixels(['1.2.3.4', '1.2.3.4', '5.6.7.8']));
    expect(FakeWebSocket.instances).toHaveLength(2);
    const urls = FakeWebSocket.instances.map((w) => w.url).sort();
    expect(urls).toEqual(['ws://1.2.3.4/ws', 'ws://5.6.7.8/ws']);
    FakeWebSocket.instances[0].open();
    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ lv: true })]);
  });

  it('opens no connections for an empty host list', () => {
    renderHook(() => useLiveWsPixels([]));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('decodes an 0x4C-prefixed binary frame into the pixel map, stripping the 2-byte header', () => {
    const { result } = renderHook(() => useLiveWsPixels(['1.2.3.4']));
    const ws = FakeWebSocket.instances[0];
    ws.open();
    act(() => ws.emitFrame(frameBytes([[255, 0, 0], [0, 255, 0], [0, 0, 255]])));
    const pixels = result.current.get('1.2.3.4')!;
    expect(Array.from(pixels)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it('ignores string messages (JSON acks/state) and non-live-prefixed binary frames', () => {
    const { result } = renderHook(() => useLiveWsPixels(['1.2.3.4']));
    const ws = FakeWebSocket.instances[0];
    ws.open();
    act(() => ws.emit('message', { data: JSON.stringify({ success: true }) }));
    act(() => ws.emitFrame([0x00, 1, 255, 255, 255])); // wrong magic byte
    expect(result.current.get('1.2.3.4')).toBeUndefined();
  });

  it('sends {lv:false} and closes on unmount', () => {
    const { unmount } = renderHook(() => useLiveWsPixels(['1.2.3.4']));
    const ws = FakeWebSocket.instances[0];
    ws.open();
    unmount();
    expect(ws.sent).toContain(JSON.stringify({ lv: false }));
    expect(ws.closed).toBe(true);
  });

  it('does not send {lv:false} on unmount if the socket never opened', () => {
    const { unmount } = renderHook(() => useLiveWsPixels(['1.2.3.4']));
    const ws = FakeWebSocket.instances[0];
    unmount();
    expect(ws.sent).toEqual([]);
    expect(ws.closed).toBe(true);
  });

  it('reconnects after close with capped exponential backoff (2s then 4s)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderHook(() => useLiveWsPixels(['1.2.3.4']));
    const first = FakeWebSocket.instances[0];
    // Neither attempt opens successfully — open() resets backoff (a
    // reasonable reconnect succeeded), so consecutive failures must close
    // without opening to actually exercise the backoff ramp.
    act(() => first.close());
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1999); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => FakeWebSocket.instances[1].close());
    act(() => { vi.advanceTimersByTime(3999); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('drops a removed host and adds a new one when the host list changes', () => {
    const { rerender } = renderHook(({ hosts }) => useLiveWsPixels(hosts), {
      initialProps: { hosts: ['1.2.3.4'] }
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    rerender({ hosts: ['5.6.7.8'] });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].url).toBe('ws://5.6.7.8/ws');
  });

  it('clears a host\'s pixels once it is removed from the list', () => {
    const { result, rerender } = renderHook(({ hosts }) => useLiveWsPixels(hosts), {
      initialProps: { hosts: ['1.2.3.4'] }
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    act(() => ws.emitFrame(frameBytes([[1, 2, 3]])));
    expect(result.current.get('1.2.3.4')).toBeDefined();
    rerender({ hosts: [] });
    expect(result.current.get('1.2.3.4')).toBeUndefined();
  });
});
