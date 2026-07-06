import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { UpdateTab } from '../../sections/devices/UpdateTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { FIRMWARE_OK } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('UpdateTab', () => {
  it('renders the reused firmware status with installed version and update badge', async () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': FIRMWARE_OK });
    renderDevices(<UpdateTab controllerId="c1" />);
    expect(await screen.findByText('Installed: 16.0.0')).toBeTruthy();
    expect(screen.getByText(/Update available \(v16\.1\.0\)/)).toBeTruthy();
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
    expect(await screen.findByRole('button', { name: 'Pick firmware asset' })).toBeTruthy();
  });

  it('shows the pinned board type and an "Override firmware asset" button when already pinned, even with candidates present', async () => {
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
    expect(await screen.findByText('Board type: ESP32')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Override firmware asset' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pick firmware asset' })).toBeNull();
  });
});
