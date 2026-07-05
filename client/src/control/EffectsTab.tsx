import { useState } from 'react';
import type { AggregatedControlState, MergedEffectEntry } from './controlState';
import { SearchInput } from '../components/ui/SearchInput';
import { Slider } from '../components/ui/Slider';
import { Toggle } from '../components/ui/Toggle';
import { Chip } from '../components/ui/Chip';

const SLIDER_KEYS = ['sx', 'ix', 'c1', 'c2', 'c3'] as const;
const OPTION_KEYS = ['o1', 'o2', 'o3'] as const;
export type EffectParamKey = (typeof SLIDER_KEYS)[number];
export type EffectOptionKey = (typeof OPTION_KEYS)[number];

const DEFAULT_SLIDER_LABELS: Record<EffectParamKey, string> = {
  sx: 'Effect speed', ix: 'Effect intensity', c1: 'Custom 1', c2: 'Custom 2', c3: 'Custom 3'
};

export interface EffectsTabProps {
  effects: MergedEffectEntry[];
  agg: AggregatedControlState;
  onSelectEffect: (name: string) => void;
  onParamChange: (key: EffectParamKey, value: number) => void;
  onOptionChange: (key: EffectOptionKey, value: boolean) => void;
}

export function EffectsTab({ effects, agg, onSelectEffect, onParamChange, onOptionChange }: EffectsTabProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q === '' ? effects : effects.filter((e) => e.name.toLowerCase().includes(q));
  const selectedName = typeof agg.fxName === 'string' ? agg.fxName : null;

  return (
    <div className="effects-tab">
      <SearchInput value={query} onChange={setQuery} placeholder="Search effects" label="Search effects" />
      {agg.fxName === 'mixed' && (
        <p className="cs-mixed-note">Targets are running different effects — pick one to sync them.</p>
      )}
      <ul className="effect-list">
        {filtered.map((effect) => {
          const selected = effect.name === selectedName;
          const flags = effect.meta?.flags ?? [];
          return (
            <li key={effect.name}>
              <button type="button"
                className={selected ? 'effect-row selected' : 'effect-row'}
                onClick={() => onSelectEffect(effect.name)}>
                <span className="effect-name">{effect.name}</span>
                <span className="effect-badges">
                  <Chip>#{effect.meta?.id ?? Object.values(effect.ids)[0]}</Chip>
                  {flags.includes('2') && <Chip>2D</Chip>}
                  {(flags.includes('v') || flags.includes('f')) && <Chip>Audio</Chip>}
                  {!effect.supportedEverywhere && <Chip variant="warning">Not on all</Chip>}
                </span>
              </button>
              {selected && effect.meta && (
                <div className="effect-controls">
                  {SLIDER_KEYS.map((key) => {
                    const label = effect.meta!.sliders[key];
                    if (label == null) return null;
                    const display = label === '!' ? DEFAULT_SLIDER_LABELS[key] : label;
                    const value = agg[key];
                    return (
                      // mixed → deterministic 128 fallback (write-only until the user drags)
                      <Slider key={key} label={display} min={0} max={255}
                        value={typeof value === 'number' ? value : 128}
                        onChange={(v) => onParamChange(key, v)} />
                    );
                  })}
                  {OPTION_KEYS.map((key) => {
                    const label = effect.meta!.options[key];
                    if (label == null) return null;
                    const value = agg[key];
                    return (
                      // mixed → shown unchecked; first tap writes true everywhere
                      <Toggle key={key} label={label}
                        checked={value === true}
                        onChange={(v) => onOptionChange(key, v)} />
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
