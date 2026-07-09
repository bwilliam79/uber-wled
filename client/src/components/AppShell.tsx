import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './Sidebar';
import { MasterBar } from './MasterBar';
import { BottomNav } from './BottomNav';
import { SECTIONS, SECTION_META, type SectionKey } from './nav';
import { useControllers } from '../api/queries';
import { useLiveStatus } from '../api/live';
import { HomeSection } from '../sections/home/HomeSection';
import { DevicesSection } from '../sections/devices/DevicesSection';
import { ThemesSection } from '../sections/themes/ThemesSection';
import { LayoutSection } from '../sections/layout/LayoutSection';
import { ScheduleSection } from '../sections/schedule/ScheduleSection';
import { SyncSection } from '../sections/sync/SyncSection';
import { FirmwareSection } from '../sections/firmware/FirmwareSection';
import { SettingsSection } from '../sections/settings/SettingsSection';
import { useFirmwareUpdateAvailable, useAppUpdateStatus } from '../api/queries';
import './appshell.css';

const DEFAULT_SECTION: SectionKey = 'home';
const KEYS = SECTIONS.map((s) => s.key);

/** Pre-1.0 bookmarks keep working: Controllers became Devices; Groups folded into Home. */
const LEGACY_ALIASES: Record<string, SectionKey> = { controllers: 'devices', groups: 'home' };

export function sectionFromHash(): SectionKey {
  const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  const mapped = LEGACY_ALIASES[raw] ?? raw;
  return (KEYS as string[]).includes(mapped) ? (mapped as SectionKey) : DEFAULT_SECTION;
}

export function AppShell() {
  const [active, setActive] = useState<SectionKey>(sectionFromHash());
  const firmwareUpdateAvailable = useFirmwareUpdateAvailable();
  const appUpdate = useAppUpdateStatus();

  // Single live-status subscription for the shell chrome (lit logo + master
  // bar); sections open their own as needed. One EventSource, not several.
  const controllers = useControllers().data ?? [];
  const ids = useMemo(() => controllers.map((c) => c.id), [controllers]);
  const live = useLiveStatus(ids);
  const anyOn = controllers.some((c) => live.get(c.id)?.state?.on);

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
  const meta = SECTION_META[active];

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onNavigate={navigate}
        badges={badges}
        appUpdate={appUpdate.data}
        logoLit={anyOn}
      />
      <div className="app-content">
        <MasterBar title={meta.title} subtitle={meta.subtitle} controllers={controllers} live={live} />
        <main className="app-main">
          {active === 'home' && <HomeSection />}
          {active === 'layout' && <LayoutSection />}
          {active === 'devices' && <DevicesSection />}
          {active === 'themes' && <ThemesSection />}
          {active === 'schedule' && <ScheduleSection />}
          {active === 'sync' && <SyncSection />}
          {active === 'firmware' && (
            <FirmwareSection
              onOpenDeviceUpdate={(controllerId) => {
                window.location.hash = `#/devices/${controllerId}/update`;
              }}
            />
          )}
          {active === 'settings' && <SettingsSection />}
        </main>
      </div>
      <BottomNav active={active} onNavigate={navigate} badges={badges} />
    </div>
  );
}
