import type { ReactElement } from 'react';
import {
  HomeIcon, ChipIcon, PaletteIcon, CalendarIcon, DownloadIcon, GearIcon, SyncIcon
} from './icons';

// 'layout' stays in the union (and LayoutSection stays wired up in AppShell)
// even though it's no longer listed in SECTIONS — the Layout section is
// hidden from the nav for now, not removed. Re-adding its SECTIONS entry
// below is all it takes to bring it back.
export type SectionKey =
  'home' | 'layout' | 'devices' | 'themes' | 'schedule' | 'sync' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

/** The nav sections. Order here is render order in both navs. Layout is
 *  deliberately omitted for now (see SectionKey comment above). */
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'devices', label: 'Devices', Icon: ChipIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'sync', label: 'Sync', Icon: SyncIcon },
  { key: 'firmware', label: 'Firmware', Icon: DownloadIcon },
  { key: 'settings', label: 'Settings', Icon: GearIcon }
];
