import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { UpdateTab } from '../../sections/devices/UpdateTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { FIRMWARE_OK } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('UpdateTab', () => {
  it('renders the reused firmware status with installed/available versions and hardware', async () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': FIRMWARE_OK });
    renderDevices(<UpdateTab controllerId="c1" />);
    expect(await screen.findByText('Installed: 16.0.0')).toBeTruthy();
    expect(screen.getByText('Available: v16.1.0')).toBeTruthy();
    expect(screen.getByText('Hardware: esp32')).toBeTruthy();
  });

  it('offers the asset picker when the chip family is ambiguous', async () => {
    stubFetchRoutes({
      'GET /api/controllers/c1/firmware': {
        ...FIRMWARE_OK,
        pinnedAssetPattern: null,
        candidateAssets: [
          { name: 'WLED_16.1.0_ESP32.bin', downloadUrl: 'https://example/a' },
          { name: 'WLED_16.1.0_ESP32_audioreactive.bin', downloadUrl: 'https://example/b' }
        ]
      }
    });
    renderDevices(<UpdateTab controllerId="c1" />);
    expect(await screen.findByRole('button', { name: 'Pick Firmware Asset' })).toBeTruthy();
    expect(await screen.findByText('One-time setup: pick the firmware asset for this device.')).toBeTruthy();
  });

  it('shows only Update Firmware once pinned, with the hardware line as the re-pick affordance instead of a separate button', async () => {
    stubFetchRoutes({
      'GET /api/controllers/c1/firmware': {
        ...FIRMWARE_OK,
        pinnedAssetPattern: 'ESP32',
        candidateAssets: [
          { name: 'WLED_16.1.0_ESP32.bin', downloadUrl: 'https://example/a' },
          { name: 'WLED_16.1.0_ESP32_audioreactive.bin', downloadUrl: 'https://example/b' }
        ]
      }
    });
    renderDevices(<UpdateTab controllerId="c1" />);
    expect(await screen.findByRole('button', { name: 'Update Firmware' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pick Firmware Asset' })).toBeNull();
    expect(screen.getByRole('button', { name: /Hardware: esp32/ })).toBeTruthy();
    expect(screen.queryByText(/One-time setup/)).toBeNull();
  });
});
