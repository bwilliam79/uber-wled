import type { AppUpdateStatus } from '../api/client';
import { SECTIONS, type SectionKey } from './nav';
import { LightbulbIcon } from './icons';

export function Sidebar({
  active,
  onNavigate,
  badges,
  appUpdate,
  logoLit
}: {
  active: SectionKey;
  onNavigate: (s: SectionKey) => void;
  badges?: Partial<Record<SectionKey, boolean>>;
  appUpdate?: AppUpdateStatus;
  logoLit?: boolean;
}) {
  return (
    <nav className="sidebar" aria-label="Sections">
      <div className={`sidebar-logo${logoLit ? ' lit' : ''}`} aria-hidden="true">
        <LightbulbIcon className="logo-mark" />
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
      <div className="sidebar-footer">
        {appUpdate?.updateAvailable ? (
          <a
            className="sidebar-version sidebar-version-update"
            href={appUpdate.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Update available: ${appUpdate.latestVersion} (you have ${appUpdate.currentVersion})`}
            title={`Update available: ${appUpdate.latestVersion} (you have ${appUpdate.currentVersion})`}
          >
            v{__APP_VERSION__} · update
          </a>
        ) : (
          <span className="sidebar-version">v{__APP_VERSION__}</span>
        )}
      </div>
    </nav>
  );
}
