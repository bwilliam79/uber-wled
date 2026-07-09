import { describe, it, expect, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { actionToPatch, applyActionV2 } from '../../src/control/actionMap.js';

// Project-wide pattern: stub global fetch (nock does not intercept Node's
// built-in undici-backed fetch — see ~/.claude/skills/vitest-testing-gotchas).
function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const okState = { on: true, bri: 128, ps: -1, seg: [] };

describe('actionToPatch', () => {
  const noTheme = () => undefined;

  it('maps power to a top-level on patch', () => {
    expect(actionToPatch({ type: 'power', on: true }, noTheme)).toEqual({ on: true });
    expect(actionToPatch({ type: 'power', on: false }, noTheme)).toEqual({ on: false });
  });

  it('maps brightness to a top-level bri patch', () => {
    expect(actionToPatch({ type: 'brightness', value: 200 }, noTheme)).toEqual({ bri: 200 });
  });

  it('maps preset to a top-level ps patch (device presets are device-level)', () => {
    expect(actionToPatch({ type: 'preset', presetId: 3 }, noTheme)).toEqual({ ps: 3 });
  });

  it('maps effect to a seg fxId patch', () => {
    expect(actionToPatch({ type: 'effect', effectId: 9 }, noTheme)).toEqual({ seg: { fxId: 9 } });
  });

  it('maps theme by resolving stored effect/palette/colors/brightness', () => {
    const resolve = (id: string) =>
      id === 't1' ? { effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180, speed: 200, intensity: 90 } : undefined;
    expect(actionToPatch({ type: 'theme', themeId: 't1' }, resolve)).toEqual({
      bri: 180,
      seg: { fxId: 2, palId: 5, col: [[255, 100, 0]], sx: 200, ix: 90 }
    });
  });

  it('throws for an unresolvable theme', () => {
    expect(() => actionToPatch({ type: 'theme', themeId: 'nope' }, noTheme))
      .toThrow('theme nope not found');
  });
});

describe('applyActionV2', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const a = controllers.add({ name: 'A', host: '10.0.0.50', source: 'manual' }).id;
    const b = controllers.add({ name: 'B', host: '10.0.0.51', source: 'manual' }).id;
    return { db, a, b };
  }

  it('fans brightness out to every member with udpn:{nn:true}', async () => {
    const { db, a, b } = setup();
    const bodies: any[] = [];
    stubFetchByHost({
      '10.0.0.50': (_url, init) => { bodies.push(JSON.parse(init?.body as string)); return { status: 200, body: okState }; },
      '10.0.0.51': (_url, init) => { bodies.push(JSON.parse(init?.body as string)); return { status: 200, body: okState }; }
    });

    const results = await applyActionV2(db, [
      { controllerId: a, wledSegId: 0 },
      { controllerId: b, wledSegId: 0 }
    ], { type: 'brightness', value: 200 });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    for (const body of bodies) {
      expect(body).toEqual(expect.objectContaining({ bri: 200, udpn: { nn: true } }));
    }
  });

  it('applies a theme to the member segment by id (v2 patches JUST that segment)', async () => {
    const { db, a } = setup();
    const themes = createThemeRepository(db);
    const theme = themes.add({ name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 });
    let captured: any;
    stubFetchByHost({
      '10.0.0.50': (_url, init) => { captured = JSON.parse(init?.body as string); return { status: 200, body: okState }; }
    });

    const results = await applyActionV2(db, [{ controllerId: a, wledSegId: 1 }],
      { type: 'theme', themeId: theme.id });

    expect(results[0].ok).toBe(true);
    expect(captured.bri).toBe(180);
    expect(captured.udpn).toEqual({ nn: true });
    expect(captured.seg[0]).toEqual(expect.objectContaining({ id: 1, fx: 2, pal: 5, col: [[255, 100, 0]] }));
  });

  it('a member with wledSegId: null targets the whole controller, not a specific segment', async () => {
    // Used by the scheduler engine for schedules/calendar events that target
    // a controller directly rather than a group (see schedules/engine.ts's
    // targetOf) — must map to a 'controller'-kind Target, not 'segment'.
    const { db, a } = setup();
    let captured: any;
    stubFetchByHost({
      '10.0.0.50': (_url, init) => { captured = JSON.parse(init?.body as string); return { status: 200, body: okState }; }
    });

    const results = await applyActionV2(db, [{ controllerId: a, wledSegId: null }],
      { type: 'brightness', value: 200 });

    expect(results).toEqual([{ controllerId: a, wledSegId: null, ok: true }]);
    expect(captured.bri).toBe(200);
    expect(captured.udpn).toEqual({ nn: true });
  });

  it('applies a preset as top-level ps with udpn:{nn:true}', async () => {
    const { db, a } = setup();
    let captured: any;
    stubFetchByHost({
      '10.0.0.50': (_url, init) => { captured = JSON.parse(init?.body as string); return { status: 200, body: okState }; }
    });

    const results = await applyActionV2(db, [{ controllerId: a, wledSegId: 0 }],
      { type: 'preset', presetId: 3 });

    expect(results[0].ok).toBe(true);
    expect(captured).toEqual(expect.objectContaining({ ps: 3, udpn: { nn: true } }));
  });

  it('fails every member without touching the network when the theme does not exist (v1 parity: never throws)', async () => {
    const { db, a, b } = setup();
    const fetchMock = stubFetchByHost({});

    const results = await applyActionV2(db, [
      { controllerId: a, wledSegId: 0 },
      { controllerId: b, wledSegId: 0 }
    ], { type: 'theme', themeId: 'ghost' });

    expect(results).toEqual([
      { controllerId: a, wledSegId: 0, ok: false, error: 'theme ghost not found' },
      { controllerId: b, wledSegId: 0, ok: false, error: 'theme ghost not found' }
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isolates one failing member and retries it exactly once (v1 parity via applyControlPatch)', async () => {
    const { db, a, b } = setup();
    const fetchMock = stubFetchByHost({
      '10.0.0.50': () => ({ status: 200, body: okState }),
      '10.0.0.51': () => ({ status: 500, body: {} })
    });

    const results = await applyActionV2(db, [
      { controllerId: a, wledSegId: 0 },
      { controllerId: b, wledSegId: 0 }
    ], { type: 'power', on: true });

    expect(results.find((r) => r.controllerId === a)!.ok).toBe(true);
    const failed = results.find((r) => r.controllerId === b)!;
    expect(failed.ok).toBe(false);
    expect(failed.error).toBeTruthy();
    const hostBCalls = fetchMock.mock.calls.filter(([url]) => new URL(url as string).host === '10.0.0.51');
    expect(hostBCalls.length).toBe(2);
  });
});
