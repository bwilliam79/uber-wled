import { useEffect, useState } from 'react';
import { Sidebar, SECTIONS, type SectionKey } from './Sidebar';
import { ControllersSection } from './ControllersSection';
import { GroupManager } from './GroupManager';
import { ThemeManager } from './ThemeManager';
import { LayoutSection } from './LayoutSection';

const DEFAULT_SECTION: SectionKey = 'layout';
const KEYS = SECTIONS.map((s) => s.key);

function sectionFromHash(): SectionKey {
  const h = window.location.hash.replace(/^#\/?/, '') as SectionKey;
  return (KEYS as string[]).includes(h) ? h : DEFAULT_SECTION;
}

export function AppShell() {
  const [active, setActive] = useState<SectionKey>(sectionFromHash());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onHash = () => setActive(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(s: SectionKey) {
    window.location.hash = `#/${s}`;
    setActive(s);
  }

  return (
    <div className="app-shell">
      <Sidebar active={active} onNavigate={navigate} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      <main className="app-main">
        {active === 'layout' && <LayoutSection />}
        {active === 'controllers' && <ControllersSection />}
        {active === 'groups' && <GroupManager />}
        {active === 'themes' && <ThemeManager />}
      </main>
    </div>
  );
}
