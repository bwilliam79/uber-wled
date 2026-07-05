export type DeviceTab = 'info' | 'segments' | 'presets' | 'config' | 'update';

export const DEVICE_TABS: DeviceTab[] = ['info', 'segments', 'presets', 'config', 'update'];

export interface DevicesRoute {
  controllerId: string | null;
  tab: DeviceTab;
}

/** BINDING (master + Phase H): #/devices, #/devices/<id>, #/devices/<id>/<tab>. */
export function parseDevicesHash(hash: string): DevicesRoute {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const controllerId = parts[1] ?? null;
  const tab = (DEVICE_TABS as string[]).includes(parts[2] ?? '') ? (parts[2] as DeviceTab) : 'info';
  return { controllerId, tab };
}

export function deviceHash(controllerId: string, tab: DeviceTab = 'info'): string {
  return tab === 'info' ? `#/devices/${controllerId}` : `#/devices/${controllerId}/${tab}`;
}
