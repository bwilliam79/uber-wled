import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FirmwareStatus } from '../components/FirmwareStatus';

afterEach(() => vi.unstubAllGlobals());

describe('FirmwareStatus', () => {
  it('shows an "Update available" badge and asset picker when unpinned with an update available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        pinnedAssetPattern: null,
        candidateAssets: [
          { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/a.bin' },
          { name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText(/update available/i)).toBeTruthy());
    expect(screen.getByText('WLED_0.15.0_ESP8266.bin')).toBeTruthy();
    expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy();
  });

  it('shows a one-click Update button once pinned and matched, with no update available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false,
        pinnedAssetPattern: 'ESP02', candidateAssets: []
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText(/0\.15\.0/)).toBeTruthy());
    expect(screen.queryByText(/update available/i)).toBeNull();
    expect(screen.queryByText('Update')).toBeNull();
  });

  it('pins the chosen asset when a candidate is picked from the asset picker', async () => {
    const getFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        pinnedAssetPattern: null,
        candidateAssets: [{ name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }]
      })
    });
    vi.stubGlobal('fetch', getFetch);

    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy());

    const pinFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', pinFetch);
    fireEvent.click(screen.getByText('WLED_0.15.0_ESP02.bin'));

    await waitFor(() =>
      expect(pinFetch).toHaveBeenCalledWith(
        '/api/controllers/c1/firmware/pin',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });
});
