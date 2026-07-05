import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addTheme, type ControllerCapabilities, type CustomTheme } from '../../api/client';
import { hexToRgb } from '../../lib/color';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Slider } from '../../components/ui/Slider';
import { EffectPicker } from './EffectPicker';
import { PalettePicker } from './PalettePicker';
import { ColorSlotButton } from './ColorSlotButton';

const DEFAULT_COLORS: [string, string, string] = ['#ffffff', '#000000', '#000000'];

export function ThemeForm({ capabilities }: { capabilities: ControllerCapabilities }) {
  const [name, setName] = useState('');
  const [effectId, setEffectId] = useState(0);
  const [paletteId, setPaletteId] = useState(0);
  const [colors, setColors] = useState<[string, string, string]>(DEFAULT_COLORS);
  const [brightness, setBrightness] = useState(128);
  const queryClient = useQueryClient();

  const createTheme = useMutation({
    mutationFn: addTheme,
    onSuccess: (created: CustomTheme) => {
      queryClient.setQueryData<CustomTheme[]>(['themes'], (prev) => [...(prev ?? []), created]);
      setName('');
      setEffectId(0);
      setPaletteId(0);
      setColors(DEFAULT_COLORS);
      setBrightness(128);
    }
  });

  function setSlot(index: number, hex: string) {
    setColors((prev) => {
      const next = [...prev] as [string, string, string];
      next[index] = hex;
      return next;
    });
  }

  return (
    <div className="theme-form">
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
      {createTheme.isError && (
        <div className="error-banner" role="alert">Failed to save theme.</div>
      )}
      <Button
        variant="primary"
        disabled={name === '' || createTheme.isPending}
        onClick={() =>
          createTheme.mutate({
            name,
            effect: effectId,
            palette: paletteId,
            brightness,
            colors: colors.map((c) => hexToRgb(c) ?? [0, 0, 0])
          })
        }
      >
        {createTheme.isPending ? 'Adding…' : 'Add theme'}
      </Button>
    </div>
  );
}
