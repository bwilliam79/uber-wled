import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { InfoTab } from '../../sections/devices/InfoTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { CONTROLLERS, liveEntry } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function renderTab(routes: Record<string, unknown> = {}, onRemoved = vi.fn()) {
  const fn = stubFetchRoutes(routes);
  renderDevices(<InfoTab controller={CONTROLLERS[0]} live={liveEntry()} onRemoved={onRemoved} />);
  return { fn, onRemoved };
}

describe('InfoTab', () => {
  it('renders the probed facts grid', () => {
    renderTab();
    expect(screen.getByText('32d 7h')).toBeTruthy(); // uptime 2791487 s
    expect(screen.getByText('98% (4/4 bars), channel 6')).toBeTruthy();
    expect(screen.getByText('118 KiB')).toBeTruthy(); // freeheap 120876
    expect(screen.getByText('28 / 983 KiB')).toBeTruthy();
    expect(screen.getByText('48 RGBW')).toBeTruthy();
    expect(screen.getByText('AudioReactive')).toBeTruthy();
  });

  it('shows the live-output strip immediately, with no opt-in required', () => {
    renderTab();
    const strip = screen.getByRole('img', { name: 'Live output' });
    // fixtures.SEGMENTS: seg0 [255,160,60] bri255 -> unscaled; seg1 [0,80,255] bri200.
    expect(screen.getByTestId('live-swatch-c:0').style.backgroundColor).toBe('rgb(255, 160, 60)');
    expect(screen.getByTestId('live-swatch-c:1').style.backgroundColor).toBe('rgb(0, 63, 200)');
    expect(strip.children).toHaveLength(2);
  });

  it('mounts the native liveview peek iframe only after the user opts in', () => {
    renderTab();
    expect(screen.queryByTitle('Live output of Cabinet Lights')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open native live view' }));
    const frame = screen.getByTitle('Live output of Cabinet Lights') as HTMLIFrameElement;
    expect(frame.src).toBe('http://192.168.1.86/liveview');
  });

  it('links to the native UI in a new tab', () => {
    renderTab();
    const link = screen.getByRole('link', { name: 'Open native UI' }) as HTMLAnchorElement;
    expect(link.href).toBe('http://192.168.1.86/');
    expect(link.target).toBe('_blank');
  });

  it('reboots only after modal confirmation', async () => {
    const { fn } = renderTab({ 'POST /api/controllers/c1/reboot': { ok: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
    await screen.findByText(/Reboot “Cabinet Lights”\?/);
    expect(fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reboot' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/reboot', expect.objectContaining({ method: 'POST' })));
  });

  it('removes the controller after confirmation and calls onRemoved', async () => {
    const { fn, onRemoved } = renderTab({ 'DELETE /api/controllers/c1': {} });
    fireEvent.click(screen.getByRole('button', { name: 'Remove controller' }));
    await screen.findByText(/Remove “Cabinet Lights” from uber-wled\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('imports device schedules and toasts the result', async () => {
    const { fn } = renderTab({
      'POST /api/controllers/c1/import-schedules': { imported: [{}, {}], skipped: [] }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import schedules' }));
    await screen.findByText('Schedules imported');
    expect(JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string))
      .toEqual({ disableOnDevice: false });
  });
});
