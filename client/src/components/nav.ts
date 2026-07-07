import type { ReactElement } from 'react';
import {
  HomeIcon, GridIcon, ChipIcon, PaletteIcon, CalendarIcon, DownloadIcon, GearIcon, SyncIcon
} from './icons';

export type SectionKey =
  'home' | 'layout' | 'devices' | 'themes' | 'schedule' | 'sync' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

/** The eight sections of the IA (Sync added post-1.0). Order here is render
 *  order in both navs. */
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'layout', label: 'Layout', Icon: GridIcon },
  { key: 'devices', label: 'Devices', Icon: ChipIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'sync', label: 'Sync', Icon: SyncIcon },
  { key: 'firmware', label: 'Firmware', Icon: DownloadIcon },
  { key: 'settings', label: 'Settings', Icon: GearIcon }
];
