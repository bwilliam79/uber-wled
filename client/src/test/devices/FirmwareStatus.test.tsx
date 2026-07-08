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

  it('shows installed/available on one line and hardware on its own line below, with a one-time-setup message and picker trigger when unpinned', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        isPrerelease: false,
        pinnedAssetPattern: null,
        candidateAssets: [
          { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/a.bin' },
          { name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }
        ],
        detectedArch: 'esp8266'
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText('Installed: 0.14.0')).toBeTruthy());
    expect(screen.getByText('Available: v0.15.0')).toBeTruthy();
    expect(screen.getByText('Hardware: esp8266')).toBeTruthy();
    expect(screen.getByText('One-time setup: pick the firmware asset for this device.')).toBeTruthy();
    // No update button yet — nothing is pinned, so nothing can be pushed.
    expect(screen.queryByText('Update Firmware')).toBeNull();

    // The picker itself stays closed until the user asks for it — with several
    // unpinned controllers on the page at once, auto-opening every picker would
    // stack that many full-screen modals on top of each other.
    expect(screen.queryByText('WLED_0.15.0_ESP8266.bin')).toBeNull();

    fireEvent.click(screen.getByText('Pick Firmware Asset'));
    expect(screen.getByText('WLED_0.15.0_ESP8266.bin')).toBeTruthy();
    expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy();
  });

  it('omits the Available line and the one-time-setup message when no update is available and nothing is pinned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false,
        isPrerelease: false, pinnedAssetPattern: null, candidateAssets: [], detectedArch: 'esp32'
      })
    }));
    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText('Hardware: esp32')).toBeTruthy());
    expect(screen.queryByText(/Available:/)).toBeNull();
    expect(screen.queryByText(/One-time setup/)).toBeNull();
    // No candidates at all (already up to date, nothing to pin) — no picker button either.
    expect(screen.queryByText('Pick Firmware Asset')).toBeNull();
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
    await waitFor(() => expect(screen.getByText('Pick Firmware Asset')).toBeTruthy());
    fireEvent.click(screen.getByText('Pick Firmware Asset'));
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

  it('surfaces a visible error and keeps the picker open when pinning fails, instead of silently discarding the choice', async () => {
    // Regression: pinFirmwareAsset used a bare fetch() with no .ok check, so
    // a failed pin (any non-2xx status) looked identical to success from the
    // caller's point of view — the picker closed, refresh() ran, nothing was
    // actually pinned, and the Update button never appeared with no error
    // shown anywhere. This is the exact "I picked an asset and there's still
    // no Update button" bug report.
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
    await waitFor(() => expect(screen.getByText('Pick Firmware Asset')).toBeTruthy());
    fireEvent.click(screen.getByText('Pick Firmware Asset'));

    const pinFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', pinFetch);
    fireEvent.click(screen.getByText('WLED_0.15.0_ESP02.bin'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Failed to save/));
    // Picker stays open — the user's choice wasn't silently discarded.
    expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy();
    expect(screen.queryByText('Update Firmware')).toBeNull();
  });

  it('highlights the recommended plain build in the picker, ahead of specialized-hardware variants', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '16.0.0', latestTag: 'v16.0.1', updateAvailable: true,
        isPrerelease: false, pinnedAssetPattern: null,
        candidateAssets: [
          { name: 'WLED_16.0.1_ESP32_HUB75.bin', downloadUrl: 'https://example.com/hub75.bin' },
          { name: 'WLED_16.0.1_ESP32.bin', downloadUrl: 'https://example.com/plain.bin' },
          { name: 'WLED_16.0.1_ESP32_WROVER.bin', downloadUrl: 'https://example.com/wrover.bin' }
        ],
        recommendedAssetName: 'WLED_16.0.1_ESP32.bin',
        detectedArch: 'esp32'
      })
    }));
    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText('Pick Firmware Asset')).toBeTruthy());

    fireEvent.click(screen.getByText('Pick Firmware Asset'));
    const options = screen.getAllByRole('button', { name: /WLED_16\.0\.1/ });
    // Recommended option sorted first, marked, and visually primary.
    expect(options[0].textContent).toMatch(/WLED_16\.0\.1_ESP32\.bin \(recommended\)/);
    expect(options[0].className).toMatch(/btn-primary/);
    expect(options[1].className).toMatch(/btn-secondary/);
    expect(options[2].className).toMatch(/btn-secondary/);
  });

  it('shows both Update Firmware and Pick Firmware Asset once pinned with an update available, wiring Update Firmware to pushFirmwareUpdate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        isPrerelease: false,
        pinnedAssetPattern: 'ESP02', candidateAssets: [{ name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText('Update Firmware')).toBeTruthy());
    expect(screen.getByText('Pick Firmware Asset')).toBeTruthy();
    // No more clutter once pinned.
    expect(screen.queryByText(/One-time setup/)).toBeNull();

    const updateFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, installedVersion: '0.15.0' })
    });
    vi.stubGlobal('fetch', updateFetch);

    fireEvent.click(screen.getByText('Update Firmware'));

    await waitFor(() =>
      expect(updateFetch).toHaveBeenCalledWith(
        '/api/controllers/c1/firmware/update',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });

  it('shows only Pick Firmware Asset (no Update Firmware) once pinned with no update available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false,
        isPrerelease: false,
        pinnedAssetPattern: 'ESP02',
        candidateAssets: [
          { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/a.bin' },
          { name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText('Pick Firmware Asset')).toBeTruthy());
    expect(screen.queryByText('Update Firmware')).toBeNull();
    expect(screen.queryByText(/Available:/)).toBeNull();
  });

  it('re-pins to a new asset via Pick Firmware Asset', async () => {
    // A single stateful mock server: GET reflects whatever was last pinned,
    // POST /pin updates that state, so the component's own post-pin refresh()
    // call (not a second act from the test) is what drives the re-render.
    let pinnedAssetPattern = 'ESP02';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/controllers/c1/firmware/pin' && init?.method === 'POST') {
        pinnedAssetPattern = JSON.parse(init.body as string).assetPattern;
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url === '/api/controllers/c1/firmware') {
        return {
          ok: true,
          json: async () => ({
            installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false,
            isPrerelease: false,
            pinnedAssetPattern,
            candidateAssets: [
              { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/a.bin' },
              { name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }
            ]
          })
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText('Pick Firmware Asset')).toBeTruthy());

    fireEvent.click(screen.getByText('Pick Firmware Asset'));
    expect(screen.getByText(/Currently pinned to "ESP02"/)).toBeTruthy();

    fireEvent.click(screen.getByText('WLED_0.15.0_ESP8266.bin'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/controllers/c1/firmware/pin',
        expect.objectContaining({ method: 'POST' })
      )
    );
    const pinCall = fetchMock.mock.calls.find(([u]) => u === '/api/controllers/c1/firmware/pin')!;
    expect(JSON.parse((pinCall[1] as RequestInit).body as string)).toEqual({ assetPattern: 'ESP8266' });
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
