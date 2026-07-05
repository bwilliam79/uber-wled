import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FirmwareStatus } from '../../sections/devices/FirmwareStatus';

afterEach(() => vi.unstubAllGlobals());

describe('FirmwareStatus', () => {
  it('shows "Controller offline" when the status reports the device unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        unreachable: true, installedVersion: null, latestTag: null,
        updateAvailable: false, isPrerelease: false, pinnedAssetPattern: null, candidateAssets: []
      })
    }));
    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText(/Controller offline/i)).toBeTruthy());
  });

  it('shows "Firmware status unavailable" instead of hanging when the status call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText(/Firmware status unavailable/i)).toBeTruthy());
    expect(screen.queryByText(/Checking firmware/i)).toBeNull();
  });

  it('shows an "Update available" badge and a picker trigger when unpinned with an update available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        isPrerelease: false,
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
    // The picker itself stays closed until the user asks for it — with several
    // unpinned controllers on the page at once, auto-opening every picker would
    // stack that many full-screen modals on top of each other.
    expect(screen.queryByText('WLED_0.15.0_ESP8266.bin')).toBeNull();

    fireEvent.click(screen.getByText('Pick firmware asset'));
    expect(screen.getByText('WLED_0.15.0_ESP8266.bin')).toBeTruthy();
    expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy();
  });

  it('shows a one-click Update button once pinned and matched, with no update available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false,
        isPrerelease: false,
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
        isPrerelease: false,
        pinnedAssetPattern: null,
        candidateAssets: [{ name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }]
      })
    });
    vi.stubGlobal('fetch', getFetch);

    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText('Pick firmware asset')).toBeTruthy());
    fireEvent.click(screen.getByText('Pick firmware asset'));
    expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy();

    const pinFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', pinFetch);
    fireEvent.click(screen.getByText('WLED_0.15.0_ESP02.bin'));

    await waitFor(() =>
      expect(pinFetch).toHaveBeenCalledWith(
        '/api/controllers/c1/firmware/pin',
        expect.objectContaining({ method: 'POST' })
      )
    );

    const [, requestInit] = pinFetch.mock.calls[0];
    expect(JSON.parse(requestInit.body)).toEqual({ assetPattern: 'ESP02' });
  });

  it('shows a one-click Update button when pinned, matched, and an update is available, and wires it to pushFirmwareUpdate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        isPrerelease: false,
        pinnedAssetPattern: 'ESP02', candidateAssets: []
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText('Update')).toBeTruthy());

    const updateFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, installedVersion: '0.15.0' })
    });
    vi.stubGlobal('fetch', updateFetch);

    fireEvent.click(screen.getByText('Update'));

    await waitFor(() =>
      expect(updateFetch).toHaveBeenCalledWith(
        '/api/controllers/c1/firmware/update',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });

  it('shows a pre-release indicator when the latest resolved release is a pre-release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ installedVersion: '0.14.0', latestTag: 'v0.15.1-b3', updateAvailable: true, isPrerelease: true, pinnedAssetPattern: 'ESP32', candidateAssets: [] })
    }));
    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText(/pre-release/i)).toBeTruthy());
  });
});
