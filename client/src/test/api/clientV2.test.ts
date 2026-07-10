import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  applyControl, getCapabilities, listDevicePresets,
  type Target, type ControlPatch
} from '../../api/client';

describe('api client v2 control fetchers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applyControl POSTs { targets, patch } to /api/control/apply and returns results', async () => {
    const results = [{ controllerId: 'c1', wledSegId: null, ok: true }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results }) });
    const targets: Target[] = [
      { kind: 'controller', controllerId: 'c1' },
      { kind: 'segment', controllerId: 'c2', wledSegId: 1 },
      { kind: 'group', groupId: 'g1' }
    ];
    const patch: ControlPatch = { on: true, bri: 120, seg: { fxName: 'Blink', sx: 40 } };
    const res = await applyControl(targets, patch);
    expect(global.fetch).toHaveBeenCalledWith('/api/control/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets, patch })
    });
    expect(res).toEqual({ results });
  });

  it('applyControl rejects when the response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(applyControl([], {})).rejects.toThrow('POST /api/control/apply failed');
  });

  it('applyControl prefers the server error body over the generic METHOD/url message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: '"Cabinet" is already active in sync group "Front porch".' })
    });
    await expect(applyControl([], {})).rejects.toThrow(
      '"Cabinet" is already active in sync group "Front porch".'
    );
  });

  it('applyControl carries a device-preset patch { ps }', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    await applyControl([{ kind: 'controller', controllerId: 'c1' }], { ps: 3 });
    expect(global.fetch).toHaveBeenCalledWith('/api/control/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [{ kind: 'controller', controllerId: 'c1' }], patch: { ps: 3 } })
    });
  });

  it('getCapabilities GETs /api/controllers/:id/capabilities', async () => {
    const caps = { vid: 2605030, effects: ['Solid'], palettes: ['Default'], fxMeta: [], palettePreviews: {}, fetchedAt: '2026-07-04T00:00:00.000Z' };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => caps });
    const res = await getCapabilities('c1');
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers/c1/capabilities');
    expect(res).toEqual(caps);
  });

  it('listDevicePresets GETs /api/controllers/:id/presets and unwraps presets', async () => {
    const presets = [{ id: 1, name: 'Night', isPlaylist: false, quicklook: { fx: 0, on: true } }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ presets }) });
    const res = await listDevicePresets('c1');
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers/c1/presets');
    expect(res).toEqual(presets);
  });
});
