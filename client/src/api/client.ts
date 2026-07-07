export interface Controller {
  id: string;
  name: string;
  host: string;
  source: 'discovered' | 'manual';
  stale: boolean;
  pinnedAssetPattern: string | null;
}

export interface GroupMember {
  controllerId: string;
  wledSegId: number;
}

export interface Group {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  members: GroupMember[];
}

/** Distinct from Group (rooms, above) — a sync group has no bearing on Home
 *  layout; it's a set of controllers wired together via WLED's own native
 *  UDP sync so their effects/colors play in lockstep, managed entirely
 *  through this app instead of each device's own settings page. */
export interface SyncGroup {
  id: string;
  name: string;
  active: boolean;
  bitmask: number | null;
  memberControllerIds: string[];
}

export interface SyncMemberResult {
  controllerId: string;
  ok: boolean;
  error?: string;
}

export interface CustomTheme {
  id: string;
  name: string;
  effect: number;
  palette: number;
  colors: number[][];
  brightness: number;
}

export interface WledPreset {
  id: number;
  name: string;
}

export interface Schedule {
  id: string;
  name: string;
  triggerType: 'cron' | 'sunrise' | 'sunset' | 'weekly';
  cronExpr: string | null;
  daysOfWeek: number[] | null;
  timeOfDay: string | null;
  offsetMinutes: number;
  latitude: number | null;
  longitude: number | null;
  groupId: string;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  enabled: boolean;
}

export type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nthWeekday'; month: number; weekday: number; n: number }
  | { kind: 'lastWeekday'; month: number; weekday: number }
  | { kind: 'easterOffset'; offsetDays: number }
  | { kind: 'oneOff'; year: number; month: number; day: number };

export interface CalendarEvent {
  id: string;
  name: string;
  category: 'holiday' | 'custom';
  dateRule: DateRule;
  recursYearly: boolean;
  enabled: boolean;
  groupId: string | null;
  triggerTime: { type: 'fixed'; time: string } | { type: 'sunset' | 'sunrise'; offsetMinutes: number };
  actionType: 'power' | 'brightness' | 'preset' | 'theme' | null;
  actionPayload: unknown;
}

export class ConflictError extends Error {
  conflict: { id: string; name: string; month: number; day: number };

  constructor(message: string, conflict: { id: string; name: string; month: number; day: number }) {
    super(message);
    this.conflict = conflict;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed`);
  return res.json();
}

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${method} ${url} failed`);
  return res.json();
}

export const listControllers = () => getJson<Controller[]>('/api/controllers');
export const addController = (name: string, host: string) =>
  sendJson<Controller>('/api/controllers', 'POST', { name, host });
export const deleteController = (id: string) =>
  fetch(`/api/controllers/${id}`, { method: 'DELETE' });

export const importSchedules = (controllerId: string, disableOnDevice: boolean) =>
  sendJson<{ imported: Schedule[]; skipped: { raw: unknown; reason: string }[] }>(
    `/api/controllers/${controllerId}/import-schedules`, 'POST', { disableOnDevice }
  );

export const listGroups = () => getJson<Group[]>('/api/groups');
export const addGroup = (name: string, members: GroupMember[], icon?: string | null) =>
  sendJson<Group>('/api/groups', 'POST', { name, members, icon: icon ?? null });
export const updateGroup = (
  id: string,
  patch: { name?: string; members?: GroupMember[]; icon?: string | null }
) => sendJson<Group>(`/api/groups/${id}`, 'PATCH', patch);
export const reorderGroups = (ids: string[]) =>
  sendJson<Group[]>('/api/groups/reorder', 'POST', { ids });
export const deleteGroup = (id: string) => fetch(`/api/groups/${id}`, { method: 'DELETE' });

export const listSyncGroups = () => getJson<SyncGroup[]>('/api/sync-groups');
export const addSyncGroup = (name: string, memberControllerIds: string[]) =>
  sendJson<SyncGroup>('/api/sync-groups', 'POST', { name, memberControllerIds });
export const renameSyncGroup = (id: string, name: string) =>
  sendJson<SyncGroup>(`/api/sync-groups/${id}`, 'PATCH', { name });
