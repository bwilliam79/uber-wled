import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  saveControllerPreset, deleteControllerPreset,
  getControllerConfig, dryRunControllerConfig, applyControllerConfig,
  rebootController, getControllerSegments, updateControllerSegment,
  createControllerSegment, deleteControllerSegment,
  type ControlPatch
} from '../../api/client';

afterEach(() => vi.unstubAllGlobals());

function stubOk(payload: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status, json: async () => payload });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('devices api client', () => {
  it('ControlPatch carries the master ps field for device-preset apply', () => {
    const patch: ControlPatch = { ps: 3 };
    expect(patch.ps).toBe(3);
  });

  it('saveControllerPreset POSTs name and flags and returns { id, name }', async () => {
    const fn = stubOk({ id: 3, name: 'Evening' }, 201);
    const res = await saveControllerPreset('c1', { name: 'Evening', includeBrightness: true, saveSegmentBounds: false });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/presets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Evening', includeBrightness: true, saveSegmentBounds: false });
    expect(res).toEqual({ id: 3, name: 'Evening' });
  });

  it('deleteControllerPreset DELETEs the preset', async () => {
    const fn = stubOk({});
    await deleteControllerPreset('c1', 4);
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1/presets/4', { method: 'DELETE' });
  });

  it('getControllerConfig GETs the raw cfg passthrough', async () => {
    const fn = stubOk({ id: { name: 'Cabinet Lights' } });
    const cfg = await getControllerConfig('c1');
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1/config');
    expect((cfg.id as { name: string }).name).toBe('Cabinet Lights');
  });

  it('dryRunControllerConfig POSTs to ?dryRun=1 with a wrapped patch', async () => {
    const fn = stubOk({ diff: [], rebootRequired: false });
    await dryRunControllerConfig('c1', { id: { name: 'X' } });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/config?dryRun=1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ patch: { id: { name: 'X' } } });
  });

  it('applyControllerConfig POSTs to the config route without dryRun', async () => {
    const fn = stubOk({ ok: true, rebootRequired: true });
    const res = await applyControllerConfig('c1', { ap: { chan: 6 } });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/config');
    expect(JSON.parse(init.body)).toEqual({ patch: { ap: { chan: 6 } } });
    expect(res.rebootRequired).toBe(true);
  });

  it('rebootController POSTs the reboot route', async () => {
    const fn = stubOk({ ok: true });
    await rebootController('c1');
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/reboot');
    expect(init.method).toBe('POST');
  });

  it('getControllerSegments GETs the segments route', async () => {
    const fn = stubOk([{ id: 0, start: 0, stop: 39 }]);
    const segs = await getControllerSegments('c1');
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1/segments');
    expect(segs[0].stop).toBe(39);
  });

  it('updateControllerSegment PUTs the widened field set with name (not n)', async () => {
    const fn = stubOk([]);
    await updateControllerSegment('c1', 0, {
      start: 0, stop: 40, grp: 1, spc: 0, of: 0, rev: true, mi: false, name: 'Left', on: true, bri: 200
    });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/segments/0');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      start: 0, stop: 40, grp: 1, spc: 0, of: 0, rev: true, mi: false, name: 'Left', on: true, bri: 200
    });
  });

  it('createControllerSegment POSTs start/stop', async () => {
    const fn = stubOk([{ id: 2, start: 48, stop: 60 }], 201);
    await createControllerSegment('c1', { start: 48, stop: 60 });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/segments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ start: 48, stop: 60 });
  });

  it('deleteControllerSegment DELETEs the segment id', async () => {
    const fn = stubOk([{ id: 0, start: 0, stop: 39 }]);
    const segs = await deleteControllerSegment('c1', 1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/segments/1');
    expect(init.method).toBe('DELETE');
    expect(segs).toHaveLength(1);
  });
});
