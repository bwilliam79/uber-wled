import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { EffectPicker } from '../sections/themes/EffectPicker';
import { PalettePicker } from '../sections/themes/PalettePicker';
import { paletteGradientCss } from '../lib/paletteCss';
import { CAPS } from './fixtures/capabilities';

describe('EffectPicker', () => {
  it('filters by search and reports the picked effect id', () => {
    const onSelect = vi.fn();
    render(<EffectPicker fxMeta={CAPS.fxMeta} selectedId={0} onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText('Search effects'), { target: { value: 'bli' } });
    expect(screen.queryByRole('option', { name: /Breathe/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Blink/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('marks the selected row and shows the audio badge from fxdata flags', () => {
    render(<EffectPicker fxMeta={CAPS.fxMeta} selectedId={3} onSelect={() => {}} />);
    const wipe = screen.getByRole('option', { name: /Wipe/ });
    expect(wipe.getAttribute('aria-selected')).toBe('true');
    expect(within(wipe).getByText('♪')).toBeTruthy();
  });
});

describe('PalettePicker', () => {
  it('renders gradient previews from palx stops and a randomized badge', () => {
    const slots = ['#ff0000', '#00ff00', '#0000ff'];
    render(
      <PalettePicker
        palettes={CAPS.palettes}
        previews={CAPS.palettePreviews}
        slotColorsHex={slots}
        selectedId={0}
        onSelect={() => {}}
      />
    );
    const party = screen.getByTestId('palette-bar-6') as HTMLElement;
    expect(party.style.backgroundImage).toBe(paletteGradientCss(CAPS.palettePreviews[6], slots));
    expect(within(screen.getByTestId('palette-bar-1')).getByText('randomized')).toBeTruthy();
  });

  it('filters by search and reports the picked palette id', () => {
    const onSelect = vi.fn();
    render(
      <PalettePicker
        palettes={CAPS.palettes}
        previews={CAPS.palettePreviews}
        slotColorsHex={[]}
        selectedId={0}
        onSelect={onSelect}
      />
    );
    fireEvent.change(screen.getByLabelText('Search palettes'), { target: { value: 'party' } });
    fireEvent.click(screen.getByRole('option', { name: /Party/ }));
    expect(onSelect).toHaveBeenCalledWith(6);
  });
});
