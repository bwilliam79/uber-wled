import type { ControlPatch, CustomTheme } from '../api/client';

/** The one ControlPatch every client theme-apply path sends. Includes
 *  segRev only when the theme stores per-controller directions. */
export function themeToPatch(theme: CustomTheme, extra: Partial<ControlPatch> = {}): ControlPatch {
  const entries = Object.entries(theme.directions ?? {});
  return {
    ...extra,
    bri: theme.brightness,
    seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors, sx: theme.speed, ix: theme.intensity },
    ...(entries.length > 0 ? { segRev: Object.fromEntries(entries.map(([id, d]) => [id, d.rev])) } : {})
  };
}
