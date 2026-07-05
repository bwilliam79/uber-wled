import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { HomeSection } from '../components/HomeSection';

afterEach(() => vi.unstubAllGlobals());

const GROUPS = [{ id: 'g1', name: 'Kitchen', members: [{ controllerId: 'c1', wledSegId: 0 }] }];
const CONTROLLERS = [
  { id: 'c1', name: 'Kitchen Strip', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Porch Strip', host: '10.0.0.51', source: 'manual', stale: false, pinnedAssetPattern: null }
];
const SEG_ON = [{ id: 0, start: 0, stop: 10, len: 10, on: true, bri: 200, fx: 0, pal: 0, col: [[255, 255, 255]] }];

function stubFetch(segmentsByController: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/groups') return Promise.resolve({ ok: true, json: async () => GROUPS });
    if (url === '/api/controllers') return Promise.resolve({ ok: true, json: async () => CONTROLLERS });
    if (url === '/api/themes') return Promise.resolve({ ok: true, json: async () => [] });
    if (url === '/api/themes/effects-palettes') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ effects: ['Solid', 'Breathe'], palettes: [], sourceControllerId: 'c1', sourceControllerName: 'Kitchen Strip' })
      });
    }
    if (url === '/api/control/apply') return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
    const segMatch = url.match(/^\/api\/controllers\/(.+)\/segments$/);
    if (segMatch) {
      const segs = segmentsByController[segMatch[1]];
      if (segs === 'offline') return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, json: async () => segs ?? [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('HomeSection', () => {
  it('renders one tile per group and one tile per ungrouped controller', async () => {
    stubFetch({ c1: SEG_ON, c2: [] });
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    expect(screen.getByText('Porch Strip')).toBeTruthy();
    expect(screen.getByText('Ungrouped')).toBeTruthy();
  });

  it('passes imported WLED effects through to every tile\'s dropdown', async () => {
    stubFetch({ c1: SEG_ON, c2: [] });
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    expect(screen.getAllByText('Breathe')).toHaveLength(2); // one per tile (Kitchen + Porch Strip)
  });

  it('shows an empty state when there are no controllers at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText(/Add a controller in Controllers/)).toBeTruthy());
  });

  it('shows a banner suggesting Groups when controllers exist but no groups do', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/controllers') return Promise.resolve({ ok: true, json: async () => CONTROLLERS });
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText(/create one in Groups/i)).toBeTruthy());
  });

  it('applies a power action to a group tile with exactly that group\'s members', async () => {
    const fetchMock = stubFetch({ c1: SEG_ON, c2: [] });
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());

    const kitchenTile = screen.getByText('Kitchen').closest('.home-tile') as HTMLElement;
    fireEvent.click(within(kitchenTile).getByText('On'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ members: [{ controllerId: 'c1', wledSegId: 0 }], action: { type: 'power', on: true } })
      }))
    );
  });

  it('shows an offline badge on a tile whose member controller is unreachable', async () => {
    stubFetch({ c1: 'offline', c2: [] });
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    const kitchenTile = screen.getByText('Kitchen').closest('.home-tile') as HTMLElement;
    await waitFor(() => expect(within(kitchenTile).getByText('offline')).toBeTruthy());
  });
});
