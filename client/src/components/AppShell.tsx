import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { SECTIONS, type SectionKey } from './nav';
import { HomeSection } from './HomeSection';
import { ControllersSection } from './ControllersSection';
import { ThemesSection } from '../sections/themes/ThemesSection';
import { LayoutSection } from './LayoutSection';
import { ScheduleSection } from './ScheduleSection';
import { FirmwareSection } from './FirmwareSection';
import { SettingsSection } from './SettingsSection';
import { useFirmwareUpdateAvailable } from '../api/queries';
import './appshell.css';

const DEFAULT_SECTION: SectionKey = 'home';
const KEYS = SECTIONS.map((s) => s.key);

/** Pre-1.0 bookmarks keep working: Controllers became Devices; Groups folded into Home. */
const LEGACY_ALIASES: Record<string, SectionKey> = { controllers: 'devices', groups: 'home' };

function sectionFromHash(): SectionKey {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const mapped = LEGACY_ALIASES[raw] ?? raw;
  return (KEYS as string[]).includes(mapped) ? (mapped as SectionKey) : DEFAULT_SECTION;
}

export function AppShell() {
  const [active, setActive] = useState<SectionKey>(sectionFromHash());
  const [collapsed, setCollapsed] = useState(false);
  const firmwareUpdateAvailable = useFirmwareUpdateAvailable();

  useEffect(() => {
    const onHash = () => setActive(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(s: SectionKey) {
    window.location.hash = `#/${s}`;
    setActive(s);
  }

  const badges = { firmware: firmwareUpdateAvailable };

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        badges={badges}
      />
      <main className="app-main">
        {active === 'home' && <HomeSection />}
        {active === 'layout' && <LayoutSection />}
        {active === 'devices' && <ControllersSection />}
        {active === 'themes' && <ThemesSection />}
        {active === 'schedule' && <ScheduleSection />}
        {active === 'firmware' && <FirmwareSection />}
        {active === 'settings' && <SettingsSection />}
      </main>
      <BottomNav active={active} onNavigate={navigate} badges={badges} />
    </div>
  );
}
