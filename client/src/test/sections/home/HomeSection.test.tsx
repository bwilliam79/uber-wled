import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { liveMap } = vi.hoisted(() => ({ liveMap: new Map<string, unknown>() }));

vi.mock('../../../api/live', () => ({
  useLiveStatus: () => liveMap
}));
vi.mock('../../../control/ControlSurface', () => ({
  ControlSurface: ({ open, targets }: { open: boolean; targets: unknown[] }) =>
    open ? <div data-testid="control-surface">{JSON.stringify(targets)}</div> : null
}));
// NOTE: shipped Phase C kit uses `label`, not `ariaLabel`, for Toggle/Slider
// (see components/ui/Toggle.tsx, components/ui/Slider.tsx). Mocks below match
// the real prop names (plan text used `ariaLabel`; adapted per Task 6 precedent).
vi.mock('../../../components/ui/Toggle', () => ({
  Toggle: ({ checked, onChange, label, disabled }: any) => (
    <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
  )
}));
vi.mock('../../../components/ui/Slider', () => ({
  Slider: ({ value, onChange, label, min, max, disabled }: any) => (
    <input type="range" aria-label={label} value={value} min={min} max={max} disabled={disabled}
      onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))} />
  )
}));
vi.mock('../../../components/ui/Modal', () => ({
  Modal: ({ open, title, children }: any) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null
}));

import { HomeSection } from '../../../sections/home/HomeSection';

afterEach(() => vi.unstubAllGlobals());

const GROUPS = [
  { id: 'g1', name: 'Kitchen', icon: '🍳', sortOrder: 0, members: [{ controllerId: 'c1', wledSegId: 0 }] },
  { id: 'g2', name: 'Porch', icon: null, sortOrder: 1, members: [{ controllerId: 'c1', wledSegId: 1 }] }
];
const CONTROLLERS = [
  { id: 'c1', name: 'Cabinet Lights', host: '192.168.1.86', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Desk Strip', host: '192.168.1.90', source: 'manual', stale: false, pinnedAssetPattern: null }
];

// captured 2026-07-04 from GET http://192.168.1.86/json/state (color slot changed for test clarity)
const LIVE_STATE_C1 = {
  on: true,
  bri: 128,
  seg: [
    { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 255, col: [[255, 80, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { id: 1, start: 39, stop: 48, len: 9, on: false, bri: 255, col: [[0, 0, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
  ]
};

function statusFixture(id: string, segIds: number[]) {
  return {
    controllerId: id,
    reachable: true,
    info: { name: id, ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' },
    state: {
      on: true, bri: 9, ps: -1,
      seg: segIds.map((s) => ({ id: s, start: 0, stop: 10, len: 10, on: true, bri: 255, fx: 0, pal: 0, col: [[255, 255, 255, 0]] }))
    },
    polledAt: '2026-07-04T22:00:00Z'
  };
}

function stubFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const respond = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    const method = init?.method ?? 'GET';
    if (url === '/api/groups' && method === 'GET') return respond(GROUPS);
    if (url === '/api/groups' && method === 'POST') return respond({ ...GROUPS[0], id: 'g-new' });
    if (url === '/api/groups/reorder') return respond(GROUPS);
    if (url.startsWith('/api/groups/') && method === 'PATCH') return respond(GROUPS[0]);
    if (url.startsWith('/api/groups/') && method === 'DELETE') return respond({});
    if (url === '/api/controllers') return respond(CONTROLLERS);
    if (url === '/api/control/apply') return respond({ results: [] });
    if (url === '/api/controllers/c1/status') return respond(statusFixture('c1', [0, 1]));
    if (url === '/api/controllers/c2/status') return respond(statusFixture('c2', [0]));
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeSection />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  liveMap.clear();
  liveMap.set('c1', { reachable: true, state: LIVE_STATE_C1 });
});

describe('HomeSection grid', () => {
  it('renders group tiles in sortOrder then ungrouped controllers, and skips grouped ones', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    const ids = screen.getAllByTestId(/^home-tile-/).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['home-tile-g1', 'home-tile-g2', 'home-tile-c2']);
  });

  it('shows a green status dot for a tile that is on', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    expect(screen.getByTestId('tile-status-dot-g1').className).toContain('home-tile-status-dot-on');
  });

  it('greys out a tile whose controller has no live entry, with a grey status dot', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Desk Strip')).toBeTruthy());
    const tile = screen.getByTestId('home-tile-c2');
    expect(tile.className).toContain('home-tile-offline');
    expect(screen.getByTestId('tile-status-dot-c2').className).toContain('home-tile-status-dot-offline');
  });

  it('sends a v2 seg power patch for a group tile toggle, optimistically flipping the tile', async () => {
    const fetchMock = stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch', { name: 'power for Kitchen' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targets: [{ kind: 'group', groupId: 'g1' }], patch: { seg: { on: false } } })
      }))
    );
    const kitchen = screen.getByTestId('home-tile-g1');
    expect(within(kitchen).getByText('Off')).toBeTruthy(); // optimistic override
  });

  it('sends a top-level power patch for an ungrouped controller tile', async () => {
    const fetchMock = stubFetch();
    liveMap.set('c2', {
      reachable: true,
      state: { on: false, bri: 60, seg: [{ id: 0, start: 0, stop: 30, len: 30, on: true, bri: 60, col: [[0, 255, 0]] }] }
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('Desk Strip')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch', { name: 'power for Desk Strip' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targets: [{ kind: 'controller', controllerId: 'c2' }], patch: { on: true } })
      }))
    );
  });

  it('sends a throttled v2 brightness patch and shows the optimistic percent', async () => {
    const fetchMock = stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.change(screen.getByRole('slider', { name: 'brightness for Kitchen' }), {
      target: { value: '200' }
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targets: [{ kind: 'group', groupId: 'g1' }], patch: { seg: { bri: 200 } } })
      }))
    );
    expect(within(screen.getByTestId('home-tile-g1')).getByText('78%')).toBeTruthy(); // 200/255
  });

  it('opens the Control surface with the group target when the tile body is tapped', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'open controls for Kitchen' }));
    const surface = screen.getByTestId('control-surface');
    expect(surface.textContent).toContain('"groupId":"g1"');
  });

  it('shows an empty state when there are no controllers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    renderHome();
    await waitFor(() => expect(screen.getByText(/Add a controller in Devices/)).toBeTruthy());
  });
});

