import { SECTIONS, type SectionKey } from './nav';

export function BottomNav({
  active,
  onNavigate,
  badges
}: {
  active: SectionKey;
  onNavigate: (s: SectionKey) => void;
  badges?: Partial<Record<SectionKey, boolean>>;
}) {
  return (
    <nav className="bottom-nav" aria-label="Bottom navigation">
      {SECTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`bottom-nav-item${active === key ? ' active' : ''}`}
          aria-label={label}
          aria-current={active === key ? 'page' : undefined}
          onClick={() => onNavigate(key)}
        >
          <span className="bottom-nav-icon-wrap">
            <Icon className="bottom-nav-icon" />
            {badges?.[key] && <span className="sidebar-link-badge" title="Update available" />}
          </span>
          {active === key && <span className="bottom-nav-label">{label}</span>}
        </button>
      ))}
    </nav>
  );
}
