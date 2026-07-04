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

export function candidateAssets(release: WledRelease, arch: string): ReleaseAsset[] {
  const tokens = chipArchTokens(arch);
  return release.assets.filter((asset) =>
    tokens.some((token) => asset.name.toUpperCase().includes(token))
  );
}

export function resolvePinnedAsset(release: WledRelease, pinnedAssetPattern: string): ReleaseAsset | undefined {
  const pattern = pinnedAssetPattern.toUpperCase();
  return release.assets.find((asset) => asset.name.toUpperCase().includes(pattern));
}
