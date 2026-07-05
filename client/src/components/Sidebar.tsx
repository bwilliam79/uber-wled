import { type ReactElement } from 'react';
import { LightbulbIcon, GridIcon, UsersIcon, PaletteIcon, CalendarIcon, ChipIcon, GearIcon, HomeIcon } from './icons';

export type SectionKey = 'home' | 'layout' | 'controllers' | 'groups' | 'themes' | 'schedule' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

// Later tasks add layout/schedule/firmware/settings entries. Order here is the
// order shown in the rail.
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'layout', label: 'Layout', Icon: GridIcon },
  { key: 'controllers', label: 'Controllers', Icon: LightbulbIcon },
  { key: 'groups', label: 'Groups', Icon: UsersIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'firmware', label: 'Firmware', Icon: ChipIcon },
  { key: 'settings', label: 'Settings', Icon: GearIcon }
];

export function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  badges
}: {
  active: SectionKey;
  onNavigate: (s: SectionKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  badges?: Partial<Record<SectionKey, boolean>>;
}) {
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sections">
      <div className="sidebar-brand">
        <LightbulbIcon className="logo-mark" />
        <div className="sidebar-brand-info">
          <span className="sidebar-brand-text">uber-wled</span>
          <span className="sidebar-version">v{__APP_VERSION__}</span>
        </div>
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
              <span className="sidebar-link-icon-wrap">
                <Icon className="sidebar-link-icon" />
                {badges?.[key] && <span className="sidebar-link-badge" title="Update available" />}
              </span>
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
