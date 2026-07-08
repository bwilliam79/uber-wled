import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { FirmwareSection } from '../sections/firmware/FirmwareSection';

afterEach(() => vi.unstubAllGlobals());

function stub({
  pinnedAssetPattern, detectedArch
}: { pinnedAssetPattern: string | null; detectedArch?: string | null } = { pinnedAssetPattern: 'ESP32' }) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/controllers/c1/firmware') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
          isPrerelease: false, pinnedAssetPattern, candidateAssets: [],
          detectedArch: detectedArch ?? null
        })
      });
    }
    if (url === '/api/controllers') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern }
        ]
      });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('FirmwareSection v2', () => {
  it('lists controllers with an update chip and deep-links into the device Update tab', async () => {
    stub();
    const onOpen = vi.fn();
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={onOpen} />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Update available \(v0\.15\.0\)/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Open update for Porch'));
    expect(onOpen).toHaveBeenCalledWith('c1');
  });

  it('shows the empty state without controllers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByText('No controllers yet.')).toBeTruthy());
  });

  it('shows the detected hardware architecture in the fleet row when known', async () => {
    stub({ pinnedAssetPattern: 'ESP32', detectedArch: 'esp32' });
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Hardware: esp32')).toBeTruthy());
  });

  it('omits the hardware row when the architecture is not yet known', async () => {
    stub({ pinnedAssetPattern: 'ESP32', detectedArch: null });
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());
    expect(screen.queryByText(/Hardware:/)).toBeNull();
  });
});
