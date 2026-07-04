import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FirmwareSection } from '../components/FirmwareSection';

afterEach(() => vi.unstubAllGlobals());

describe('FirmwareSection', () => {
  it('lists every controller with an update indicator when a newer stable exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/controllers/c1/firmware')) {
        return Promise.resolve({ ok: true, json: async () => ({ installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true, isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: [] }) });
      }
      if (typeof url === 'string' && url.startsWith('/api/controllers')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: 'ESP32' }] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    render(<FirmwareSection />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/update available/i)).toBeTruthy());
  });
});
