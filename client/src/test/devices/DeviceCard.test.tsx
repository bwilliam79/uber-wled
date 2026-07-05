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
  });

  it('a stale controller without live data shows the Stale chip', () => {
    stubFetchRoutes({ 'GET /api/controllers/c2/firmware': NO_UPDATE });
    renderDevices(<DeviceCard controller={CONTROLLERS[1]} live={undefined}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Stale')).toBeTruthy();
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
});
