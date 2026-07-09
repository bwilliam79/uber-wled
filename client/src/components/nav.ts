import type { ReactElement } from 'react';
import {
  ChipIcon, PaletteIcon, CalendarIcon, DownloadIcon, GearIcon, SyncIcon
} from './icons';

// 'layout' stays in the union (and LayoutSection stays wired up in AppShell)
// even though it's no longer listed in SECTIONS — the Layout section is
// hidden from the nav for now, not removed. Re-adding its SECTIONS entry
// below is all it takes to bring it back.
export type SectionKey =
  'layout' | 'devices' | 'themes' | 'schedule' | 'sync' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

/** The nav sections. Order here is render order in both navs. Layout is
 *  deliberately omitted for now (see SectionKey comment above). */
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'devices', label: 'Devices', Icon: ChipIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'sync', label: 'Sync', Icon: SyncIcon },
  { key: 'firmware', label: 'Firmware', Icon: DownloadIcon },
  { key: 'settings', label: 'Settings', Icon: GearIcon }
];

/** Master-bar title + mono subtitle per view (incl. hidden 'layout'). */
export const SECTION_META: Record<SectionKey, { title: string; subtitle: string }> = {
  devices: { title: 'Devices', subtitle: 'controllers on the network' },
  themes: { title: 'Themes', subtitle: 'effects, palettes & presets' },
  schedule: { title: 'Schedule', subtitle: 'weekly & calendar automation' },
  sync: { title: 'Sync', subtitle: 'multi-controller sync groups' },
  firmware: { title: 'Firmware', subtitle: 'WLED updates across the fleet' },
  settings: { title: 'Settings', subtitle: 'app configuration & backup' },
  layout: { title: 'Segments', subtitle: 'per-controller segment editor' }
};
