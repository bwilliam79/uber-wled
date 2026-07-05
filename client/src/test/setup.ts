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

afterEach(() => {
  cleanup();
});
