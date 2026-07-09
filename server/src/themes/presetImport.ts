import type { CustomTheme } from './repository.js';

/**
 * Maps a controller's WLED device presets to importable uber-wled themes and
 * classifies each against the existing theme set, so the UI can:
 *  - import genuinely new presets,
 *  - report presets already imported (same name AND same config), and
 *  - flag conflicts (same name, different config) for rename-or-overwrite.
 *
 * A WLED preset stores its look on its first segment (`seg[0]`): fx (effect),
 * pal (palette), col (color slots, RGB or RGBW), plus a top-level bri
 * (brightness) and `n` (name). Presets without a name (the id-0 placeholder),
 * playlists, and presets whose first segment sets no effect (e.g. a
 * brightness-only or architectural preset) aren't themes and are skipped.
 */

export interface RawPresetSegment {
  fx?: number;
  pal?: number;
  col?: number[][];
  sx?: number;
  ix?: number;
}

export interface RawPreset {
  n?: string;
  bri?: number;
  playlist?: unknown;
  seg?: RawPresetSegment[];
}

export type ThemeShape = Omit<CustomTheme, 'id'>;

export interface SkippedPreset {
  presetId: number;
  name: string;
  reason: string;
}

export type ImportStatus = 'new' | 'duplicate' | 'conflict';

export interface ImportCandidate {
  presetId: number;
  theme: ThemeShape;
  status: ImportStatus;
  /** The existing theme this collides with (set for 'duplicate' and 'conflict'). */
  existingThemeId?: string;
}

/** Extracts a theme from a raw preset, or null if the preset isn't a theme. */
export function presetToTheme(preset: RawPreset): ThemeShape | null {
  if (!preset || typeof preset.n !== 'string' || preset.n.trim() === '') return null;
  if (preset.playlist !== undefined) return null;
  const seg0 = Array.isArray(preset.seg) && preset.seg.length > 0 ? preset.seg[0] : undefined;
  if (!seg0 || typeof seg0.fx !== 'number') return null;

  const colors =
    Array.isArray(seg0.col) && seg0.col.length > 0 && seg0.col.every((c) => Array.isArray(c))
      ? seg0.col
      : [[255, 255, 255]];

  return {
    name: preset.n,
    effect: seg0.fx,
    palette: typeof seg0.pal === 'number' ? seg0.pal : 0,
    colors,
    brightness: typeof preset.bri === 'number' ? preset.bri : 128,
    speed: typeof seg0.sx === 'number' ? seg0.sx : 128,
    intensity: typeof seg0.ix === 'number' ? seg0.ix : 128
  };
}

function sameConfig(
  a: ThemeShape,
  b: Pick<CustomTheme, 'effect' | 'palette' | 'colors' | 'brightness' | 'speed' | 'intensity'>
): boolean {
  return (
    a.effect === b.effect &&
    a.palette === b.palette &&
    a.brightness === b.brightness &&
    a.speed === b.speed &&
    a.intensity === b.intensity &&
    JSON.stringify(a.colors) === JSON.stringify(b.colors)
  );
}

/**
 * Classifies each preset in a raw /presets.json map against existing themes.
 * Returns import candidates (new / duplicate / conflict) plus the presets
 * skipped as non-themes.
 */
export function classifyPresetImport(
  presets: Record<string, RawPreset>,
  existingThemes: CustomTheme[]
): { candidates: ImportCandidate[]; skipped: SkippedPreset[] } {
  const candidates: ImportCandidate[] = [];
  const skipped: SkippedPreset[] = [];

  for (const [id, preset] of Object.entries(presets)) {
    const presetId = Number(id);
    if (!Number.isFinite(presetId)) continue;
    const theme = presetToTheme(preset);
    if (!theme) {
      // Only report named-but-unsupported presets (skip the id-0 placeholder
      // and other nameless entries silently — there's nothing to tell the
      // user about them).
      if (preset && typeof preset.n === 'string' && preset.n.trim() !== '') {
        skipped.push({
          presetId,
          name: preset.n,
          reason: preset.playlist !== undefined ? 'playlist (not a theme)' : 'no effect on its first segment'
        });
      }
      continue;
    }

    const match = existingThemes.find((t) => t.name === theme.name);
    if (!match) {
      candidates.push({ presetId, theme, status: 'new' });
    } else if (sameConfig(theme, match)) {
      candidates.push({ presetId, theme, status: 'duplicate', existingThemeId: match.id });
    } else {
      candidates.push({ presetId, theme, status: 'conflict', existingThemeId: match.id });
    }
  }

  candidates.sort((a, b) => a.presetId - b.presetId);
  skipped.sort((a, b) => a.presetId - b.presetId);
  return { candidates, skipped };
}
