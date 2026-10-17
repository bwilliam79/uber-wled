import type { ControlPatch, CustomTheme } from '../api/client';

/** The one ControlPatch every client theme-apply path sends. Includes
 *  segRev only when the theme stores per-controller directions.
 *  `track` (default true) adds themeId so the server records an active look.
 *  Pass `{ track: false }` for a preview that will be reverted. */
export function themeToPatch(
  theme: CustomTheme,
  extra: Partial<ControlPatch> = {},
  options: { track?: boolean } = {}
): ControlPatch {
  const track = options.track !== false;
  const rest: Partial<ControlPatch> = { ...extra };
  if (!track) delete rest.themeId;
  const entries = Object.entries(theme.directions ?? {});
  return {
    ...rest,
    ...(track ? { themeId: theme.id } : {}),
    bri: theme.brightness,
    seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors, sx: theme.speed, ix: theme.intensity },
    ...(entries.length > 0 ? { segRev: Object.fromEntries(entries.map(([id, d]) => [id, d.rev])) } : {})
  };
}
