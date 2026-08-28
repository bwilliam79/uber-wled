import { useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { useToast } from './ui/Toast';
import { MasterBar } from './MasterBar';
import { BottomNav } from './BottomNav';
import { SECTIONS, SECTION_META, type SectionKey } from './nav';
import { useControllers } from '../api/queries';
import { useLiveStatus } from '../api/live';
import { DevicesSection } from '../sections/devices/DevicesSection';
import { ThemesSection } from '../sections/themes/ThemesSection';
import { ScheduleSection } from '../sections/schedule/ScheduleSection';
import { SyncSection } from '../sections/sync/SyncSection';
import { FirmwareSection } from '../sections/firmware/FirmwareSection';
import { SettingsSection } from '../sections/settings/SettingsSection';
import { useFirmwareUpdateAvailable, useAppUpdateStatus, useServerVersion } from '../api/queries';
import { isNewerVersion } from '../lib/version';
import './appshell.css';

const DEFAULT_SECTION: SectionKey = 'devices';
const KEYS = SECTIONS.map((s) => s.key);

/** Older bookmarks keep working: Controllers became Devices; Home was removed
 *  and its rooms folded into Devices, so both it and the pre-1.0 Groups view
 *  now land on Devices. */
const LEGACY_ALIASES: Record<string, SectionKey> = {
  controllers: 'devices',
  groups: 'devices',
  home: 'devices',
  // Orphan Layout / Segments top-level — dropped from nav; segments live under
  // device detail. Keep bookmarks from landing on a blank main.
  layout: 'devices',
  segments: 'devices'
};

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
  const controllersData = useControllers().data;
  const controllers = useMemo(() => controllersData ?? [], [controllersData]);
  const ids = useMemo(() => controllers.map((c) => c.id), [controllers]);
  const live = useLiveStatus(ids);
  const anyOn = controllers.some((c) => live.get(c.id)?.state?.on);

  // Toast when a controller drops offline or comes back — a lightweight health
  // notification from anywhere in the app. Tracks the previous reachability per
  // controller; the very first frame seeds state without alerting.
  const toast = useToast();
  const prevReachable = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    for (const c of controllers) {
      const entry = live.get(c.id);
      if (!entry) continue;
      const was = prevReachable.current.get(c.id);
      const now = entry.reachable;
      const name = entry.info?.name || c.name;
      if (was === true && now === false) {
        toast.show({ title: `${name} went offline`, variant: 'error' });
      } else if (was === false && now === true) {
        toast.show({ title: `${name} is back online`, variant: 'success' });
      }
      prevReachable.current.set(c.id, now);
    }
  }, [live, controllers, toast]);

  // A long-open tab keeps running the bundle it first loaded; when the deployed
  // server version is *newer* than this build, prompt a reload so fixes land.
  // Strict greater-than (not mere inequality): client and server package.json
  // can drift, and an older /api/version must never be offered as an "update".
  const serverVersion = useServerVersion();
  const deployed = serverVersion.data?.version;
  const staleBundle = typeof deployed === 'string' && isNewerVersion(deployed, __APP_VERSION__);

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
        {staleBundle && (
          <div className="reload-banner" role="status">
            <span>A new version (v{serverVersion.data!.version}) is available.</span>
            <button type="button" onClick={() => window.location.reload()}>Reload</button>
          </div>
        )}
        <MasterBar title={meta.title} subtitle={meta.subtitle} controllers={controllers} live={live} />
        <main className="app-main">
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
