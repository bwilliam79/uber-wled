import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DevicesSection } from '../../sections/devices/DevicesSection';
import { renderDevices, stubFetchRoutes } from './helpers';
import { CONTROLLERS, FIRMWARE_OK, liveEntry, liveMap } from './fixtures';

vi.mock('../../api/live', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/live')>();
  return {
    ...mod,
    useLiveStatus: vi.fn(() => liveMap({ c1: liveEntry(), c2: { reachable: false } }))
  };
});
vi.mock('../../control/ControlSurface', () => ({
  ControlSurface: (p: { open: boolean; targets: unknown[] }) =>
    p.open ? <div data-testid="control-surface">{JSON.stringify(p.targets)}</div> : null
}));
vi.mock('../../sections/devices/DeviceDetail', () => ({
  DeviceDetail: (p: { controller: { id: string }; tab: string }) => (
    <div data-testid="device-detail">{p.controller.id}:{p.tab}</div>
  )
}));

beforeEach(() => {
  window.location.hash = '#/devices';
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const BASE_ROUTES = {
  'GET /api/controllers': CONTROLLERS,
  'GET /api/controllers/c1/firmware': FIRMWARE_OK,
  'GET /api/controllers/c2/firmware': { ...FIRMWARE_OK, updateAvailable: false }
};

describe('DevicesSection', () => {
  it('renders one card per controller', async () => {
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    expect(await screen.findByText('Cabinet Lights')).toBeTruthy();
    expect(screen.getByText('Porch')).toBeTruthy();
  });

  it('Control opens the shared surface targeting that controller', async () => {
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Control Cabinet Lights' }));
    expect(screen.getByTestId('control-surface').textContent)
      .toContain('"controllerId":"c1"');
  });

  it('a deep-linked hash renders the detail with the requested tab', async () => {
    window.location.hash = '#/devices/c1/segments';
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    expect((await screen.findByTestId('device-detail')).textContent).toBe('c1:segments');
  });

  it('an unknown controller id shows a recovery path back to the list', async () => {
    window.location.hash = '#/devices/nope';
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    expect(await screen.findByText('Unknown device.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to devices' })).toBeTruthy();
  });

  it('renders the empty state when no controllers exist', async () => {
    stubFetchRoutes({ ...BASE_ROUTES, 'GET /api/controllers': [] });
    renderDevices(<DevicesSection />);
    expect(await screen.findByText(/No controllers yet/)).toBeTruthy();
  });
});
