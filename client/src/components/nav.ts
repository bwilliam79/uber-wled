import type { ReactElement } from 'react';
import {
  HomeIcon, GridIcon, ChipIcon, PaletteIcon, CalendarIcon, DownloadIcon, GearIcon
} from './icons';

export type SectionKey = 'home' | 'layout' | 'devices' | 'themes' | 'schedule' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

/** The seven sections of the 1.0 IA. Order here is render order in both navs. */
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'layout', label: 'Layout', Icon: GridIcon },
  { key: 'devices', label: 'Devices', Icon: ChipIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'firmware', label: 'Firmware', Icon: DownloadIcon },
  { key: 'settings', label: 'Settings', Icon: GearIcon }
];
