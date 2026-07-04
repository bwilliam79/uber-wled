import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ControllersSection } from '../components/ControllersSection';

afterEach(() => vi.unstubAllGlobals());

describe('ControllersSection', () => {
  it('lists controllers and adds a new one', async () => {
    const controllers = [{ id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'c2', name: 'Deck', host: '10.0.0.60', source: 'manual', stale: false, pinnedAssetPattern: null }) });
      }
      if (typeof url === 'string' && url.startsWith('/api/controllers/c2/firmware')) return Promise.resolve({ ok: true, json: async () => ({ installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false, isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: [] }) });
      if (typeof url === 'string' && url.startsWith('/api/controllers/c1/firmware')) return Promise.resolve({ ok: true, json: async () => ({ installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false, isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: [] }) });
      return Promise.resolve({ ok: true, json: async () => controllers });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControllersSection />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/^Name$/, { selector: '#controller-name' }), { target: { value: 'Deck' } });
    fireEvent.change(screen.getByLabelText(/Host/), { target: { value: '10.0.0.60' } });
    fireEvent.click(screen.getByText('Add controller'));

    await waitFor(() => expect(screen.getByText('Deck')).toBeTruthy());
  });
});
