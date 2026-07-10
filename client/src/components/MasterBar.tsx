import { useMemo } from 'react';
import type { Controller } from '../api/client';
import type { LiveStatusEntry } from '../api/live';
import { useTheme } from '../theme/ThemeProvider';

/** Sun/moon glyphs inline (match the prototype); the app icon set has no sun/moon. */
function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21M5.5 5.5l1.1 1.1M17.4 17.4l1.1 1.1M18.5 5.5l-1.1 1.1M6.6 17.4l-1.1 1.1" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13a6 6 0 1 1-7-9 5 5 0 0 0 7 9z" />
    </svg>
  );
}

export function MasterBar({
  title,
  subtitle,
  controllers,
  live
}: {
  title: string;
  subtitle?: string;
  controllers: Controller[];
  live: ReadonlyMap<string, LiveStatusEntry>;
}) {
  const { theme, setTheme } = useTheme();

  const onCount = useMemo(
    () => controllers.filter((c) => live.get(c.id)?.state?.on).length,
    [controllers, live]
  );

  // The pill is a plain fleet power read-out ("N on" / "All off"); active sync
  // groups now surface as their own cards on the Devices page, not here.
  const statusText = onCount > 0 ? `${onCount} on` : 'All off';
  const statusActive = onCount > 0;

  return (
    <header className="master-bar">
      <div className="master-bar-titles">
        <div className="master-bar-title">{title}</div>
        {subtitle && <div className="master-bar-sub">{subtitle}</div>}
      </div>
      <div className="master-bar-spacer" />

      <div className="master-bar-status" title={`${onCount} controller(s) on`}>
        <span className={`master-bar-status-dot${statusActive ? ' pulse' : ''}`} />
        <span className="master-bar-status-text">{statusText}</span>
      </div>

      <div className="theme-toggle" role="group" aria-label="Theme">
        <button
          type="button"
          className={`theme-toggle-btn${theme === 'light' ? ' active' : ''}`}
          aria-label="Light theme"
          aria-pressed={theme === 'light'}
          onClick={() => setTheme('light')}
        >
          <SunGlyph />
        </button>
        <button
          type="button"
          className={`theme-toggle-btn${theme === 'dark' ? ' active' : ''}`}
          aria-label="Dark theme"
          aria-pressed={theme === 'dark'}
          onClick={() => setTheme('dark')}
        >
          <MoonGlyph />
        </button>
      </div>
    </header>
  );
}
