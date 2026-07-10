import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addSchedule, applyControl, deleteSchedule, updateSchedule, getSegmentsSnapshot,
  addCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  type CustomTheme, type Schedule, type CalendarEvent, type TriggerTime, type Target
} from '../../api/client';
import { useControllers, useGroups, useSchedules, useThemes, useCalendarEvents } from '../../api/queries';
import { useLiveStatus } from '../../api/live';
import { resolveDate } from '../../lib/dateRules';
import { Modal } from '../../components/ui/Modal';
import { Toggle } from '../../components/ui/Toggle';
import { PlusIcon, TrashIcon } from '../../components/icons';
import { WeeklyScheduleForm, type WeeklyScheduleDraft } from './WeeklyScheduleForm';
import { CalendarEventForm } from './CalendarEventForm';
import type { TargetValue } from './TargetPicker';

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A trigger time → the row's mono time cell (fixed clock or sun ± offset). */
function triggerTimeParts(t: TriggerTime): { big?: string; small?: string } {
  if (t.type === 'fixed') return { big: t.time };
  const sign = t.offsetMinutes > 0 ? `+${t.offsetMinutes}` : t.offsetMinutes < 0 ? `${t.offsetMinutes}` : '';
  return { small: `${t.type}${sign ? ` ${sign}m` : ''}` };
}

/** A calendar event's date → "Nov 26" (resolves computed rules for this year). */
function eventDateLabel(e: CalendarEvent): string {
  const r = resolveDate(e.dateRule, new Date().getFullYear());
  return r ? `${MONTH_ABBR[r.month - 1]} ${r.day}` : 'date';
}

/** Human day summary for a schedule row: "Every day" / "Weekdays" / "Weekends"
 *  / "Mon Wed Fri", or the trigger type for non-weekly rules. */
function daysLabel(s: Schedule): string {
  const days = s.daysOfWeek;
  if (!days || days.length === 0) {
    // sunrise/sunset with no day filter fire daily; the time cell already
    // names the trigger, so don't repeat it here.
    return s.triggerType === 'weekly' ? 'No days' : 'Every day';
  }
  if (days.length === 7) return 'Every day';
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return [...days].sort((a, b) => a - b).map((d) => DAY_ABBR[d] ?? d).join(' ');
}

/** Short "off …" tag for an optional paired power-off, or null. */
function offLabel(s: { offTrigger?: TriggerTime | null }): string | null {
  const o = s.offTrigger;
  if (!o) return null;
  if (o.type === 'fixed') return `off ${o.time}`;
  const sign = o.offsetMinutes > 0 ? `+${o.offsetMinutes}` : o.offsetMinutes < 0 ? `${o.offsetMinutes}` : '';
  return `off ${o.type}${sign ? ` ${sign}m` : ''}`;
}

/** The left-hand time cell: a big mono clock for time-of-day rules, else a
 *  small label (sunrise/sunset ± offset, or a cron expression). */
function timeParts(s: Schedule): { big?: string; small?: string } {
  // Sun-based triggers fire at the solar event, so a leftover timeOfDay is
  // irrelevant — always label them sunrise/sunset (± offset), not a clock.
  if (s.triggerType === 'sunrise' || s.triggerType === 'sunset') {
    const off = s.offsetMinutes;
    const sign = off > 0 ? `+${off}` : off < 0 ? `${off}` : '';
    return { small: `${s.triggerType}${sign ? ` ${sign}m` : ''}` };
  }
  if (s.timeOfDay) return { big: s.timeOfDay };
  if (s.cronExpr) return { small: s.cronExpr };
  return { small: s.triggerType };
}

interface MemberSnapshot {
  controllerId: string;
  wledSegId: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: number[][];
}

function targetsOf(t: TargetValue): Target[] {
  if (t.controllers && t.controllers.length > 0) {
    return t.controllers.map((c) =>
      c.wledSegId === null
        ? { kind: 'controller', controllerId: c.controllerId }
        : { kind: 'segment', controllerId: c.controllerId, wledSegId: c.wledSegId }
    );
  }
  if (t.groupId) return [{ kind: 'group', groupId: t.groupId }];
  return [];
}

