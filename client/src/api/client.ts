export interface Controller {
  id: string;
  name: string;
  host: string;
  source: 'discovered' | 'manual';
  stale: boolean;
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
