import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell, sectionFromHash } from '../components/AppShell';
import { ToastProvider } from '../components/ui/Toast';
import { ThemeProvider } from '../theme/ThemeProvider';

const SECTION_NAMES = ['Home', 'Devices', 'Themes', 'Schedule', 'Sync', 'Firmware', 'Settings'];

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function stubFetchEmpty() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { window.location.hash = ''; });

describe('AppShell v2', () => {
  it('opens on Home and lists the sections in the sidebar (no Groups, no Layout)', async () => {
    stubFetchEmpty();
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    await waitFor(() =>
      expect(within(sidebar).getByRole('button', { name: /Home/ }).className).toContain('active')
    );
    for (const name of SECTION_NAMES) {
      expect(within(sidebar).getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
    expect(within(sidebar).queryByRole('button', { name: /Groups/ })).toBeNull();
    expect(within(sidebar).queryByRole('button', { name: /Controllers/ })).toBeNull();
    // Layout is hidden from the nav for now (component/route kept in code).
    expect(within(sidebar).queryByRole('button', { name: /Layout/ })).toBeNull();
    expect(within(sidebar).getByText(/^v\d+\.\d+\.\d+$/)).toBeTruthy();
  });

  it('renders a bottom navigation with the same sections (no Layout)', () => {
    stubFetchEmpty();
    renderShell();
    const bottom = screen.getByRole('navigation', { name: 'Bottom navigation' });
    for (const name of SECTION_NAMES) {
      expect(within(bottom).getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
    expect(within(bottom).queryByRole('button', { name: /Layout/ })).toBeNull();
  });

  it('renders the Sync section', async () => {
    stubFetchEmpty();
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /Sync/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sync' })).toBeTruthy());
    expect(window.location.hash).toBe('#/sync');
  });

  it('renders the Devices section', async () => {
    stubFetchEmpty();
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /Devices/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Devices' })).toBeTruthy());
    expect(window.location.hash).toBe('#/devices');
  });

  it('maps the legacy #/controllers hash to Devices', async () => {
    window.location.hash = '#/controllers';
    stubFetchEmpty();
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    await waitFor(() =>
      expect(within(sidebar).getByRole('button', { name: /Devices/ }).className).toContain('active')
    );
  });

  it('switches to the Themes section when its nav item is clicked', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url === '/api/themes/effects-palettes') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ effects: [], palettes: [], sourceControllerId: null, sourceControllerName: null })
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /Themes/ }));
    await waitFor(() => expect(screen.getByText(/No custom themes yet/)).toBeTruthy());
  });

  it('shows an "update available" link to the repo in the sidebar when a newer uber-wled release exists upstream', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url === '/api/app-update') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            currentVersion: '1.7.0',
            latestVersion: '1.8.0',
            updateAvailable: true,
            repoUrl: 'https://github.com/bwilliam79/uber-wled'
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    const link = await within(sidebar).findByRole('link', { name: /update available/i });
    expect(link.getAttribute('href')).toBe('https://github.com/bwilliam79/uber-wled');
    expect(link.getAttribute('title')).toMatch(/1\.8\.0/);
  });

  it('shows the plain version with no update link when the app is up to date', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url === '/api/app-update') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            currentVersion: '1.7.0', latestVersion: '1.7.0', updateAvailable: false,
            repoUrl: 'https://github.com/bwilliam79/uber-wled'
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    await waitFor(() => expect(within(sidebar).getByText(/^v\d+\.\d+\.\d+$/)).toBeTruthy());
    expect(within(sidebar).queryByRole('link', { name: /update available/i })).toBeNull();
  });

  it('shows a firmware badge in both navs when any controller has an update available', async () => {
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
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    const bottom = screen.getByRole('navigation', { name: 'Bottom navigation' });
    await waitFor(() =>
      expect(within(sidebar).getByRole('button', { name: /Firmware/ }).querySelector('.sidebar-link-badge')).toBeTruthy()
    );
    expect(within(bottom).getByRole('button', { name: /Firmware/ }).querySelector('.sidebar-link-badge')).toBeTruthy();
    expect(within(sidebar).getByRole('button', { name: /Themes/ }).querySelector('.sidebar-link-badge')).toBeNull();
  });
});

describe('sectionFromHash deep links (Phase F)', () => {
  it('maps #/devices/c1/update to the devices section (Phase H deep link)', () => {
    window.location.hash = '#/devices/c1/update';
    expect(sectionFromHash()).toBe('devices');
  });

  it('still maps the legacy #/controllers alias to devices', () => {
    window.location.hash = '#/controllers';
    expect(sectionFromHash()).toBe('devices');
  });
});
