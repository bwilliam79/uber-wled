import { describe, it, expect, vi, afterEach } from 'vitest';
import { pushOtaUpdate } from '../../src/firmware/otaPush.js';

const HOST = '10.0.0.50';

afterEach(() => vi.unstubAllGlobals());

describe('pushOtaUpdate', () => {
  it('uploads the asset and confirms the new version after the device reboots', async () => {
    let infoCallCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/json/info')) {
        infoCallCount++;
        // simulate the device being briefly unreachable during reboot, then back up on the new version
        if (infoCallCount < 3) throw new Error('device unreachable (rebooting)');
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.15.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0', { retryDelayMs: 0 });
    expect(result).toEqual({ ok: true, installedVersion: '0.15.0' });
  });

  it('reports a failure without retrying the upload when the upload itself fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();

    // exactly one call to /update — the upload itself is never retried
    const updateCalls = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/update'));
    expect(updateCalls).toHaveLength(1);
  });

  it('reports a failure when the device never comes back with the expected version within the retry budget', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/json/info')) {
        throw new Error('device unreachable');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0', { retryDelayMs: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/did not come back|unreachable|version mismatch/i);
  });

  it('reports a version mismatch as a failure requiring manual verification', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0', { retryDelayMs: 0 });
    expect(result.ok).toBe(false);
  });
});
