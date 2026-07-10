import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addTheme, updateTheme, type ControllerCapabilities, type CustomTheme } from '../../api/client';
import { hexToRgb, rgbToHex } from '../../lib/color';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Slider } from '../../components/ui/Slider';
import { LedPreview } from '../../components/ui/LedPreview';
import { effectToPreview, resolvePreviewColors } from '../../lib/effectPreview';
import { EffectPicker } from './EffectPicker';
import { PalettePicker } from './PalettePicker';
import { ColorSlotButton } from './ColorSlotButton';

const DEFAULT_COLORS: [string, string, string] = ['#ffffff', '#000000', '#000000'];

/** Three hex slots pre-filled from an existing theme's RGB colors (padded/
 *  truncated to exactly three). */
function colorsFromTheme(theme: CustomTheme): [string, string, string] {
  const slots = [0, 1, 2].map((i) => {
    const rgb = theme.colors[i];
    return rgb ? rgbToHex([rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0]) : '#000000';
  });
  return [slots[0], slots[1], slots[2]];
}

export function ThemeForm({
  capabilities,
  editing = null,
  onDone
}: {
  capabilities: ControllerCapabilities;
  /** When set, the form edits this theme (PUT) instead of creating a new one. */
  editing?: CustomTheme | null;
  onDone?: () => void;
}) {
  // Initialized once per mount; ThemesSection remounts the form (via key) when
  // the edit target changes, so these initializers pick up the right values.
  const [name, setName] = useState(editing?.name ?? '');
  const [effectId, setEffectId] = useState(editing?.effect ?? 0);
  const [paletteId, setPaletteId] = useState(editing?.palette ?? 0);
  const [colors, setColors] = useState<[string, string, string]>(
    editing ? colorsFromTheme(editing) : DEFAULT_COLORS
  );
  const [brightness, setBrightness] = useState(editing?.brightness ?? 128);
  const [speed, setSpeed] = useState(editing?.speed ?? 128);
  const [intensity, setIntensity] = useState(editing?.intensity ?? 128);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (input: Omit<CustomTheme, 'id'>) =>
      editing ? updateTheme(editing.id, input) : addTheme(input),
    onSuccess: (saved: CustomTheme) => {
      queryClient.setQueryData<CustomTheme[]>(['themes'], (prev) => {
        const list = prev ?? [];
        return editing ? list.map((t) => (t.id === saved.id ? saved : t)) : [...list, saved];
      });
      if (editing) {
        onDone?.();
      } else {
        setName('');
        setEffectId(0);
        setPaletteId(0);
        setColors(DEFAULT_COLORS);
        setBrightness(128);
        setSpeed(128);
        setIntensity(128);
      }
    }
  });

  function setSlot(index: number, hex: string) {
    setColors((prev) => {
      const next = [...prev] as [string, string, string];
      next[index] = hex;
      return next;
    });
  }

  const effectName = capabilities.effects[effectId] ?? `Effect #${effectId}`;
  const preview = useMemo(() => {
    const slotRgbs = colors.map((c) => hexToRgb(c) ?? [0, 0, 0]);
    const fxMeta = capabilities.fxMeta.find((m) => m.id === effectId);
    const palettePreview = capabilities.palettePreviews[paletteId];
    return {
      effect: effectToPreview(effectName),
      colors: resolvePreviewColors(slotRgbs, palettePreview, {
        usesPalette: fxMeta?.usesPalette,
        paletteId
      })
    };
  }, [capabilities, colors, effectId, effectName, paletteId]);

  return (
    <div className="theme-form">
      <div className="theme-form-preview-well" data-testid="theme-form-preview">
        <LedPreview
          effect={preview.effect}
          colors={preview.colors}
          count={56}
          speed={Math.max(0.15, speed / 128)}
          intensity={intensity}
          className="theme-form-preview-canvas"
          ariaLabel={`${name || 'Theme'} live preview`}
        />
      </div>
      <Field label="Name" htmlFor="theme-name">
        <input
          id="theme-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New theme name"
        />
      </Field>
      <div className="theme-form-pickers">
        <Field label="Effect">
          <EffectPicker fxMeta={capabilities.fxMeta} selectedId={effectId} onSelect={setEffectId} />
        </Field>
        <Field label="Palette">
          <PalettePicker
            palettes={capabilities.palettes}
            previews={capabilities.palettePreviews}
            slotColorsHex={colors}
            selectedId={paletteId}
            onSelect={setPaletteId}
          />
        </Field>
      </div>
      <div className="theme-form-colors" role="group" aria-label="Colors">
        <ColorSlotButton label="Color 1" color={colors[0]} onChange={(hex) => setSlot(0, hex)} />
        <ColorSlotButton label="Color 2" color={colors[1]} onChange={(hex) => setSlot(1, hex)} />
        <ColorSlotButton label="Color 3" color={colors[2]} onChange={(hex) => setSlot(2, hex)} />
      </div>
      <Field label={`Brightness (${brightness})`}>
        <Slider min={1} max={255} value={brightness} onChange={setBrightness} label="Brightness" />
      </Field>
      <div className="theme-form-fx-params">
        <Field label={`Speed (${speed})`}>
          <Slider min={0} max={255} value={speed} onChange={setSpeed} label="Effect speed" />
        </Field>
        <Field label={`Intensity (${intensity})`}>
          <Slider min={0} max={255} value={intensity} onChange={setIntensity} label="Effect intensity" />
        </Field>
      </div>
      {save.isError && (
        <div className="error-banner" role="alert">Failed to save theme.</div>
      )}
      <div className="theme-form-actions">
        <Button
          variant="primary"
          disabled={name === '' || save.isPending}
          onClick={() =>
            save.mutate({
              name,
              effect: effectId,
              palette: paletteId,
              brightness,
              speed,
              intensity,
              colors: colors.map((c) => hexToRgb(c) ?? [0, 0, 0])
            })
          }
        >
          {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add theme'}
        </Button>
        {editing && (
          <Button variant="secondary" disabled={save.isPending} onClick={() => onDone?.()}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
