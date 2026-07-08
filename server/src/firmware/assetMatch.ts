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

/**
 * Resolves a pinned pattern (e.g. "ESP32") back to the exact matching
 * release asset. Matches the stripped filename token EXACTLY rather than by
 * substring — a substring check here let "ESP32-C3-QIO" (an entirely
 * different chip) match a pin of "ESP32", since the string "ESP32-C3-QIO"
 * contains "ESP32" as its own prefix. That mismatch reached a real device
 * and was only caught by WLED's own release-name compatibility check
 * ("Firmware release name mismatch: current='ESP32', uploaded='ESP32-C3-
 * QIO'"), which correctly refused to flash it.
 */
export function resolvePinnedAsset(release: WledRelease, pinnedAssetPattern: string): ReleaseAsset | undefined {
  const pattern = pinnedAssetPattern.toUpperCase();
  return release.assets.find((asset) => assetNameToPattern(asset.name).toUpperCase() === pattern);
}

/**
 * Recommends the plain, unspecialized build among a controller's candidate
 * assets — e.g. "ESP32" over "ESP32_HUB75"/"ESP32_Ethernet"/"ESP32_WROVER" —
 * so the one-time picker can pre-highlight the option that's correct for
 * the overwhelming majority of ordinary addressable-LED WLED boards,
 * without ever auto-selecting anything the caller didn't explicitly confirm
 * (that stays a human click; see the firmware update design doc's bricking-
 * risk rationale for why this never picks automatically).
 *
 * Deliberately only returns a name when the chip arch resolves to exactly
 * one filename token AND a candidate's stripped name matches it exactly
 * with no extra suffix — archs like esp8266 resolve to *multiple* tokens
 * (ESP8266/ESP01/ESP02, genuinely different flash-size variants rather
 * than one plain build plus specialized hardware add-ons), and there's no
 * safe default among fundamentally different hardware; that ambiguity is
 * exactly what the pinning step exists to resolve, so this returns null
 * and the UI falls back to today's plain unranked list.
 */
export function recommendedAssetName(candidates: ReleaseAsset[], arch: string): string | null {
  const tokens = chipArchTokens(arch);
  if (tokens.length !== 1) return null;
  const match = candidates.find((asset) => assetNameToPattern(asset.name).toUpperCase() === tokens[0]);
  return match?.name ?? null;
}

function assetNameToPattern(assetName: string): string {
  return assetName.replace(/^WLED_[^_]+_/, '').replace(/\.bin$/i, '');
}
