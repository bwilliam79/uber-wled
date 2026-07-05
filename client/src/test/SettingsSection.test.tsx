import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { SettingsSection } from '../sections/settings/SettingsSection';

afterEach(() => vi.unstubAllGlobals());

const initial = {
  includePrereleaseFirmware: false, homeLatitude: null, homeLongitude: null,
  discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false,
  controllerStatusPollIntervalMinutes: 5, livePollIntervalSeconds: 2
};

function stub(patchResponse: (body: Record<string, unknown>) => unknown = (b) => ({ ...initial, ...b })) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/settings' && method === 'PATCH') {
      const body = JSON.parse(init!.body as string);
      return Promise.resolve({ ok: true, json: async () => patchResponse(body) });
    }
    if (url === '/api/settings') {
      return Promise.resolve({ ok: true, json: async () => initial });
    }
    if (url.endsWith('/rescan')) {
      return Promise.resolve({ ok: true, json: async () => ({ controllers: [{ id: 'c1' }, { id: 'c2' }] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SettingsSection v2', () => {
  it('round-trips the live poll interval: loads 2, saves the edited value in the PATCH body', async () => {
    const fetchMock = stub();
    renderWithQuery(<SettingsSection />);
    const field = (await screen.findByLabelText('Live poll interval (seconds)')) as HTMLInputElement;
    expect(field.value).toBe('2');
    fireEvent.change(field, { target: { value: '7' } });
    fireEvent.click(screen.getByText('Save settings'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PATCH' }))
    );
    const patch = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string).livePollIntervalSeconds).toBe(7);
    // saved value reflected back into the field
    await waitFor(() =>
      expect((screen.getByLabelText('Live poll interval (seconds)') as HTMLInputElement).value).toBe('7')
    );
  });

  it('clamps the live poll interval to 1–30 on save', async () => {
    const fetchMock = stub();
    renderWithQuery(<SettingsSection />);
    const field = await screen.findByLabelText('Live poll interval (seconds)');
    fireEvent.change(field, { target: { value: '45' } });
    fireEvent.click(screen.getByText('Save settings'));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'PATCH')).toBe(true)
    );
    const patch = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string).livePollIntervalSeconds).toBe(30);
  });

  it('surfaces an error instead of hanging on Loading when the initial load fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    renderWithQuery(<SettingsSection />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('runs a re-scan and reports the result', async () => {
    stub();
    renderWithQuery(<SettingsSection />);
    fireEvent.click(await screen.findByText('Re-scan now'));
    await waitFor(() => expect(screen.getByText(/Re-scan complete — 2 controller/i)).toBeTruthy());
  });
});
