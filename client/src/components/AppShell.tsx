import { useEffect, useState } from 'react';
import { Sidebar, SECTIONS, type SectionKey } from './Sidebar';
import { HomeSection } from './HomeSection';
import { ControllersSection } from './ControllersSection';
import { GroupManager } from './GroupManager';
import { ThemeManager } from './ThemeManager';
import { LayoutSection } from './LayoutSection';
import { ScheduleSection } from './ScheduleSection';
import { FirmwareSection } from './FirmwareSection';
import { SettingsSection } from './SettingsSection';
import { listControllers, getFirmwareStatus } from '../api/client';

const DEFAULT_SECTION: SectionKey = 'home';
const KEYS = SECTIONS.map((s) => s.key);
const FIRMWARE_CHECK_INTERVAL_MS = 60_000;

function sectionFromHash(): SectionKey {
  const h = window.location.hash.replace(/^#\/?/, '') as SectionKey;
  return (KEYS as string[]).includes(h) ? h : DEFAULT_SECTION;
}

export function AppShell() {
  const [active, setActive] = useState<SectionKey>(sectionFromHash());
  const [collapsed, setCollapsed] = useState(false);
  const [firmwareUpdateAvailable, setFirmwareUpdateAvailable] = useState(false);

  useEffect(() => {
    const onHash = () => setActive(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdates() {
      try {
        const controllers = await listControllers();
        const statuses = await Promise.all(
          controllers.map((c) => getFirmwareStatus(c.id).catch(() => null))
        );
        if (!cancelled) setFirmwareUpdateAvailable(statuses.some((s) => s?.updateAvailable));
      } catch {
        // Best-effort indicator only — leave the previous value on failure.
      }
    }

    checkForUpdates();
    const t = setInterval(checkForUpdates, FIRMWARE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  function navigate(s: SectionKey) {
    window.location.hash = `#/${s}`;
    setActive(s);
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        badges={{ firmware: firmwareUpdateAvailable }}
      />
      <main className="app-main">
        {active === 'home' && <HomeSection />}
        {active === 'layout' && <LayoutSection />}
        {active === 'controllers' && <ControllersSection />}
        {active === 'groups' && <GroupManager />}
        {active === 'themes' && <ThemeManager />}
        {active === 'schedule' && <ScheduleSection />}
        {active === 'firmware' && <FirmwareSection />}
        {active === 'settings' && <SettingsSection />}
      </main>
    </div>
  );
}