export const setSyncGroupMembers = (id: string, memberControllerIds: string[]) =>
  sendJson<SyncGroup>(`/api/sync-groups/${id}`, 'PATCH', { memberControllerIds });
export const deleteSyncGroup = (id: string) => fetch(`/api/sync-groups/${id}`, { method: 'DELETE' });
export const activateSyncGroup = (id: string) =>
  sendJson<{ group: SyncGroup; results: SyncMemberResult[] }>(`/api/sync-groups/${id}/activate`, 'POST');
export const deactivateSyncGroup = (id: string) =>
  sendJson<{ group: SyncGroup; results: SyncMemberResult[] }>(`/api/sync-groups/${id}/deactivate`, 'POST');

export const listThemes = () => getJson<CustomTheme[]>('/api/themes');
export const addTheme = (input: Omit<CustomTheme, 'id'>) =>
  sendJson<CustomTheme>('/api/themes', 'POST', input);
export const deleteTheme = (id: string) => fetch(`/api/themes/${id}`, { method: 'DELETE' });
export const listPresets = (controllerId: string) =>
  getJson<WledPreset[]>(`/api/themes/presets/${controllerId}`);

export interface EffectsPalettes {
  effects: string[];
  palettes: string[];
  sourceControllerId: string | null;
  sourceControllerName: string | null;
}

export const getEffectsPalettes = () => getJson<EffectsPalettes>('/api/themes/effects-palettes');

export const listSchedules = () => getJson<Schedule[]>('/api/schedules');
export const addSchedule = (input: Omit<Schedule, 'id'>) =>
  sendJson<Schedule>('/api/schedules', 'POST', input);
export const deleteSchedule = (id: string) => fetch(`/api/schedules/${id}`, { method: 'DELETE' });

export const listCalendarEvents = () => getJson<CalendarEvent[]>('/api/calendar-events');

async function sendCalendarEvent(
  url: string,
  method: string,
  body: unknown
): Promise<CalendarEvent> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 409) {
    const payload = await res.json();
    throw new ConflictError(payload.error, payload.conflict);
  }
  if (!res.ok) throw new Error(`${method} ${url} failed`);
  return res.json();
}

export const addCalendarEvent = (input: Omit<CalendarEvent, 'id'>) =>
  sendCalendarEvent('/api/calendar-events', 'POST', input);
export const updateCalendarEvent = (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) =>
  sendCalendarEvent(`/api/calendar-events/${id}`, 'PATCH', patch);
export const deleteCalendarEvent = (id: string) =>
  fetch(`/api/calendar-events/${id}`, { method: 'DELETE' });

export interface FirmwareStatus {
  installedVersion: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  isPrerelease: boolean;
  pinnedAssetPattern: string | null;
  candidateAssets: { name: string; downloadUrl: string }[];
  /** Raw WLED-reported chip architecture (e.g. "esp32"), null when the
   *  controller is unreachable and nothing was detected yet. */
  detectedArch: string | null;
  unreachable?: boolean;
}

export const getFirmwareStatus = (controllerId: string) =>
  getJson<FirmwareStatus>(`/api/controllers/${controllerId}/firmware`);

