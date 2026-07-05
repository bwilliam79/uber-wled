import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface TabDef {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label?: string;
}

export function Tabs({ tabs, active, onChange, label }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  }

  return (
    <div role="tablist" aria-label={label} className="ui-tabs">
      {tabs.map((tab, i) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`ui-tab${isActive ? ' active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
