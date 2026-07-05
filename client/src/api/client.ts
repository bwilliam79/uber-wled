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
  members: GroupMember[];
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

export type ControlAction =
  | { type: 'power'; on: boolean }
  | { type: 'brightness'; value: number }
  | { type: 'preset'; presetId: number }
  | { type: 'theme'; themeId: string }
  | { type: 'effect'; effectId: number };

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
export const addGroup = (name: string, members: GroupMember[]) =>
  sendJson<Group>('/api/groups', 'POST', { name, members });
export const updateGroup = (id: string, patch: { name?: string; members?: GroupMember[] }) =>
  sendJson<Group>(`/api/groups/${id}`, 'PATCH', patch);
export const deleteGroup = (id: string) => fetch(`/api/groups/${id}`, { method: 'DELETE' });

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

export const applyControlV1 = (members: GroupMember[], action: ControlAction) =>
  sendJson<{ results: { controllerId: string; wledSegId: number; ok: boolean; error?: string }[] }>(
    '/api/control/apply', 'POST', { members, action }
  );

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
export const deleteRoomLabel = (id: string) => fetch(`/api/room-labels/${id}`, { method: 'DELETE' });

export const getSettings = () => getJson<Settings>('/api/settings');
export const updateSettings = (patch: Partial<Settings>) => sendJson<Settings>('/api/settings', 'PATCH', patch);

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
