import { describe, it, expect } from 'vitest';
import { chipArchTokens, candidateAssets, recommendedAssetName, resolvePinnedAsset } from '../../src/firmware/assetMatch.js';
import type { WledRelease, ReleaseAsset } from '../../src/firmware/githubClient.js';

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

  it('excludes S2/S3/C3 variant assets for plain esp32 so a plain board never gets a variant binary', () => {
    const releaseWithAllVariants: WledRelease = {
      tag: 'v0.15.0',
      publishedAt: '2026-06-01T00:00:00Z',
      fetchedAt: '2026-07-04T00:00:00Z',
      assets: [
        { name: 'WLED_0.15.0_ESP32.bin', downloadUrl: 'https://example.com/ESP32.bin' },
        { name: 'WLED_0.15.0_ESP32-S2.bin', downloadUrl: 'https://example.com/ESP32-S2.bin' },
        { name: 'WLED_0.15.0_ESP32-S3.bin', downloadUrl: 'https://example.com/ESP32-S3.bin' },
        { name: 'WLED_0.15.0_ESP32-C3.bin', downloadUrl: 'https://example.com/ESP32-C3.bin' },
        { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/ESP8266.bin' }
      ]
    };

    const candidates = candidateAssets(releaseWithAllVariants, 'esp32');
    expect(candidates.map((a) => a.name)).toEqual(['WLED_0.15.0_ESP32.bin']);
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

  it('resolves a plain "ESP32" pin to the plain asset, never a variant whose name happens to start with it', () => {
    // Regression: a real device pinned to "ESP32" got flashed with
    // "WLED_16.0.1_ESP32-C3-QIO.bin" instead — an entirely different chip —
    // because "ESP32-C3-QIO".includes("ESP32") is true and GitHub's asset
    // list sorts the dashed variant before the plain filename
    // alphabetically ('-' sorts before '.'), so .find()'s substring check
    // hit it first. WLED's own release-name compatibility check is what
    // actually caught this in production before any flash happened.
    const releaseWithC3Variant: WledRelease = {
      tag: 'v16.0.1',
      publishedAt: '2026-06-01T00:00:00Z',
      fetchedAt: '2026-07-04T00:00:00Z',
      assets: [
        // Deliberately ordered as GitHub's real API returns them: the dashed
        // C3 variant alphabetically precedes the plain filename.
        { name: 'WLED_16.0.1_ESP32-C3-QIO.bin', downloadUrl: 'https://example.com/c3.bin' },
        { name: 'WLED_16.0.1_ESP32.bin', downloadUrl: 'https://example.com/plain.bin' }
      ]
    };

    const asset = resolvePinnedAsset(releaseWithC3Variant, 'ESP32');
    expect(asset?.name).toBe('WLED_16.0.1_ESP32.bin');
  });
});

describe('recommendedAssetName', () => {
  it('recommends the plain build over specialized-hardware variants for a plain esp32 board', () => {
    const releaseWithVariants: WledRelease = {
      tag: 'v16.0.1',
      publishedAt: '2026-06-01T00:00:00Z',
      fetchedAt: '2026-07-04T00:00:00Z',
      assets: [
        { name: 'WLED_16.0.1_ESP32.bin', downloadUrl: 'https://example.com/ESP32.bin' },
        { name: 'WLED_16.0.1_ESP32_DEBUG.bin', downloadUrl: 'https://example.com/ESP32_DEBUG.bin' },
        { name: 'WLED_16.0.1_ESP32_Ethernet.bin', downloadUrl: 'https://example.com/ESP32_Ethernet.bin' },
        { name: 'WLED_16.0.1_ESP32_HUB75.bin', downloadUrl: 'https://example.com/ESP32_HUB75.bin' },
        { name: 'WLED_16.0.1_ESP32_WROVER.bin', downloadUrl: 'https://example.com/ESP32_WROVER.bin' }
      ]
    };
    const candidates = candidateAssets(releaseWithVariants, 'esp32');
    expect(recommendedAssetName(candidates, 'esp32')).toBe('WLED_16.0.1_ESP32.bin');
  });

  it('returns null for esp8266, which resolves to multiple genuinely different flash-size tokens, not one plain build plus add-ons', () => {
    const candidates = candidateAssets(release, 'esp8266');
    expect(recommendedAssetName(candidates, 'esp8266')).toBeNull();
  });

  it('returns null when no candidate matches the primary token exactly (e.g. only specialized variants present)', () => {
    const onlySpecialized: ReleaseAsset[] = [
      { name: 'WLED_16.0.1_ESP32_HUB75.bin', downloadUrl: 'https://example.com/ESP32_HUB75.bin' }
    ];
    expect(recommendedAssetName(onlySpecialized, 'esp32')).toBeNull();
  });
});
