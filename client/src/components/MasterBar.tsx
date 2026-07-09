import { useMemo, useRef, useState } from 'react';
import { applyControl, type Controller, type Target } from '../api/client';
import { useSyncGroups } from '../api/queries';
import type { LiveStatusEntry } from '../api/live';
import { Slider } from './ui/Slider';
import { useTheme } from '../theme/ThemeProvider';
import { throttle } from '../lib/throttle';

const BRIGHTNESS_THROTTLE_MS = 120;

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
  const syncGroups = useSyncGroups();

  // Aggregate brightness across reachable, powered controllers (0–255).
  const aggregateBri = useMemo(() => {
    const vals: number[] = [];
    for (const c of controllers) {
      const entry = live.get(c.id);
      if (entry?.reachable && entry.state?.on && typeof entry.state.bri === 'number') {
        vals.push(entry.state.bri);
      }
    }
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [controllers, live]);

  // Local optimistic override while dragging (falls back to the live aggregate).
  const [override, setOverride] = useState<number | null>(null);
  const value = override ?? aggregateBri;
  const pct = Math.round((value / 255) * 100);

  const onCount = useMemo(
    () => controllers.filter((c) => live.get(c.id)?.state?.on).length,
    [controllers, live]
  );
  const activeSync = (syncGroups.data ?? []).find((g) => g.active);

  const pushBrightness = useRef(
    throttle((bri: number) => {
      const targets: Target[] = controllers.map((c) => ({ kind: 'controller', controllerId: c.id }));
      if (targets.length > 0) applyControl(targets, { bri }).catch(() => {});
    }, BRIGHTNESS_THROTTLE_MS)
  ).current;

  function handleBrightness(bri: number) {
    setOverride(bri);
    pushBrightness(bri);
  }

  const statusText = activeSync ? activeSync.name : onCount > 0 ? `${onCount} on` : 'All off';
  const statusActive = !!activeSync || onCount > 0;

  return (
    <header className="master-bar">
      <div className="master-bar-titles">
        <div className="master-bar-title">{title}</div>
        {subtitle && <div className="master-bar-sub">{subtitle}</div>}
      </div>
      <div className="master-bar-spacer" />

      <div className="master-bar-brightness">
        <span className="master-bar-sun"><SunGlyph /></span>
        <Slider
          min={0}
          max={255}
          value={value}
          onChange={handleBrightness}
          label="Master brightness (all controllers)"
          disabled={controllers.length === 0}
        />
        <span className="master-bar-pct">{pct}%</span>
      </div>

      <div className="master-bar-status" title={activeSync ? 'Active sync group' : `${onCount} controller(s) on`}>
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
