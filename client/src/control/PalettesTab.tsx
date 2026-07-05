import { useState } from 'react';
import type { AggregatedControlState, MergedPaletteEntry } from './controlState';
import { SearchInput } from '../components/ui/SearchInput';
import { Chip } from '../components/ui/Chip';
import { paletteGradientCss } from '../lib/color';

export interface PalettesTabProps {
  palettes: MergedPaletteEntry[];
  agg: AggregatedControlState;
  onSelectPalette: (name: string) => void;
}

export function PalettesTab({ palettes, agg, onSelectPalette }: PalettesTabProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q === '' ? palettes : palettes.filter((p) => p.name.toLowerCase().includes(q));
  const selectedName = typeof agg.palName === 'string' ? agg.palName : null;
  const slotColors = agg.colors.map((c) => (Array.isArray(c) ? c : null));

  return (
    <div className="palettes-tab">
      <SearchInput value={query} onChange={setQuery} placeholder="Search palettes" label="Search palettes" />
      {agg.palName === 'mixed' && (
        <p className="cs-mixed-note">Targets are using different palettes — pick one to sync them.</p>
      )}
      <ul className="palette-list">
        {filtered.map((palette) => {
          const gradient = palette.preview ? paletteGradientCss(palette.preview, slotColors) : null;
          return (
            <li key={palette.name}>
              <button type="button"
                className={palette.name === selectedName ? 'palette-row selected' : 'palette-row'}
                onClick={() => onSelectPalette(palette.name)}>
                <span className="palette-preview"
                  data-gradient={gradient ?? ''}
                  style={gradient ? { background: gradient } : undefined} />
                <span className="palette-name">{palette.name}</span>
                <span className="palette-badges">
                  {palette.preview?.type === 'random' && <Chip>Random</Chip>}
                  {!palette.supportedEverywhere && <Chip variant="warning">Not on all</Chip>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
