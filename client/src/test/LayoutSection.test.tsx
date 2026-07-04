import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LayoutSection } from '../components/LayoutSection';

afterEach(() => vi.unstubAllGlobals());

function stub(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/strips')) return Promise.resolve({ ok: true, json: async () => overrides.strips ?? [] });
    if (typeof url === 'string' && url.startsWith('/api/controllers')) return Promise.resolve({ ok: true, json: async () => overrides.controllers ?? [] });
    if (typeof url === 'string' && url.startsWith('/api/themes')) return Promise.resolve({ ok: true, json: async () => overrides.themes ?? [] });
    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LayoutSection', () => {
  it('renders strips from the API and shows the docked control panel empty state', async () => {
    stub({ strips: [{ id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' }] });
    render(<LayoutSection />);
    await waitFor(() => expect(screen.getByTestId('strip-s1')).toBeTruthy());
    expect(screen.getByText(/Select a strip to control it/)).toBeTruthy();
  });

  it('exposes a Draw strip toolbar action', async () => {
    stub();
    render(<LayoutSection />);
    await waitFor(() => expect(screen.getByText(/Draw strip/)).toBeTruthy());
  });
});