export function ScheduleManager() {
  const schedules = useSchedules();
  const events = useCalendarEvents();
  const groups = useGroups();
  const controllers = useControllers();
  const live = useLiveStatus((controllers.data ?? []).map((c) => c.id));
  const themes = useThemes();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [draft, setDraft] = useState<WeeklyScheduleDraft | null>(null);
  const [snapshot, setSnapshot] = useState<MemberSnapshot[] | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  function themeFor(d: WeeklyScheduleDraft): CustomTheme | undefined {
    const themeId = (d.actionPayload as { themeId?: string })?.themeId;
    return (themes.data ?? []).find((t) => t.id === themeId);
  }

  async function membersFor(target: TargetValue): Promise<{ controllerId: string; wledSegId: number }[]> {
    if (target.controllers && target.controllers.length > 0) {
      const members: { controllerId: string; wledSegId: number }[] = [];
      for (const c of target.controllers) {
        if (c.wledSegId !== null) {
          members.push({ controllerId: c.controllerId, wledSegId: c.wledSegId });
        } else {
          const segs = await getSegmentsSnapshot(c.controllerId);
          members.push(...segs.map((s) => ({ controllerId: c.controllerId, wledSegId: s.id })));
        }
      }
      return members;
    }
    if (target.groupId) {
      return (groups.data ?? []).find((g) => g.id === target.groupId)?.members ?? [];
    }
    return [];
  }

  async function handlePreview(nextDraft: WeeklyScheduleDraft) {
    const targets = targetsOf(nextDraft.target);
    if (targets.length === 0) return;
    const theme = themeFor(nextDraft);
    // A "turn off" (or a themeless) schedule has nothing to preview against the
    // real lights — go straight to a confirmable draft without touching them.
    if (nextDraft.actionType !== 'theme' || !theme) {
      setSnapshot(null);
      setDraft(nextDraft);
      setRevertError(null);
      return;
    }
    const members = await membersFor(nextDraft.target);
    const snapshots: MemberSnapshot[] = [];
    for (const member of members) {
      const segs = await getSegmentsSnapshot(member.controllerId);
      const seg = segs.find((s) => s.id === member.wledSegId);
      if (seg) {
        snapshots.push({
          controllerId: member.controllerId, wledSegId: member.wledSegId,
          on: seg.on, bri: seg.bri, fx: seg.fx, pal: seg.pal, col: seg.col
        });
      }
    }
    setSnapshot(snapshots);
    setDraft(nextDraft);
    setRevertError(null);
    await applyControl(
      targets,
      {
        on: true,
        bri: theme.brightness,
        seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors, sx: theme.speed, ix: theme.intensity }
      }
    );
  }

  /**
   * Reverts every previewed member to its snapshot. A revert failure must
   * surface as a visible error rather than silently leaving lights in the
   * previewed state; applyControl never throws for per-target failures,
   * so results are checked for ok: false explicitly.
   */
  async function revertToSnapshot(): Promise<boolean> {
    if (!snapshot) return true;
    const failures: string[] = [];
    for (const s of snapshot) {
      const { results } = await applyControl(
        [{ kind: 'segment', controllerId: s.controllerId, wledSegId: s.wledSegId }],
        { seg: { on: s.on, bri: s.bri, fxId: s.fx, palId: s.pal, col: s.col } }
      );
      for (const r of results) {
        if (!r.ok) {
          failures.push(`${r.controllerId}/${r.wledSegId ?? 'all'}: ${r.error ?? 'unknown error'}`);
        }
      }
    }
    if (failures.length > 0) {
      setRevertError(
        `Failed to revert some lights to their pre-preview state — they may still be showing the previewed look: ${failures.join('; ')}`
      );
      return false;
    }
    return true;
  }

  // The recurring trigger fields → a calendar-event TriggerTime ('weekly' means
  // a fixed time-of-day).
  function draftTriggerTime(d: WeeklyScheduleDraft): TriggerTime {
    return d.triggerType === 'weekly'
      ? { type: 'fixed', time: d.timeOfDay ?? '18:00' }
      : { type: d.triggerType, offsetMinutes: d.offsetMinutes };
  }

  async function handleApprove() {
    if (!draft) return;
    if (!(await revertToSnapshot())) return;
    if (draft.repeat === 'date') {
      const created = await addCalendarEvent({
        name: draft.name, category: 'custom',
        dateRule: { kind: 'fixed', month: draft.month, day: draft.day },
        recursYearly: true, enabled: true,
        ...draft.target,
        triggerTime: draftTriggerTime(draft), offTrigger: draft.offTrigger,
        actionType: draft.actionType, actionPayload: draft.actionPayload
      });
      queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prev) => [...(prev ?? []), created]);
    } else {
      const created = await addSchedule({
        name: draft.name, triggerType: draft.triggerType, cronExpr: null,
        daysOfWeek: draft.daysOfWeek, timeOfDay: draft.timeOfDay, offsetMinutes: draft.offsetMinutes,
        latitude: null, longitude: null, ...draft.target,
        actionType: draft.actionType, actionPayload: draft.actionPayload,
        offTrigger: draft.offTrigger, enabled: true
      });
      queryClient.setQueryData<Schedule[]>(['schedules'], (prev) => [...(prev ?? []), created]);
    }
    setDraft(null);
    setSnapshot(null);
    setFormOpen(false);
  }

  async function handleDiscard() {
    if (!(await revertToSnapshot())) return;
    setDraft(null);
    setSnapshot(null);
  }

  async function handleDelete(id: string) {
    await deleteSchedule(id);
    queryClient.setQueryData<Schedule[]>(['schedules'], (prev) =>
      (prev ?? []).filter((s) => s.id !== id)
    );
  }

  async function toggleEnabled(s: Schedule, enabled: boolean) {
    const updated = await updateSchedule(s.id, { enabled });
    queryClient.setQueryData<Schedule[]>(['schedules'], (prev) =>
      (prev ?? []).map((x) => (x.id === s.id ? updated : x))
    );
  }

  async function toggleEvent(e: CalendarEvent, enabled: boolean) {
    const updated = await updateCalendarEvent(e.id, { enabled });
    queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prev) =>
      (prev ?? []).map((x) => (x.id === e.id ? updated : x))
    );
  }
  async function deleteEvent(id: string) {
    await deleteCalendarEvent(id);
    queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prev) =>
      (prev ?? []).filter((e) => e.id !== id)
    );
  }

  function handleModalClose() {
    if (draft) void handleDiscard();
    setFormOpen(false);
  }

  function targetLabel(s: Pick<Schedule, 'controllers' | 'groupId'>): string {
    if (s.controllers && s.controllers.length > 0) {
      const names = s.controllers.map((c) => {
        const name = live.get(c.controllerId)?.info?.name
          || (controllers.data ?? []).find((ctrl) => ctrl.id === c.controllerId)?.name
          || c.controllerId;
        return c.wledSegId === null ? name : `${name} (segment ${c.wledSegId})`;
      });
      return `Controller${names.length > 1 ? 's' : ''} ${names.join(', ')}`;
    }
    const group = (groups.data ?? []).find((g) => g.id === s.groupId);
    return `Group ${group?.name ?? '—'}`;
  }

  function themeName(s: { actionPayload: unknown }): string {
    const themeId = (s.actionPayload as { themeId?: string } | null)?.themeId;
    return (themes.data ?? []).find((t) => t.id === themeId)?.name ?? themeId ?? '—';
  }
  // Action label shared by both row kinds (theme name, or the raw action).
  function actionLabel(s: { actionType: string | null; actionPayload: unknown }): string {
    return s.actionType === 'theme' ? themeName(s) : (s.actionType ?? 'action');
  }

  const canAdd = !!groups.data && !!themes.data;

  return (
    <div className="schedules-manager">
      {revertError && <div className="error-banner" role="alert">{revertError}</div>}
      {(schedules.data?.length ?? 0) + (events.data?.length ?? 0) === 0 && (
        <p className="empty-state">No schedules yet.</p>
      )}
      {(schedules.data?.length ?? 0) + (events.data?.length ?? 0) > 0 && (
        <ul className="schedule-list">
          {(schedules.data ?? []).map((s) => {
            const t = timeParts(s);
            return (
              <li key={`s:${s.id}`} className={`schedule-row${s.enabled ? '' : ' disabled'}`}>
                <div className="schedule-row-time ui-mono">
                  {t.big
                    ? <span className="schedule-row-time-big">{t.big}</span>
                    : <span className="schedule-row-time-small">{t.small}</span>}
                </div>
                <div className="schedule-row-divider" aria-hidden="true" />
                <button
                  type="button" className="schedule-row-main"
                  aria-label={`Edit ${s.name}`} onClick={() => setEditingSchedule(s)}
                >
                  <span className="schedule-row-name">{s.name}</span>
                  <span className="schedule-row-sub">
                    {daysLabel(s)} · {actionLabel(s)}
                    {offLabel(s) && ` · ${offLabel(s)}`} · {targetLabel(s)}
                  </span>
                </button>
                <Toggle
                  checked={s.enabled} onChange={(checked) => toggleEnabled(s, checked)}
                  label={`${s.name} enabled`} showLabel={false}
                />
                <button
                  type="button" className="schedule-row-remove"
                  aria-label={`Remove ${s.name}`} onClick={() => handleDelete(s.id)}
                >
                  <TrashIcon className="schedule-row-remove-icon" />
                </button>
              </li>
            );
          })}
          {(events.data ?? []).map((e) => {
            const t = triggerTimeParts(e.triggerTime);
            return (
              <li key={`e:${e.id}`} className={`schedule-row${e.enabled ? '' : ' disabled'}`}>
                <div className="schedule-row-time ui-mono">
                  {t.big
                    ? <span className="schedule-row-time-big">{t.big}</span>
                    : <span className="schedule-row-time-small">{t.small}</span>}
                </div>
                <div className="schedule-row-divider" aria-hidden="true" />
                <button
                  type="button" className="schedule-row-main"
                  aria-label={`Edit ${e.name}`} onClick={() => setEditingEvent(e)}
                >
                  <span className="schedule-row-name">{e.name}</span>
                  <span className="schedule-row-sub">
                    {eventDateLabel(e)} · {actionLabel(e)}
                    {offLabel(e) && ` · ${offLabel(e)}`} · {targetLabel(e)}
                  </span>
                </button>
                <Toggle
                  checked={e.enabled} onChange={(checked) => toggleEvent(e, checked)}
                  label={`${e.name} enabled`} showLabel={false}
                />
                <button
                  type="button" className="schedule-row-remove"
                  aria-label={`Remove ${e.name}`} onClick={() => deleteEvent(e.id)}
                >
                  <TrashIcon className="schedule-row-remove-icon" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="schedule-add-row"
        disabled={!canAdd}
        onClick={() => setFormOpen(true)}
      >
        <PlusIcon className="schedule-add-icon" /> New schedule
      </button>
      <Modal open={formOpen} title="New schedule" onClose={handleModalClose}>
        <WeeklyScheduleForm
          groups={groups.data ?? []}
          controllers={controllers.data ?? []}
          live={live}
          themes={themes.data ?? []}
          onPreview={handlePreview}
          onApprove={handleApprove}
          onDiscard={handleDiscard}
          previewing={draft !== null}
        />
      </Modal>
      <Modal
        open={editingSchedule !== null}
        title="Edit weekly schedule"
        onClose={() => setEditingSchedule(null)}
      >
        {editingSchedule && (
          <WeeklyScheduleForm
            groups={groups.data ?? []}
            controllers={controllers.data ?? []}
            live={live}
            themes={themes.data ?? []}
            initialSchedule={editingSchedule}
            onSaved={(saved) => {
              queryClient.setQueryData<Schedule[]>(['schedules'], (prev) =>
                (prev ?? []).map((existing) => (existing.id === saved.id ? saved : existing))
              );
              setEditingSchedule(null);
            }}
            onPreview={() => {}}
            onApprove={() => {}}
            onDiscard={() => {}}
            previewing={false}
          />
        )}
      </Modal>
      <Modal
        open={editingEvent !== null}
        size="lg"
        title={editingEvent?.category === 'holiday' ? 'Edit holiday' : 'Edit dated schedule'}
        onClose={() => setEditingEvent(null)}
      >
        {editingEvent && (
          <CalendarEventForm
            groups={groups.data ?? []}
            controllers={controllers.data ?? []}
            live={live}
            themes={themes.data ?? []}
            initialEvent={editingEvent}
            onSaved={(saved) => {
              queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prev) =>
                (prev ?? []).map((existing) => (existing.id === saved.id ? saved : existing))
              );
              setEditingEvent(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
