import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getFxData,
  getPalettePreviews,
  getConfig,
  getFullState
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
