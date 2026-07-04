import type { WledRelease, ReleaseAsset } from './githubClient.js';

export function chipArchTokens(arch: string): string[] {
  const normalized = arch.toLowerCase();

  if (normalized === 'esp8266') return ['ESP8266', 'ESP01', 'ESP02'];
  if (normalized === 'esp32s2') return ['ESP32-S2'];
  if (normalized === 'esp32s3') return ['ESP32-S3'];
  if (normalized === 'esp32c3') return ['ESP32-C3'];
  if (normalized === 'esp32') return ['ESP32'];

  // Unknown arch: fall back to whatever token it reports, uppercased.
  return [arch.toUpperCase()];
}

// Dashed ESP32 variant markers that must NOT match when the controller
// reports the plain 'esp32' arch, since 'ESP32-S3'.includes('ESP32') is true
// and would otherwise let a plain-ESP32 board match S2/S3/C3 firmware.
const ESP32_VARIANT_EXCLUSIONS = ['ESP32-S2', 'ESP32-S3', 'ESP32-C3'];

export function candidateAssets(release: WledRelease, arch: string): ReleaseAsset[] {
  const normalized = arch.toLowerCase();
  const tokens = chipArchTokens(arch);
  const isPlainEsp32 = normalized === 'esp32';

  return release.assets.filter((asset) => {
    const name = asset.name.toUpperCase();
    if (isPlainEsp32 && ESP32_VARIANT_EXCLUSIONS.some((variant) => name.includes(variant))) {
      return false;
    }
    return tokens.some((token) => name.includes(token));
  });
}

export function resolvePinnedAsset(release: WledRelease, pinnedAssetPattern: string): ReleaseAsset | undefined {
  const pattern = pinnedAssetPattern.toUpperCase();
  return release.assets.find((asset) => asset.name.toUpperCase().includes(pattern));
}
