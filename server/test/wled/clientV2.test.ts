import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getFxData,
  getPalettePreviews,
  getConfig,
  getFullState,
  patchConfig,
  savePreset,
  deletePreset,
  reboot,
  setNightlight
} from '../../src/wled/client.js';

const HOST = '10.0.0.50';

/** Routes GET requests by `pathname+search`; throws on any unexpected URL. */
function stubFetchRoutes(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, search } = new URL(url);
    const key = pathname + search;
    if (!(key in routes)) throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${key}`);
    return { ok: true, json: async () => routes[key] } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('wled client v2 reads', () => {
  it('getFxData fetches the raw fxdata string array', async () => {
    stubFetchRoutes({ '/json/fxdata': ['', '!,Duty cycle;!,!;!;01'] });
    expect(await getFxData(HOST)).toEqual(['', '!,Duty cycle;!,!;!;01']);
  });

  it('getPalettePreviews paginates page 0..m inclusive, merging and classifying every page', async () => {
    // Mirrors real device behavior: every page repeats m, and the final
    // page may be empty (192.168.1.86 serves m=9 with page 9 = {}).
    const fetchMock = stubFetchRoutes({
      '/json/palx?page=0': {
        m: 2,
        p: { '0': [[0, 155, 0, 213], [240, 0, 50, 252]], '1': ['r', 'r', 'r', 'r'] }
      },
      '/json/palx?page=1': { m: 2, p: { '8': [[0, 0, 0, 0], [255, 255, 0, 0]] } },
      '/json/palx?page=2': { m: 2, p: {} }
    });

    const previews = await getPalettePreviews(HOST);

    expect(previews).toEqual({
      0: { type: 'stops', stops: [[0, 155, 0, 213], [240, 0, 50, 252]] },
      1: { type: 'random' },
      8: { type: 'stops', stops: [[0, 0, 0, 0], [255, 255, 0, 0]] }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('getPalettePreviews stops after page 0 when m is 0', async () => {
    const fetchMock = stubFetchRoutes({
      '/json/palx?page=0': { m: 0, p: { '2': ['c1'] } }
    });
    expect(await getPalettePreviews(HOST)).toEqual({ 2: { type: 'slots', slots: ['c1'] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getConfig returns cfg.json untouched', async () => {
    // Trimmed verbatim from GET /json/cfg on 192.168.1.86.
    const cfg = {
      rev: [1, 0],
      vid: 2605030,
      id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false }
    };
    stubFetchRoutes({ '/json/cfg': cfg });
    expect(await getConfig(HOST)).toEqual(cfg);
  });

  it('getFullState fetches the combined /json object', async () => {
    const full = {
      state: { on: true, bri: 128, ps: -1, seg: [] },
      info: { name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030, leds: { count: 48, rgbw: true }, arch: 'esp32' },
      effects: ['Solid', 'Blink'],
      palettes: ['Default', '* Random Cycle']
    };
    stubFetchRoutes({ '/json': full });
    expect(await getFullState(HOST)).toEqual(full);
  });
});

/** Captures every request; returns `responses[key]` or `{success:true}`. */
function stubFetchCapture(responses: Record<string, unknown> = {}) {
  const calls: { key: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, search } = new URL(url);
    const key = pathname + search;
    calls.push({
      key,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined
    });
    return { ok: true, json: async () => responses[key] ?? { success: true } } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('wled client v2 device ops', () => {
  it('patchConfig POSTs a partial cfg patch to /json/cfg', async () => {
    const calls = stubFetchCapture();
    const result = await patchConfig(HOST, { id: { name: 'New Name' } });
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      { key: '/json/cfg', method: 'POST', body: { id: { name: 'New Name' } } }
    ]);
  });

  it('savePreset with an explicit id POSTs psave/n/ib/sb and skips presets.json', async () => {
    const calls = stubFetchCapture();
    const result = await savePreset(HOST, {
      id: 7, name: 'Movie night', includeBrightness: true, saveSegmentBounds: false
    });
    expect(result).toEqual({ id: 7 });
    expect(calls).toEqual([
      { key: '/json/state', method: 'POST', body: { psave: 7, n: 'Movie night', ib: true, sb: false } }
    ]);
  });

  it('savePreset without id reads presets.json and takes the lowest free slot >= 1', async () => {
    // Slot 0 as a reserved empty object is verbatim real-device behavior.
    const calls = stubFetchCapture({
      '/presets.json': { '0': {}, '1': { n: 'Sunset' }, '2': { n: 'Party' } }
    });
    const result = await savePreset(HOST, {
      name: 'Movie night', includeBrightness: false, saveSegmentBounds: true
    });
    expect(result).toEqual({ id: 3 });
    expect(calls).toEqual([
      { key: '/presets.json', method: 'GET', body: undefined },
      { key: '/json/state', method: 'POST', body: { psave: 3, n: 'Movie night', ib: false, sb: true } }
    ]);
  });

  it('savePreset without id fills gaps in the preset id sequence', async () => {
    const calls = stubFetchCapture({
      '/presets.json': { '1': { n: 'A' }, '3': { n: 'B' } }
    });
    const result = await savePreset(HOST, {
      name: 'Gap', includeBrightness: true, saveSegmentBounds: true
    });
    expect(result).toEqual({ id: 2 });
    expect(calls[1].body).toEqual({ psave: 2, n: 'Gap', ib: true, sb: true });
  });

  it('deletePreset POSTs pdel', async () => {
    const calls = stubFetchCapture();
    await deletePreset(HOST, 3);
    expect(calls).toEqual([{ key: '/json/state', method: 'POST', body: { pdel: 3 } }]);
  });

  it('reboot POSTs rb:true', async () => {
    const calls = stubFetchCapture();
    await reboot(HOST);
    expect(calls).toEqual([{ key: '/json/state', method: 'POST', body: { rb: true } }]);
  });

  it('setNightlight wraps the nl object in a state patch', async () => {
    const calls = stubFetchCapture({
      '/json/state': { on: true, bri: 128, ps: -1, seg: [] }
    });
    await setNightlight(HOST, { on: true, dur: 30, mode: 1, tbri: 0 });
    expect(calls).toEqual([
      { key: '/json/state', method: 'POST', body: { nl: { on: true, dur: 30, mode: 1, tbri: 0 } } }
    ]);
  });
});
