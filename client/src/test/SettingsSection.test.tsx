import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsSection } from '../components/SettingsSection';

afterEach(() => vi.unstubAllGlobals());

const initial = {
  includePrereleaseFirmware: false, homeLatitude: null, homeLongitude: null,
  discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false
};

describe('SettingsSection', () => {
  it('reads current settings and PATCHes a toggle change', async () => {
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
