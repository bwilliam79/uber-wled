import { useMemo, useState } from 'react';
import type { PalettePreview } from '../../api/client';
import { SearchInput } from '../../components/ui/SearchInput';
import { paletteGradientCss } from '../../lib/paletteCss';

export function PalettePicker({
  palettes,
  previews,
  slotColorsHex,
  selectedId,
  onSelect
}: {
  palettes: string[];
  previews: Record<number, PalettePreview>;
  slotColorsHex: string[];
  selectedId: number;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const entries = useMemo(() => palettes.map((name, id) => ({ id, name })), [palettes]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? entries : entries.filter((p) => p.name.toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <div className="picker">
      <SearchInput value={query} onChange={setQuery} placeholder="Search palettes" label="Search palettes" />
      <ul className="picker-list" role="listbox" aria-label="Palettes">
        {visible.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              role="option"
              aria-selected={p.id === selectedId}
              className={`picker-row${p.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelect(p.id)}
            >
              <span className="picker-row-name">{p.name}</span>
              <span
                className="palette-bar"
                data-testid={`palette-bar-${p.id}`}
                style={{ backgroundImage: paletteGradientCss(previews[p.id], slotColorsHex) }}
              >
                {previews[p.id]?.type === 'random' && (
                  <span className="palette-random-badge">randomized</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
