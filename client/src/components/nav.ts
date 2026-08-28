import type { ReactElement } from 'react';
import {
  ChipIcon, PaletteIcon, CalendarIcon, DownloadIcon, GearIcon, SyncIcon
} from './icons';

// 'layout' remains in the union for SECTION_META / legacy hashes, but is not
// in SECTIONS. Orphan #/layout and #/segments alias to Devices (AppShell).
// Per-controller Segments stay under device detail; no top-level Layout nav.
export type SectionKey =
  'layout' | 'devices' | 'themes' | 'schedule' | 'sync' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

/** The nav sections. Order here is render order in both navs. */
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
