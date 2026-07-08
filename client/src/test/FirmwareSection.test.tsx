import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { FirmwareSection } from '../sections/firmware/FirmwareSection';

afterEach(() => vi.unstubAllGlobals());

function stub({
  pinnedAssetPattern, updateAvailable = true
}: { pinnedAssetPattern: string | null; updateAvailable?: boolean } = { pinnedAssetPattern: 'ESP32' }) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/controllers/c1/firmware') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable,
          isPrerelease: false, pinnedAssetPattern, candidateAssets: [],
          detectedArch: 'esp32'
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
  it('lists controllers with installed/available versions, no host or hardware shown, and a gear icon that opens the device detail page', async () => {
    stub();
    const onOpen = vi.fn();
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={onOpen} />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());
    expect(screen.getByText(/Installed: 0\.14\.0.*Available: v0\.15\.0/)).toBeTruthy();
    expect(screen.queryByText('10.0.0.50')).toBeNull();
    expect(screen.queryByText(/Hardware:/)).toBeNull();

    fireEvent.click(screen.getByLabelText('Firmware settings for Porch'));
    expect(onOpen).toHaveBeenCalledWith('c1');
  });

  it('shows the empty state without controllers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByText('No controllers yet.')).toBeTruthy());
  });

  it('omits the Available text when no update is available', async () => {
    stub({ pinnedAssetPattern: 'ESP32', updateAvailable: false });
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Installed: 0.14.0')).toBeTruthy());
    expect(screen.queryByText(/Available:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  });

  it('shows a direct Update button when pinned and an update is available, and triggers the push on click', async () => {
    const fetchMock = stub({ pinnedAssetPattern: 'ESP32', updateAvailable: true });
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/controllers/c1/firmware/update',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });

  it('does not show a direct Update button when an update is available but nothing is pinned yet', async () => {
    stub({ pinnedAssetPattern: null, updateAvailable: true });
    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(screen.getByLabelText('Firmware settings for Porch')).toBeTruthy();
  });

  it('shows a visible error when the direct update push fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/controllers/c1/firmware/update' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: false, error: 'upload failed: device responded 500' }) });
      }
      if (url === '/api/controllers/c1/firmware') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
            isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: [], detectedArch: 'esp32'
          })
        });
      }
      if (url === '/api/controllers') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: 'ESP32' }]
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/upload failed: device responded 500/));
  });
});
