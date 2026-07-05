import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { DevicePresetsTab } from '../../sections/devices/DevicePresetsTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { DEVICE_PRESETS } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function renderTab(routes: Record<string, unknown> = {}) {
  const fn = stubFetchRoutes({
    'GET /api/controllers/c1/presets': { presets: DEVICE_PRESETS },
    ...routes
  });
  const utils = renderDevices(<DevicePresetsTab controllerId="c1" />);
  return { fn, ...utils };
}

describe('DevicePresetsTab', () => {
  it('lists device presets with ids and a playlist badge', async () => {
    renderTab();
    expect(await screen.findByText('Warm evening')).toBeTruthy();
    const partyRow = screen.getByText('Party loop').closest('li')!;
    expect(partyRow.textContent).toContain('Playlist');
  });

  it('applies a preset through the v2 fan-out with a { ps } patch', async () => {
    const { fn } = renderTab({
      'POST /api/control/apply': { results: [{ controllerId: 'c1', wledSegId: null, ok: true }] }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply preset Warm evening' }));
    await screen.findByText('Applied “Warm evening”');
    const call = fn.mock.calls.find(([url]) => String(url) === '/api/control/apply');
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      targets: [{ kind: 'controller', controllerId: 'c1' }],
      patch: { ps: 1 }
    });
  });

  it('surfaces a per-target apply failure as an error toast', async () => {
    renderTab({
      'POST /api/control/apply': {
        results: [{ controllerId: 'c1', wledSegId: null, ok: false, error: 'unreachable' }]
      }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply preset Warm evening' }));
    expect(await screen.findByText('Could not apply “Warm evening”')).toBeTruthy();
  });

  it('deletes a preset only after modal confirmation', async () => {
    const { fn } = renderTab({ 'DELETE /api/controllers/c1/presets/2': {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete preset Party loop' }));
    await screen.findByText(/Delete “Party loop” \(id 2\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/presets/2', expect.objectContaining({ method: 'DELETE' })));
  });

  it('saves the current state with the two flags', async () => {
    const { fn } = renderTab({ 'POST /api/controllers/c1/presets': { id: 3, name: 'Evening warm' } });
    await screen.findByText('Warm evening');
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Evening warm' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Save segment bounds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    await screen.findByText('Saved preset 3: Evening warm');
    const call = fn.mock.calls.find(
      ([url, init]) => String(url) === '/api/controllers/c1/presets' && (init as RequestInit | undefined)?.method === 'POST'
    );
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      name: 'Evening warm', includeBrightness: true, saveSegmentBounds: true
    });
  });

  it('disables Save preset while the name is empty', async () => {
    renderTab();
    await screen.findByText('Warm evening');
    expect((screen.getByRole('button', { name: 'Save preset' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
