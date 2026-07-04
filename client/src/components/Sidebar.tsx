import { type ReactElement } from 'react';
import { LightbulbIcon, GridIcon, UsersIcon, PaletteIcon, CalendarIcon, ChipIcon } from './icons';

export type SectionKey = 'layout' | 'controllers' | 'groups' | 'themes' | 'schedule' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

// Later tasks add layout/schedule/firmware/settings entries. Order here is the
// order shown in the rail.
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'layout', label: 'Layout', Icon: GridIcon },
  { key: 'controllers', label: 'Controllers', Icon: LightbulbIcon },
  { key: 'groups', label: 'Groups', Icon: UsersIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'firmware', label: 'Firmware', Icon: ChipIcon }
];

export function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggleCollapsed
}: {
  active: SectionKey;
  onNavigate: (s: SectionKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sections">
      <div className="sidebar-brand">
        <LightbulbIcon className="logo-mark" />
        <span className="sidebar-brand-text">uber-wled</span>
      </div>
      <ul className="sidebar-nav">
        {SECTIONS.map(({ key, label, Icon }) => (
          <li key={key}>
            <button
              type="button"
              className={`sidebar-link${active === key ? ' active' : ''}`}
              aria-current={active === key ? 'page' : undefined}
              onClick={() => onNavigate(key)}
            >
              <Icon className="sidebar-link-icon" />
              <span className="sidebar-link-label">{label}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="sidebar-collapse-toggle" onClick={onToggleCollapsed} aria-label="Toggle sidebar">
        {collapsed ? '»' : '«'}
      </button>
    </nav>
  );
}
