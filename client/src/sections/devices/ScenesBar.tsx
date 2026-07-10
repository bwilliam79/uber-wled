import { useMemo } from 'react';
import { applyControl, type Controller, type CustomTheme, type Target } from '../../api/client';
import { useThemes } from '../../api/queries';
import { useToast } from '../../components/ui/Toast';

/**
 * One-tap "scenes": apply a saved theme to the whole fleet (or turn everything
 * off) without opening a control surface. Reuses the theme model — a scene is
 * just a theme fanned out to every controller.
 */
export function ScenesBar({ controllers }: { controllers: Controller[] }) {
  const themes = useThemes();
  const toast = useToast();
  const targets: Target[] = useMemo(
    () => controllers.map((c) => ({ kind: 'controller', controllerId: c.id })),
    [controllers]
  );

  if (targets.length === 0 || !themes.data || themes.data.length === 0) return null;

  function applyScene(theme: CustomTheme) {
    applyControl(targets, {
      on: true,
      bri: theme.brightness,
      seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors, sx: theme.speed, ix: theme.intensity }
    })
      .then(() => toast.show({ title: `Applied "${theme.name}" to all devices`, variant: 'success' }))
      .catch(() => toast.show({ title: 'Failed to apply scene', variant: 'error' }));
  }

  function allOff() {
    applyControl(targets, { on: false })
      .then(() => toast.show({ title: 'Turned everything off', variant: 'success' }))
      .catch(() => toast.show({ title: 'Failed to turn off', variant: 'error' }));
  }

  return (
    <div className="scenes-tab" role="group" aria-label="Scenes">
      <p className="scenes-hint">Tap a scene to apply it to every controller.</p>
      <div className="scenes-grid">
        {themes.data.map((t) => (
          <button
            key={t.id}
            type="button"
            className="scene-chip"
            onClick={() => applyScene(t)}
            aria-label={`Apply ${t.name} to all devices`}
          >
            {t.name}
          </button>
        ))}
        <button type="button" className="scene-chip scene-chip-off" onClick={allOff}>
          All off
        </button>
      </div>
    </div>
  );
}
