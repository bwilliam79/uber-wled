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
  /** WLED effect speed (0–255). */
  speed: number;
  /** WLED effect intensity (0–255). */
  intensity: number;
}

export interface WledPreset {
  id: number;
  name: string;
}

export interface ScheduleControllerTarget {
  controllerId: string;
  /** null = whole-controller target (every segment). */
  wledSegId: number | null;
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
  /** Exactly one of groupId / controllers (non-empty) is set — a schedule
   *  targets either a Room group or a list of specific controllers
   *  directly, no group required. */
  groupId: string | null;
  controllers: ScheduleControllerTarget[] | null;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  /** Optional paired power-off: fires on the same active days at this trigger
   *  time (fixed clock or sunrise/sunset ± offset). null = no auto-off. */
  offTrigger: TriggerTime | null;
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
  /** Exactly one of groupId / controllers (non-empty) is set — see the
   *  same note on Schedule.groupId above. */
  groupId: string | null;
  controllers: ScheduleControllerTarget[] | null;
  triggerTime: TriggerTime;
  /** Optional OFF trigger — when set, the target is powered off at this time,
   *  independent of triggerTime (e.g. on at sunset, off at a fixed time). */
  offTrigger?: TriggerTime | null;
  actionType: 'power' | 'brightness' | 'preset' | 'theme' | null;
  actionPayload: unknown;
}

export type TriggerTime =
  | { type: 'fixed'; time: string }
  | { type: 'sunset' | 'sunrise'; offsetMinutes: number };

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
  if (!res.ok) {
    // Prefer the server's { error } body when present — otherwise every
    // 4xx (sync-member conflicts, validation, free-bit exhaustion…)
    // collapses to the same opaque "METHOD /url failed" toast.
    let message = `${method} ${url} failed`;
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
        message = parsed.error;
      }
    } catch {
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }
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
export const updateTheme = (id: string, input: Omit<CustomTheme, 'id'>) =>
  sendJson<CustomTheme>(`/api/themes/${id}`, 'PUT', input);
export const deleteTheme = (id: string) => fetch(`/api/themes/${id}`, { method: 'DELETE' });

// --- Import themes from a controller's WLED device presets ---
export interface PresetImportCandidate {
  presetId: number;
  theme: Omit<CustomTheme, 'id'>;
  /** 'new' = no theme by this name; 'duplicate' = same name + same config
   *  (already imported); 'conflict' = same name, different config. */
  status: 'new' | 'duplicate' | 'conflict';
  existingThemeId?: string;
}
export interface PresetImportPreview {
  candidates: PresetImportCandidate[];
  skipped: { presetId: number; name: string; reason: string }[];
}
/** Resolved import instruction: overwriteThemeId set = overwrite that theme;
 *  otherwise create a new theme (rename via a changed name). */
export interface PresetImportInstruction extends Omit<CustomTheme, 'id'> {
  overwriteThemeId?: string | null;
}

export const getPresetImportPreview = (controllerId: string) =>
  getJson<PresetImportPreview>(`/api/themes/preset-import/${controllerId}`);
export const applyPresetImport = (imports: PresetImportInstruction[]) =>
  sendJson<{ created: number; overwritten: number }>('/api/themes/preset-import', 'POST', { imports });

// --- Backup / export / import ---
// Downloads are plain GETs to these URLs (the server sets a Content-Disposition
// filename); the UI hands them to triggerDownload(). Imports POST the parsed
// file back and surface the server's validation message on failure.
export const BACKUP_URL = '/api/backup';
export const THEMES_EXPORT_URL = '/api/backup/themes';
export const SCHEDULES_EXPORT_URL = '/api/backup/schedules';

async function postImport<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const parsed = await res.json();
      if (parsed?.error) message = parsed.error;
    } catch {
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }
  return res.json();
}

export const restoreBackupFile = (data: unknown) =>
  postImport<{ restored: Record<string, number> }>(BACKUP_URL + '/restore', data);

export interface AutoBackupEntry { name: string; size: number; createdAt: string }
export const listAutoBackups = () => getJson<AutoBackupEntry[]>(BACKUP_URL + '/auto');
export const autoBackupUrl = (name: string) => `${BACKUP_URL}/auto/${encodeURIComponent(name)}`;
export const restoreAutoBackup = (name: string) =>
  sendJson<{ restored: Record<string, number> }>(`${BACKUP_URL}/auto/${encodeURIComponent(name)}/restore`, 'POST', {});
export const importThemesFile = (data: unknown) =>
  postImport<{ imported: number }>(THEMES_EXPORT_URL, data);
export const importSchedulesFile = (data: unknown) =>
  postImport<{ schedules: number; calendarEvents: number; skipped: number }>(SCHEDULES_EXPORT_URL, data);
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
export const updateSchedule = (id: string, patch: Partial<Omit<Schedule, 'id'>>) =>
  sendJson<Schedule>(`/api/schedules/${id}`, 'PATCH', patch);
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
  /** The plain, unspecialized build's filename when the chip arch is
   *  unambiguous about it (e.g. "ESP32" over "ESP32_HUB75"), so the picker
   *  can pre-highlight the correct choice for ordinary boards — null when
   *  no such safe default exists (e.g. esp8266's genuinely different
   *  flash-size variants), in which case the picker shows an unranked list. */
  recommendedAssetName?: string | null;
  /** Raw WLED-reported chip architecture (e.g. "esp32"), null when the
   *  controller is unreachable and nothing was detected yet. */
  detectedArch: string | null;
  unreachable?: boolean;
}

export const getFirmwareStatus = (controllerId: string) =>
  getJson<FirmwareStatus>(`/api/controllers/${controllerId}/firmware`);

export async function pinFirmwareAsset(controllerId: string, assetPattern: string): Promise<void> {
  // Can't use sendJson here — POST /pin returns 204 with no body, and
  // sendJson always calls res.json(), which throws on an empty response.
  // This used a bare fetch() to dodge that, but dropped the .ok check in
  // the process — a failed pin (of any kind) silently looked like success,
  // so the caller closed the picker and moved on with nothing actually
  // pinned, and the Update button never appeared with no visible error.
  const res = await fetch(`/api/controllers/${controllerId}/firmware/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetPattern })
  });
  if (!res.ok) throw new Error(`failed to pin firmware asset: ${res.status}`);
}

export const pushFirmwareUpdate = (controllerId: string) =>
  sendJson<{ ok: boolean; installedVersion?: string; error?: string }>(
    `/api/controllers/${controllerId}/firmware/update`, 'POST'
  );

/** Passive check for a newer uber-wled release upstream — the app itself,
 *  not device firmware. There's no in-place update; the user pulls and
 *  rebuilds. `latestVersion` is null when the upstream check has never
 *  succeeded (e.g. offline install). */
export interface AppUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  repoUrl: string;
}

export const getAppUpdateStatus = () => getJson<AppUpdateStatus>('/api/app-update');

/** The deployed server's version — polled to detect when a long-open SPA tab
 *  is running an out-of-date bundle after a deploy. */
export const getServerVersion = () => getJson<{ version: string }>('/api/version');

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