export const pinFirmwareAsset = (controllerId: string, assetPattern: string) =>
  fetch(`/api/controllers/${controllerId}/firmware/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetPattern })
  });

export const pushFirmwareUpdate = (controllerId: string) =>
  sendJson<{ ok: boolean; installedVersion?: string; error?: string }>(
    `/api/controllers/${controllerId}/firmware/update`, 'POST'
  );

export const getSegmentsSnapshot = (controllerId: string) =>
  getJson<{ id: number; start: number; stop: number; len: number; on: boolean; bri: number; fx: number; pal: number; col: number[][] }[]>(
    `/api/controllers/${controllerId}/segments`
  );

export interface Strip {
  id: string;
  controllerId: string;
  wledSegId: number;
  points: { x: number; y: number }[];
  label: string | null;
}

export interface RoomLabel {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface Settings {
  includePrereleaseFirmware: boolean;
  homeLatitude: number | null;
  homeLongitude: number | null;
  discoveryRescanIntervalMinutes: number;
  scheduleImportDisableOnDeviceDefault: boolean;
  controllerStatusPollIntervalMinutes: number;
  livePollIntervalSeconds: number;
}

export interface WledSegmentSnapshot {
  id: number;
  start: number;
  stop: number;
  len: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: number[][];
}

export interface ControllerStatus {
  controllerId: string;
  reachable: boolean;
  info: { name: string; ver: string; leds: { count: number }; arch: string } | null;
  state: { on: boolean; bri: number; ps: number; seg: WledSegmentSnapshot[] } | null;
  polledAt: string | null;
}

export const getControllerStatus = (controllerId: string) =>
  getJson<ControllerStatus>(`/api/controllers/${controllerId}/status`);

export const listStrips = () => getJson<Strip[]>('/api/strips');
export const addStrip = (input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label?: string | null }) =>
  sendJson<{ strip: Strip; recommendations: unknown[] }>('/api/strips', 'POST', input);
export const updateStrip = (id: string, patch: Partial<Omit<Strip, 'id'>>) =>
  sendJson<Strip>(`/api/strips/${id}`, 'PATCH', patch);
export const deleteStrip = (id: string) => fetch(`/api/strips/${id}`, { method: 'DELETE' });

export const listRoomLabels = () => getJson<RoomLabel[]>('/api/room-labels');
export const addRoomLabel = (input: { name: string; x: number; y: number }) =>
  sendJson<RoomLabel>('/api/room-labels', 'POST', input);
export const updateRoomLabel = (id: string, patch: Partial<Omit<RoomLabel, 'id'>>) =>
  sendJson<RoomLabel>(`/api/room-labels/${id}`, 'PATCH', patch);
export const deleteRoomLabel = async (id: string): Promise<void> => {
  const res = await fetch(`/api/room-labels/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /api/room-labels/${id} failed`);
};

export const getSettings = () => getJson<Settings>('/api/settings');
export const updateSettings = (patch: Partial<Settings>) => sendJson<Settings>('/api/settings', 'PATCH', patch);

export interface GeocodeMatch {
  displayName: string;
  latitude: number;
  longitude: number;
}

// Proxied through the server (not called directly from the browser) so a
// proper identifying User-Agent header can be sent to Nominatim, per its
// usage policy — see server/src/settings/geocode.ts.
export const geocodeAddress = (query: string) =>
  getJson<{ results: GeocodeMatch[] }>(`/api/settings/geocode?q=${encodeURIComponent(query)}`).then(
    (r) => r.results
  );

// --- Control surface v2 (Phase D) ---
// Mirrored verbatim from docs/superpowers/plans/2026-07-04-control-plane-redesign/00-master.md

export type Target =
  | { kind: 'controller'; controllerId: string }
  | { kind: 'segment'; controllerId: string; wledSegId: number }
  | { kind: 'group'; groupId: string };

export interface SegPatch {
  fxName?: string; fxId?: number;      // name wins if both; resolved per device
  palName?: string; palId?: number;
  col?: number[][];                    // up to 3 slots, each [r,g,b] or [r,g,b,w]
  sx?: number; ix?: number; c1?: number; c2?: number; c3?: number;
  o1?: boolean; o2?: boolean; o3?: boolean;
  cct?: number;
  on?: boolean; bri?: number;
}

export interface ControlPatch {
  on?: boolean;
  bri?: number;                        // 1-255
  transition?: number;                 // WLED units (100ms)
  ps?: number;                         // apply device preset id (device-local ids —
                                       // client restricts to single-controller selections)
  nl?: { on?: boolean; dur?: number; mode?: 0 | 1 | 2 | 3; tbri?: number };
  seg?: SegPatch;
}

export interface ApplyResult {
  controllerId: string;
  wledSegId: number | null;            // null = whole-controller target
  ok: boolean;
  error?: string;
}

export interface FxMeta {
  id: number;
  name: string;                    // from /json/eff at same index
  sliders: {                       // null = control hidden for this effect
    sx: string | null;             // '!' in fxdata → 'Effect speed'
    ix: string | null;             // '!' → 'Effect intensity'
    c1: string | null;
    c2: string | null;
    c3: string | null;
  };
  options: {                       // checkbox labels, null = hidden
    o1: string | null;
    o2: string | null;
    o3: string | null;
  };
  colorLabels: (string | null)[];  // length 3; '!' → default names Fx/Bg/Cs; null = slot unused
  usesPalette: boolean;
  flags: string[];                 // e.g. ['1'] dimensionality chars, 'v', 'f'
  defaults: Record<string, number>; // e.g. { sx: 24, m12: 0 }
}

export type PalettePreview =
  | { type: 'stops'; stops: [number, number, number, number][] } // [pos0-255, r, g, b]
  | { type: 'random' }
  | { type: 'slots'; slots: ('c1' | 'c2' | 'c3')[] };

export interface ControllerCapabilities {
  vid: number;
  effects: string[];
  palettes: string[];
  fxMeta: FxMeta[];
  palettePreviews: Record<number, PalettePreview>;
  fetchedAt: string; // ISO
}

export interface DevicePreset {
  id: number;
  name: string;
  isPlaylist: boolean;
  quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number };
}

export const applyControl = (targets: Target[], patch: ControlPatch) =>
  sendJson<{ results: ApplyResult[] }>('/api/control/apply', 'POST', { targets, patch });

export const getCapabilities = (controllerId: string) =>
  getJson<ControllerCapabilities>(`/api/controllers/${controllerId}/capabilities`);

export const listDevicePresets = (controllerId: string) =>
  getJson<{ presets: DevicePreset[] }>(`/api/controllers/${controllerId}/presets`).then((r) => r.presets);
export const rescanNow = () => sendJson<{ controllers: Controller[] }>('/api/settings/rescan', 'POST');

// ---- Devices section (Phase F) ----

export interface ConfigDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

export interface DeviceSegment {
  id: number;
  start: number;
  stop: number;
  len: number;
  grp: number;
  spc: number;
  of: number;
  on: boolean;
  bri: number;
  rev: boolean;
  mi: boolean;
  n?: string;
  fx: number;
  pal: number;
  col: number[][];
}

export interface SegmentUpdate {
  start?: number;
  stop?: number;
  grp?: number;
  spc?: number;
  of?: number;
  rev?: boolean;
  mi?: boolean;
  name?: string;
  on?: boolean;
  bri?: number;
}

export const saveControllerPreset = (
  controllerId: string,
  input: { id?: number; name: string; includeBrightness: boolean; saveSegmentBounds: boolean }
) => sendJson<{ id: number; name: string }>(`/api/controllers/${controllerId}/presets`, 'POST', input);

export const deleteControllerPreset = (controllerId: string, presetId: number) =>
  fetch(`/api/controllers/${controllerId}/presets/${presetId}`, { method: 'DELETE' });

export const getControllerConfig = (controllerId: string) =>
  getJson<Record<string, unknown>>(`/api/controllers/${controllerId}/config`);

export const dryRunControllerConfig = (controllerId: string, patch: object) =>
  sendJson<{ diff: ConfigDiffEntry[]; rebootRequired: boolean }>(
    `/api/controllers/${controllerId}/config?dryRun=1`, 'POST', { patch }
  );

export const applyControllerConfig = (controllerId: string, patch: object) =>
  sendJson<{ ok: true; rebootRequired: boolean }>(
    `/api/controllers/${controllerId}/config`, 'POST', { patch }
  );

export const rebootController = (controllerId: string) =>
  sendJson<{ ok: true }>(`/api/controllers/${controllerId}/reboot`, 'POST');

export const getControllerSegments = (controllerId: string) =>
  getJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments`);

export const updateControllerSegment = (controllerId: string, segId: number, patch: SegmentUpdate) =>
  sendJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments/${segId}`, 'PUT', patch);

export const createControllerSegment = (controllerId: string, bounds: { start: number; stop: number }) =>
  sendJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments`, 'POST', bounds);

export const deleteControllerSegment = (controllerId: string, segId: number) =>
  sendJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments/${segId}`, 'DELETE');
