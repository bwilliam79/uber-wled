import { describe, it, expect, vi, afterEach } from 'vitest';
import { listControllers, addController, importSchedules, addStrip, updateSettings } from '../../api/client';

describe('api client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('listControllers GETs /api/controllers and returns json', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: '1', name: 'Porch' }] });
    const result = await listControllers();
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers');
    expect(result).toEqual([{ id: '1', name: 'Porch' }]);
  });

  it('addController POSTs name and host', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: '1', name: 'Porch', host: '10.0.0.50' }) });
    await addController('Porch', '10.0.0.50');
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Porch', host: '10.0.0.50' })
    });
  });

  it('importSchedules POSTs disableOnDevice and returns imported/skipped', async () => {
    const response = { imported: [{ id: 's1', name: 'Preset 1 (imported)' }], skipped: [{ raw: {}, reason: 'disabled' }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    const result = await importSchedules('ctrl-1', true);
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers/ctrl-1/import-schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disableOnDevice: true })
    });
    expect(result).toEqual(response);
  });

  it('addStrip POSTs to /api/strips and returns the created strip + recommendations', async () => {
    const body = { strip: { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], label: null }, recommendations: [] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    const result = await addStrip({ controllerId: 'c1', wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    expect(global.fetch).toHaveBeenCalledWith('/api/strips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ controllerId: 'c1', wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })
    });
    expect(result).toEqual(body);
  });

  it('updateSettings PATCHes /api/settings', async () => {
    const updated = { includePrereleaseFirmware: true, homeLatitude: null, homeLongitude: null, discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
    const result = await updateSettings({ includePrereleaseFirmware: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includePrereleaseFirmware: true })
    });
    expect(result).toEqual(updated);
  });
});
