import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppShell } from '../components/AppShell';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { window.location.hash = ''; });

describe('AppShell', () => {
  it('opens on the Home section by default and lists all eight sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Home/ }).className).toContain('active'));
    for (const name of ['Home', 'Layout', 'Controllers', 'Groups', 'Themes', 'Schedule', 'Firmware', 'Settings']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('switches to the Themes section when its nav item is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: /Themes/ }));
    await waitFor(() => expect(screen.getByText(/No custom themes yet/)).toBeTruthy());
  });

  it('shows a badge on the Firmware nav item when any controller has an update available', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url === '/api/controllers') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }]
        });
      }
      if (typeof url === 'string' && url.endsWith('/firmware')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
            isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: []
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppShell />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Firmware/ }).querySelector('.sidebar-link-badge')).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: /Layout/ }).querySelector('.sidebar-link-badge')).toBeNull();
  });
});
