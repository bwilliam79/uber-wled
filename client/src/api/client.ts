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
  | { type: 'theme'; themeId: string };

export interface Floorplan {
  id: string;
  name: string;
  imagePath: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  zoom: number;
}

export interface Placement {
  id: string;
  floorplanId: string;
  controllerId: string;
  wledSegId: number;
  points: { x: number; y: number }[];
  lengthMeters: number | null;
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

export const listSchedules = () => getJson<Schedule[]>('/api/schedules');
export const addSchedule = (input: Omit<Schedule, 'id'>) =>
  sendJson<Schedule>('/api/schedules', 'POST', input);
export const deleteSchedule = (id: string) => fetch(`/api/schedules/${id}`, { method: 'DELETE' });

export const applyControl = (members: GroupMember[], action: ControlAction) =>
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
  installedVersion: string;
  latestTag: string;
  updateAvailable: boolean;
  pinnedAssetPattern: string | null;
  candidateAssets: { name: string; downloadUrl: string }[];
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

export const listFloorplans = () => getJson<Floorplan[]>('/api/floorplans');

export async function uploadFloorplan(name: string, file: File): Promise<Floorplan> {
  const form = new FormData();
  form.append('name', name);
  form.append('image', file);
  const res = await fetch('/api/floorplans', { method: 'POST', body: form });
  if (!res.ok) throw new Error('upload failed');
  return res.json();
}

export const updateFloorplan = (id: string, patch: Partial<Omit<Floorplan, 'id' | 'imagePath'>>) =>
  sendJson<Floorplan>(`/api/floorplans/${id}`, 'PATCH', patch);

export const listPlacements = (floorplanId: string) =>
  getJson<Placement[]>(`/api/floorplans/${floorplanId}/placements`);

export const addPlacement = (
  floorplanId: string,
  input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; lengthMeters: number | null }
) => sendJson<{ placement: Placement; recommendations: unknown[] }>(
  `/api/floorplans/${floorplanId}/placements`, 'POST', input
);

export const deletePlacement = (floorplanId: string, id: string) =>
  fetch(`/api/floorplans/${floorplanId}/placements/${id}`, { method: 'DELETE' });
