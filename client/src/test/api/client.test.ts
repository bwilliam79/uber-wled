import { describe, it, expect, vi, afterEach } from 'vitest';
import { listControllers, addController } from '../../api/client';

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
});
