import { SECTIONS, type SectionKey } from './nav';
import { LightbulbIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';

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
      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
      </button>
    </nav>
  );
}
