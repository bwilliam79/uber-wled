import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyControl, getCapabilities } from '../../api/client';

afterEach(() => vi.unstubAllGlobals());

describe('phase H api contracts', () => {
  it('applyControl POSTs { targets, patch } to /api/control/apply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await applyControl(
      [{ kind: 'group', groupId: 'g1' }],
      { on: true, bri: 128, seg: { fxId: 2, palId: 6, col: [[255, 0, 0]] } }
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      targets: [{ kind: 'group', groupId: 'g1' }],
      patch: { on: true, bri: 128, seg: { fxId: 2, palId: 6, col: [[255, 0, 0]] } }
    });
  });

  it('getCapabilities GETs /api/controllers/:id/capabilities', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ vid: 2605030, effects: [], palettes: [], fxMeta: [], palettePreviews: {}, fetchedAt: 'x' })
    });
    vi.stubGlobal('fetch', fetchMock);
    const caps = await getCapabilities('c1');
    expect(fetchMock).toHaveBeenCalledWith('/api/controllers/c1/capabilities');
    expect(caps.vid).toBe(2605030);
  });
});
