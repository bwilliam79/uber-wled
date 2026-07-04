import { describe, it, expect } from 'vitest';
import { chipArchTokens, candidateAssets, resolvePinnedAsset } from '../../src/firmware/assetMatch.js';
import type { WledRelease } from '../../src/firmware/githubClient.js';

const release: WledRelease = {
  tag: 'v0.15.0',
  publishedAt: '2026-06-01T00:00:00Z',
  fetchedAt: '2026-07-04T00:00:00Z',
  assets: [
    { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/ESP8266.bin' },
    { name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/ESP02.bin' },
    { name: 'WLED_0.15.0_ESP32.bin', downloadUrl: 'https://example.com/ESP32.bin' },
    { name: 'WLED_0.15.0_ESP32-S3.bin', downloadUrl: 'https://example.com/ESP32-S3.bin' },
    { name: 'WLED_0.15.0_ESP32-C3.bin', downloadUrl: 'https://example.com/ESP32-C3.bin' }
  ]
};

describe('chipArchTokens', () => {
  it('maps esp8266 to its known filename tokens', () => {
    expect(chipArchTokens('esp8266')).toEqual(['ESP8266', 'ESP01', 'ESP02']);
  });

  it('maps plain esp32 to the generic ESP32 token', () => {
    expect(chipArchTokens('esp32')).toEqual(['ESP32']);
  });

  it('narrows to the specific variant token for esp32s3', () => {
    expect(chipArchTokens('esp32s3')).toEqual(['ESP32-S3']);
  });

  it('narrows to the specific variant token for esp32c3', () => {
    expect(chipArchTokens('esp32c3')).toEqual(['ESP32-C3']);
  });
});

describe('candidateAssets', () => {
  it('returns multiple candidates for esp8266 (ambiguous flash-size variants)', () => {
    const candidates = candidateAssets(release, 'esp8266');
    expect(candidates.map((a) => a.name)).toEqual([
      'WLED_0.15.0_ESP8266.bin',
      'WLED_0.15.0_ESP02.bin'
    ]);
  });

  it('narrows to only the matching variant for esp32s3', () => {
    const candidates = candidateAssets(release, 'esp32s3');
    expect(candidates.map((a) => a.name)).toEqual(['WLED_0.15.0_ESP32-S3.bin']);
  });
});

describe('resolvePinnedAsset', () => {
  it('resolves the asset matching a pinned pattern', () => {
    const asset = resolvePinnedAsset(release, 'ESP02');
    expect(asset?.name).toBe('WLED_0.15.0_ESP02.bin');
  });

  it('returns undefined when the pin no longer matches any asset in the release', () => {
    const asset = resolvePinnedAsset(release, 'ESP01');
    expect(asset).toBeUndefined();
  });
});