describe('HomeSection multi-select', () => {
  it('enters select mode from the tile checkbox and shows the action bar', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'select Kitchen' }));
    const bar = screen.getByRole('toolbar', { name: 'selection actions' });
    expect(within(bar).getByText('1 selected')).toBeTruthy();
  });

  it('select-all selects every tile and Control opens the surface with all targets', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'select Kitchen' }));
    fireEvent.click(screen.getByText('Select all'));
    expect(screen.getByText('3 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Control'));
    const surface = screen.getByTestId('control-surface');
    expect(surface.textContent).toContain('"groupId":"g1"');
    expect(surface.textContent).toContain('"groupId":"g2"');
    expect(surface.textContent).toContain('"controllerId":"c2"');
  });

  it('cancel exits select mode and clears the selection', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'select Kitchen' }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('toolbar', { name: 'selection actions' })).toBeNull();
  });
});

describe('HomeSection edit mode', () => {
  async function enterEdit() {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  }

  it('creates a room with a name and an icon from the fixed set', async () => {
    await enterEdit();
    fireEvent.click(screen.getByText('Add room'));
    const dialog = screen.getByRole('dialog', { name: 'New room' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Bedroom' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'icon 🛏️' }));
    fireEvent.click(within(dialog).getByText('Create room'));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Bedroom', members: [], icon: '🛏️' })
      }))
    );
  });

  it('renames a room inline on blur', async () => {
    await enterEdit();
    const input = screen.getByRole('textbox', { name: 'rename Kitchen' });
    fireEvent.change(input, { target: { value: 'Kitchen 2' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Kitchen 2' })
      }))
    );
  });

  it('changes a room icon from the picker', async () => {
    await enterEdit();
    fireEvent.click(screen.getByRole('button', { name: 'change icon for Kitchen' }));
    fireEvent.click(screen.getAllByRole('radio', { name: 'icon 📚' })[0]);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ icon: '📚' })
      }))
    );
  });

  it('deletes a room only after modal confirmation', async () => {
    await enterEdit();
    const tile = screen.getByTestId('edit-tile-g1');
    fireEvent.click(within(tile).getByText('Delete'));
    const dialog = screen.getByRole('dialog', { name: 'Delete room' });
    fireEvent.click(within(dialog).getByText('Delete'));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', { method: 'DELETE' })
    );
  });
});

describe('HomeSection room member editing', () => {
  async function openMembers() {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(screen.getByTestId('edit-tile-g1')).getByText('Members'));
  }

  it('lists current members with controller name and segment id', async () => {
    await openMembers();
    await waitFor(() =>
      expect(screen.getByText('Cabinet Lights · segment 0')).toBeTruthy()
    );
  });

  it('prefers the live device-reported name over the stored controller name for members and the add-controller picker', async () => {
    liveMap.set('c1', {
      reachable: true,
      state: LIVE_STATE_C1,
      info: { name: 'Cabinet Lights (Live)', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' }
    });
    await openMembers();
    await waitFor(() =>
      expect(screen.getByText('Cabinet Lights (Live) · segment 0')).toBeTruthy()
    );
    const tile = screen.getByTestId('edit-tile-g1');
    expect(within(tile).getByRole('option', { name: 'Cabinet Lights (Live)' })).toBeTruthy();
  });

  it('adds a controller+segment pair, with segment ids from the cached status', async () => {
    await openMembers();
    const tile = screen.getByTestId('edit-tile-g1');
    fireEvent.change(within(tile).getByRole('combobox', { name: 'controller to add to Kitchen' }), {
      target: { value: 'c2' }
    });
    // status fetch for c2 resolves with one segment (id 0)
    await waitFor(() =>
      expect(within(tile).getByRole('combobox', { name: 'segment to add to Kitchen' })).toBeTruthy()
    );
    fireEvent.click(within(tile).getByText('Add member'));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          members: [
            { controllerId: 'c1', wledSegId: 0 },
            { controllerId: 'c2', wledSegId: 0 }
          ]
        })
      }))
    );
  });

  it('removes a member', async () => {
    await openMembers();
    await waitFor(() => expect(screen.getByText('Cabinet Lights · segment 0')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: 'remove Cabinet Lights segment 0 from Kitchen' })
    );
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ members: [] })
      }))
    );
  });
});

describe('HomeSection reorder', () => {
  it('persists the new order when a room is moved with the arrow buttons', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'move Kitchen later' }));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/reorder', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['g2', 'g1'] })
      }))
    );
  });

  it('disables the boundary arrows', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByRole('button', { name: 'move Kitchen earlier' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'move Porch later' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
