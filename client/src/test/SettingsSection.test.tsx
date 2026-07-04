import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsSection } from '../components/SettingsSection';

afterEach(() => vi.unstubAllGlobals());

const initial = {
  includePrereleaseFirmware: false, homeLatitude: null, homeLongitude: null,
  discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false
};

describe('SettingsSection', () => {
  it('reads current settings and PATCHes the toggled value in the request body', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') return Promise.resolve({ ok: true, json: async () => ({ ...initial, includePrereleaseFirmware: true }) });
      return Promise.resolve({ ok: true, json: async () => initial });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsSection />);
    const toggle = await screen.findByLabelText(/pre-release firmware/i);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PATCH' })));
    // Verify the toggled value is actually sent, not just that a PATCH happened.
    const patchCall = fetchMock.mock.calls.find(([, init]) => (init?.method ?? 'GET') === 'PATCH');
    expect(JSON.parse(patchCall[1].body).includePrereleaseFirmware).toBe(true);
  });

  it('surfaces an error instead of hanging on "Loading…" when the initial load fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(<SettingsSection />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('runs a re-scan and reports the result', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/rescan')) {
        return Promise.resolve({ ok: true, json: async () => ({ controllers: [{ id: 'c1' }, { id: 'c2' }] }) });
      }
      return Promise.resolve({ ok: true, json: async () => initial });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsSection />);
    fireEvent.click(await screen.findByText('Re-scan now'));

    await waitFor(() => expect(screen.getByText(/Re-scan complete — 2 controller/i)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/rescan', expect.objectContaining({ method: 'POST' }));
  });

  it('shows an inline error and keeps the prior value when the write fails', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') return Promise.resolve({ ok: false, json: async () => ({}) });
      return Promise.resolve({ ok: true, json: async () => initial });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsSection />);
    const interval = await screen.findByLabelText(/re-scan interval/i);
    fireEvent.change(interval, { target: { value: '10' } });
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((screen.getByLabelText(/re-scan interval/i) as HTMLInputElement).value).toBe('10');
  });
});
