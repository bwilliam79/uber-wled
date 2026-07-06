import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './renderWithQuery';
import { SettingsSection } from '../sections/settings/SettingsSection';

afterEach(() => {
  vi.unstubAllGlobals();
  clearGeolocationStub();
});

const initial = {
  includePrereleaseFirmware: false, homeLatitude: null, homeLongitude: null,
  discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false,
  controllerStatusPollIntervalMinutes: 5, livePollIntervalSeconds: 2
};

function stub(
  patchResponse: (body: Record<string, unknown>) => unknown = (b) => ({ ...initial, ...b }),
  geocodeResults: Array<{ displayName: string; latitude: number; longitude: number }> | null = null
) {
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
    if (url.startsWith('/api/settings/geocode')) {
      return Promise.resolve({ ok: true, json: async () => ({ results: geocodeResults ?? [] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Installs a stub `navigator.geolocation.getCurrentPosition` and returns the
 *  underlying mock so each test can drive it via mockImplementation. */
function stubGeolocation() {
  const getCurrentPosition = vi.fn();
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
    writable: true
  });
  return getCurrentPosition;
}

function clearGeolocationStub() {
  Object.defineProperty(navigator, 'geolocation', {
    value: undefined,
    configurable: true,
    writable: true
  });
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

  describe('"Use my current location" (browser Geolocation API)', () => {
    it('populates latitude/longitude from a successful getCurrentPosition call', async () => {
      stub();
      const getCurrentPosition = stubGeolocation();
      getCurrentPosition.mockImplementation((success: PositionCallback) => {
        success({
          coords: { latitude: 47.60621, longitude: -122.33207 }
        } as GeolocationPosition);
      });

      renderWithQuery(<SettingsSection />);
      fireEvent.click(await screen.findByText('Use my current location'));

      await waitFor(() =>
        expect((screen.getByLabelText('Home latitude') as HTMLInputElement).value).toBe('47.60621')
      );
      expect((screen.getByLabelText('Home longitude') as HTMLInputElement).value).toBe('-122.33207');
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it('shows a clear inline message when the browser has no geolocation support', async () => {
      stub();
      clearGeolocationStub();

      renderWithQuery(<SettingsSection />);
      fireEvent.click(await screen.findByText('Use my current location'));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/doesn't support/i));
    });

    it('explains the HTTPS/localhost requirement — without ever calling getCurrentPosition — when the page is an insecure context', async () => {
      stub();
      const getCurrentPosition = stubGeolocation();
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

      renderWithQuery(<SettingsSection />);
      fireEvent.click(await screen.findByText('Use my current location'));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTPS or localhost/i));
      expect(getCurrentPosition).not.toHaveBeenCalled();

      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });

    it('surfaces a clear message when the user denies the permission prompt', async () => {
      stub();
      const getCurrentPosition = stubGeolocation();
      getCurrentPosition.mockImplementation((_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      });

      renderWithQuery(<SettingsSection />);
      fireEvent.click(await screen.findByText('Use my current location'));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/permission was denied/i));
    });

    it('surfaces a clear message on timeout', async () => {
      stub();
      const getCurrentPosition = stubGeolocation();
      getCurrentPosition.mockImplementation((_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      });

      renderWithQuery(<SettingsSection />);
      fireEvent.click(await screen.findByText('Use my current location'));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/timed out/i));
    });
  });

  describe('"Look up an address" (server-proxied Nominatim geocoding)', () => {
    it('auto-applies the single match to the latitude/longitude fields', async () => {
      stub(undefined, [{ displayName: '1 Main St, Anytown, USA', latitude: 40.1234, longitude: -75.5678 }]);
      renderWithQuery(<SettingsSection />);

      fireEvent.change(await screen.findByLabelText('Look up an address'), { target: { value: '1 Main St' } });
      fireEvent.click(screen.getByText('Find'));

      await waitFor(() =>
        expect((screen.getByLabelText('Home latitude') as HTMLInputElement).value).toBe('40.1234')
      );
      expect((screen.getByLabelText('Home longitude') as HTMLInputElement).value).toBe('-75.5678');
    });

    it('lets the user pick among multiple ambiguous matches before applying', async () => {
      stub(undefined, [
        { displayName: '1 Main St, Springfield, IL, USA', latitude: 39.8, longitude: -89.6 },
        { displayName: '1 Main St, Springfield, MA, USA', latitude: 42.1, longitude: -72.5 }
      ]);
      renderWithQuery(<SettingsSection />);

      fireEvent.change(await screen.findByLabelText('Look up an address'), { target: { value: 'Main St' } });
      fireEvent.click(screen.getByText('Find'));

      const candidate = await screen.findByText('1 Main St, Springfield, MA, USA');
      // Not applied yet — user has to choose.
      expect((screen.getByLabelText('Home latitude') as HTMLInputElement).value).toBe('');

      fireEvent.click(candidate);
      await waitFor(() =>
        expect((screen.getByLabelText('Home latitude') as HTMLInputElement).value).toBe('42.1')
      );
      expect((screen.getByLabelText('Home longitude') as HTMLInputElement).value).toBe('-72.5');
      expect(screen.queryByText('1 Main St, Springfield, IL, USA')).toBeNull();
    });

    it('shows a clear message when there are no matches', async () => {
      stub(undefined, []);
      renderWithQuery(<SettingsSection />);

      fireEvent.change(await screen.findByLabelText('Look up an address'), { target: { value: 'nowhere at all' } });
      fireEvent.click(screen.getByText('Find'));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no matches found/i));
    });

    it('shows a clear message when the geocode request fails', async () => {
      const fetchMock = vi.fn((url: string) => {
        if (url === '/api/settings') return Promise.resolve({ ok: true, json: async () => initial });
        if (url.startsWith('/api/settings/geocode')) return Promise.reject(new Error('network down'));
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithQuery(<SettingsSection />);
      fireEvent.change(await screen.findByLabelText('Look up an address'), { target: { value: '1 Main St' } });
      fireEvent.click(screen.getByText('Find'));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/network down/i));
    });
  });
});
