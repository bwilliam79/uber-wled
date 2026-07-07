import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DeviceCard } from '../../sections/devices/DeviceCard';
import { renderDevices, stubFetchRoutes } from './helpers';
import { CONTROLLERS, FIRMWARE_OK, liveEntry } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

const NO_UPDATE = { ...FIRMWARE_OK, updateAvailable: false };

describe('DeviceCard', () => {
  it('shows name, host, version chip and the live metrics', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Cabinet Lights')).toBeTruthy();
    expect(screen.getByText('192.168.1.86')).toBeTruthy();
    expect(screen.getByText('v16.0.0')).toBeTruthy();
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('42 FPS')).toBeTruthy();
    expect(screen.getByText('Up 32d 7h')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'WiFi signal 4 of 4 bars' })).toBeTruthy();
    const strip = screen.getByRole('img', { name: 'Live output' });
    // fixtures.SEGMENTS has 2 segments, both on — no real WS server in this
    // test environment, so no live-pixel frame ever arrives and both show
    // the loading placeholder rather than their configured color.
    expect(screen.getByTestId('live-swatch-c:0').style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(screen.getByTestId('live-swatch-c:1').style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(strip.children).toHaveLength(2);
  });

  it('shows the update badge from the firmware query', async () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': FIRMWARE_OK });
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(await screen.findByText('Update available')).toBeTruthy();
  });

  it('an unreachable live entry renders Offline and hides the power chip', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    renderDevices(<DeviceCard controller={CONTROLLERS[0]}
      live={{ reachable: false }} onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('On')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
    expect(screen.getByTestId('live-swatch-c:unreachable').className).toContain('ui-live-swatch-unreachable');
  });

  it('a stale controller without live data shows the Stale chip and a pending swatch', () => {
    stubFetchRoutes({ 'GET /api/controllers/c2/firmware': NO_UPDATE });
    renderDevices(<DeviceCard controller={CONTROLLERS[1]} live={undefined}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByTestId('live-swatch-c:pending').className).toContain('ui-live-swatch-pending');
  });

  it('the Control button reports the controller id', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    const onControl = vi.fn();
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={onControl} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control Cabinet Lights' }));
    expect(onControl).toHaveBeenCalledWith('c1');
  });

  it('the name opens the detail page', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    const onOpen = vi.fn();
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={vi.fn()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Cabinet Lights' }));
    expect(onOpen).toHaveBeenCalledWith('c1');
  });

  it('prefers the live device-reported name over the stored (often mDNS-derived) controller name', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    const mdnsNamedController = { ...CONTROLLERS[0], name: 'cabinet-lights' };
    renderDevices(<DeviceCard controller={mdnsNamedController}
      live={liveEntry({ info: { name: 'Cabinet Lights', ver: '16.0.0', leds: { count: 48, rgbw: true, cct: 0, seglc: [1, 1] } } })}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Cabinet Lights')).toBeTruthy();
    expect(screen.queryByText('cabinet-lights')).toBeNull();
  });

  it('falls back to the stored controller name when there is no live info yet', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    const mdnsNamedController = { ...CONTROLLERS[0], name: 'cabinet-lights' };
    renderDevices(<DeviceCard controller={mdnsNamedController} live={undefined}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('cabinet-lights')).toBeTruthy();
  });
});
