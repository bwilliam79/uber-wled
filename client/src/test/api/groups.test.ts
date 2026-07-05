import { describe, it, expect, vi, afterEach } from 'vitest';
import { addGroup, updateGroup, reorderGroups, applyControl } from '../../api/client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('groups + control v2 api', () => {
  it('addGroup sends icon alongside name and members', async () => {
    const fetchMock = stubFetch();
    await addGroup('Bedroom', [], '🛏️');
    expect(fetchMock).toHaveBeenCalledWith('/api/groups', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Bedroom', members: [], icon: '🛏️' })
    }));
  });

  it('updateGroup can patch just the icon', async () => {
    const fetchMock = stubFetch();
    await updateGroup('g1', { icon: '📚' });
    expect(fetchMock).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ icon: '📚' })
    }));
  });

  it('reorderGroups posts the full id order', async () => {
    const fetchMock = stubFetch([]);
    await reorderGroups(['g2', 'g1']);
    expect(fetchMock).toHaveBeenCalledWith('/api/groups/reorder', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ids: ['g2', 'g1'] })
    }));
  });

  it('applyControl posts targets and patch to the v2 route', async () => {
    const fetchMock = stubFetch({ results: [] });
    await applyControl([{ kind: 'group', groupId: 'g1' }], { seg: { on: true } });
    expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ targets: [{ kind: 'group', groupId: 'g1' }], patch: { seg: { on: true } } })
    }));
  });

  it('applyControl carries a device-preset ps patch through unchanged', async () => {
    const fetchMock = stubFetch({ results: [] });
    await applyControl([{ kind: 'controller', controllerId: 'c1' }], { ps: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ targets: [{ kind: 'controller', controllerId: 'c1' }], patch: { ps: 3 } })
    }));
  });
});
