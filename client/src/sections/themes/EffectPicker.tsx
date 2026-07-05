import { useMemo, useState } from 'react';
import type { FxMeta } from '../../api/client';
import { SearchInput } from '../../components/ui/SearchInput';

export function EffectPicker({
  fxMeta,
  selectedId,
  onSelect
}: {
  fxMeta: FxMeta[];
  selectedId: number;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? fxMeta : fxMeta.filter((f) => f.name.toLowerCase().includes(q));
  }, [fxMeta, query]);

  return (
    <div className="picker">
      <SearchInput value={query} onChange={setQuery} placeholder="Search effects" label="Search effects" />
      <ul className="picker-list" role="listbox" aria-label="Effects">
        {visible.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              role="option"
              aria-selected={f.id === selectedId}
              className={`picker-row${f.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelect(f.id)}
            >
              <span className="picker-row-name">{f.name}</span>
              <span className="picker-row-tags">
                {f.flags.includes('2') && <span className="picker-tag">2D</span>}
                {(f.flags.includes('v') || f.flags.includes('f')) && <span className="picker-tag">♪</span>}
                <span className="picker-tag picker-tag-id">#{f.id}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
