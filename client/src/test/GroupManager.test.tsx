import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GroupManager } from '../components/GroupManager';

afterEach(() => vi.unstubAllGlobals());

const controllers = [
  { id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Deck', host: '10.0.0.51', source: 'discovered', stale: false, pinnedAssetPattern: null }
];

function makeGroup(members: { controllerId: string; wledSegId: number }[] = []) {
  return { id: 'g1', name: 'Holiday', members };
}

function stubFetch(initialGroups: ReturnType<typeof makeGroup>[], onPatch?: (id: string, body: unknown) => unknown) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/groups' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => initialGroups });
    }
    if (url === '/api/controllers' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => controllers });
    }
    if (url.startsWith('/api/groups/') && method === 'PATCH') {
      const id = url.split('/').pop()!;
      const body = JSON.parse(init!.body as string);
      const result = onPatch ? onPatch(id, body) : { ...makeGroup(), ...body, id };
      return Promise.resolve({ ok: true, json: async () => result });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GroupManager', () => {
  it('renders existing members of a group', async () => {
    stubFetch([makeGroup([{ controllerId: 'c1', wledSegId: 2 }])]);

    render(<GroupManager />);

    await waitFor(() => expect(screen.getByText('Holiday')).toBeTruthy());
    expect(screen.getByText('segment 2')).toBeTruthy();
    const memberRow = screen.getByText('segment 2').closest('li');
    expect(memberRow?.textContent).toContain('Porch');
  });

  it('adds a member via updateGroup with the selected controller and segment id', async () => {
    const group = makeGroup([]);
    const fetchMock = stubFetch([group], (id, body) => ({ ...group, id, ...(body as object) }));

    render(<GroupManager />);

    await waitFor(() => expect(screen.getByText('Holiday')).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText('controller for Holiday')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('controller for Holiday'), { target: { value: 'c2' } });
    fireEvent.change(screen.getByLabelText('segment id for Holiday'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Add member'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/groups/g1',
        expect.objectContaining({ method: 'PATCH' })
      )
    );

    const patchCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/groups/g1' && init?.method === 'PATCH');
    const body = JSON.parse(patchCall![1]!.body as string);
    expect(body.members).toEqual([{ controllerId: 'c2', wledSegId: 3 }]);

    await waitFor(() => expect(screen.getByText('segment 3')).toBeTruthy());
    const memberRow = screen.getByText('segment 3').closest('li');
    expect(memberRow?.textContent).toContain('Deck');
  });

  it('removes an existing member via updateGroup with the member filtered out', async () => {
    const group = makeGroup([
      { controllerId: 'c1', wledSegId: 1 },
      { controllerId: 'c2', wledSegId: 4 }
    ]);
    const fetchMock = stubFetch([group], (id, body) => ({ ...group, id, ...(body as object) }));

    render(<GroupManager />);

    await waitFor(() => expect(screen.getByText('segment 1')).toBeTruthy());
    expect(screen.getByText('segment 4')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove Porch segment 1 from Holiday'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/groups/g1',
        expect.objectContaining({ method: 'PATCH' })
      )
    );

    const patchCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/groups/g1' && init?.method === 'PATCH');
    const body = JSON.parse(patchCall![1]!.body as string);
    expect(body.members).toEqual([{ controllerId: 'c2', wledSegId: 4 }]);

    await waitFor(() => expect(screen.queryByText('segment 1')).toBeNull());
    expect(screen.getByText('segment 4')).toBeTruthy();
  });
});
