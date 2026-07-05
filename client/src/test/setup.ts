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

afterEach(() => {
  cleanup();
});
