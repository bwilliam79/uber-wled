import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node >=22 ships an experimental global `localStorage` backed by a file
// (see `--localstorage-file`). Because jsdom's environment aliases `window`
// to `globalThis`, that stub — not a working Storage — is what test code
// sees, and it silently no-ops every method (no `clear`/`setItem`/etc.).
// Replace it with a real in-memory Storage implementation for jsdom tests.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

// jsdom has no `PointerEvent` constructor. Testing Library's
// fireEvent.pointerDown/Move/Up resolve their constructor via
// `window[EventType] || window.Event` (see @testing-library/dom's
// createEvent) and silently fall back to plain `Event` when it is missing —
// which drops `clientX`/`clientY` entirely, breaking any pointer handler
// that does hit-testing/drag-threshold math on those fields. jsdom's
// `MouseEvent` *does* support clientX/clientY correctly, so polyfill
// `PointerEvent` as a thin MouseEvent subclass carrying `pointerId`.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    public pointerType: string;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  // @ts-expect-error - minimal polyfill, not a spec-complete PointerEvent
  globalThis.PointerEvent = PointerEventPolyfill;
}

// jsdom has no `EventSource`. `api/live.ts`'s `useLiveStatus` opens one
// unconditionally whenever it is given a non-empty controller id list (Home
// v2 wires this in for every controller, not just ones inside a group), so
// any test that renders a component tree reaching `useLiveStatus` with
// controllers present would otherwise throw `ReferenceError: EventSource is
// not defined` from inside a passive effect. Tests that care about the SSE
// wire protocol install their own richer fake via `vi.stubGlobal` (see
// `api/live.test.tsx`) and that takes priority for the duration of those
// tests; this is just a safe no-op fallback so unrelated tests don't crash.
if (typeof globalThis.EventSource === 'undefined') {
  class EventSourcePolyfill {
    onerror: (() => void) | null = null;
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  // @ts-expect-error - minimal polyfill, not a spec-complete EventSource
  globalThis.EventSource = EventSourcePolyfill;
}

// jsdom has no `WebSocket`. api/liveWsPixels.ts's useLiveWsPixels opens one
// unconditionally for any non-empty host list, and it's wired into
// HomeSection/DeviceCard/InfoTab — same rationale as the EventSource
// polyfill above: a safe no-op fallback so tests that don't care about the
// live-pixel wire protocol don't crash. Tests that do care install their own
// richer fake via vi.stubGlobal (see api/liveWsPixels.test.tsx).
if (typeof globalThis.WebSocket === 'undefined') {
  class WebSocketPolyfill {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 3;
    binaryType = 'blob';
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  }
  // @ts-expect-error - minimal polyfill, not a spec-complete WebSocket
  globalThis.WebSocket = WebSocketPolyfill;
}

afterEach(() => {
  cleanup();
});
