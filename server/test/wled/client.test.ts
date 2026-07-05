import { describe, it, expect, vi, afterEach } from 'vitest';
import { getInfo, getState, setState, setSegment, getPresets, applyPreset, getEffects, getPalettes } from '../../src/wled/client.js';

const HOST = '10.0.0.50';

function stubFetchOnce(expected: { url: string; method?: string; body?: unknown }, responseBody: unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe(expected.url);
    if (expected.method) expect(init?.method).toBe(expected.method);
    if (expected.body) expect(JSON.parse(init?.body as string)).toEqual(expected.body);
    return {
      ok: true,
      json: async () => responseBody
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('wled client', () => {
  it('getInfo fetches device info', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/info` },
      { name: 'Porch', ver: '0.14.0', leds: { count: 120 } }
    );
    const info = await getInfo(HOST);
    expect(info).toEqual({ name: 'Porch', ver: '0.14.0', leds: { count: 120 } });
  });

  it('getState fetches current state', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/state` },
      { on: true, bri: 128, ps: -1, seg: [{ id: 0, start: 0, stop: 60, len: 60, on: true, bri: 128, fx: 0, pal: 0, col: [[255, 0, 0]] }] }
    );
    const state = await getState(HOST);
    expect(state.seg).toHaveLength(1);
    expect(state.seg[0].len).toBe(60);
  });

  it('setState posts a patch and returns the resulting state', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/state`, method: 'POST', body: { bri: 200 } },
      { on: true, bri: 200, ps: -1, seg: [] }
    );
    const state = await setState(HOST, { bri: 200 });
    expect(state.bri).toBe(200);
  });

  it('setSegment posts a seg array with the given bounds', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/state`, method: 'POST', body: { seg: [{ id: 1, start: 60, stop: 120 }] } },
      { on: true, bri: 128, ps: -1, seg: [] }
    );
    await setSegment(HOST, { id: 1, start: 60, stop: 120 });
  });

  it('getPresets maps the preset object into a list', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/presets.json` },
      { '1': { n: 'Sunset' }, '2': { n: 'Party' } }
    );
    const presets = await getPresets(HOST);
    expect(presets).toEqual([
      { id: 1, name: 'Sunset' },
      { id: 2, name: 'Party' }
    ]);
  });

  it('applyPreset posts the preset id as ps', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/state`, method: 'POST', body: { ps: 2 } },
      { on: true, bri: 128, ps: 2, seg: [] }
    );
    const state = await applyPreset(HOST, 2);
    expect(state.ps).toBe(2);
  });

  it('getEffects fetches the effect name list', async () => {
    stubFetchOnce({ url: `http://${HOST}/json/eff` }, ['Solid', 'Blink', 'Breathe']);
    expect(await getEffects(HOST)).toEqual(['Solid', 'Blink', 'Breathe']);
  });

  it('getPalettes fetches the palette name list', async () => {
    stubFetchOnce({ url: `http://${HOST}/json/pal` }, ['Default', 'Random Cycle', 'Sunset']);
    expect(await getPalettes(HOST)).toEqual(['Default', 'Random Cycle', 'Sunset']);
  });
});
