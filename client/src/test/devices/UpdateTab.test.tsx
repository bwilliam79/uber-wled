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

  it('shows Update Firmware and Pick Firmware Asset when already pinned, even with candidates present', async () => {
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
    expect(await screen.findByRole('button', { name: 'Pick Firmware Asset' })).toBeTruthy();
    expect(screen.queryByText(/One-time setup/)).toBeNull();
  });
});
