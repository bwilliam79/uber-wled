import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addSchedule, applyControl, deleteSchedule, updateSchedule, getSegmentsSnapshot,
  type CustomTheme, type Schedule, type Target
} from '../../api/client';
import { useControllers, useGroups, useSchedules, useThemes } from '../../api/queries';
import { useLiveStatus } from '../../api/live';
import { Modal } from '../../components/ui/Modal';
import { Toggle } from '../../components/ui/Toggle';
import { PlusIcon, TrashIcon } from '../../components/icons';
import { WeeklyScheduleForm, type WeeklyScheduleDraft } from './WeeklyScheduleForm';
import type { TargetValue } from './TargetPicker';

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

/** The left-hand time cell: a big mono clock for time-of-day rules, else a
 *  small label (sunrise/sunset ± offset, or a cron expression). */
function timeParts(s: Schedule): { big?: string; small?: string } {
  if (s.timeOfDay) return { big: s.timeOfDay };
  if (s.triggerType === 'sunrise' || s.triggerType === 'sunset') {
    const off = s.offsetMinutes;
    const sign = off > 0 ? `+${off}` : off < 0 ? `${off}` : '';
    return { small: `${s.triggerType}${sign ? ` ${sign}m` : ''}` };
  }
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
  const groups = useGroups();
  const controllers = useControllers();
  const live = useLiveStatus((controllers.data ?? []).map((c) => c.id));
  const themes = useThemes();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
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
    const theme = themeFor(nextDraft);
    const targets = targetsOf(nextDraft.target);
    if (!theme || targets.length === 0) return;
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

  async function handleApprove() {
    if (!draft) return;
    if (!(await revertToSnapshot())) return;
    const created = await addSchedule({
      name: draft.name, triggerType: 'weekly', cronExpr: null,
      daysOfWeek: draft.daysOfWeek, timeOfDay: draft.timeOfDay, offsetMinutes: 0,
      latitude: null, longitude: null, ...draft.target,
      actionType: draft.actionType, actionPayload: draft.actionPayload, enabled: true
    });
    queryClient.setQueryData<Schedule[]>(['schedules'], (prev) => [...(prev ?? []), created]);
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

  function handleModalClose() {
    if (draft) void handleDiscard();
    setFormOpen(false);
  }

  function targetLabel(s: Schedule): string {
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

  function themeName(s: Schedule): string {
    const themeId = (s.actionPayload as { themeId?: string } | null)?.themeId;
    return (themes.data ?? []).find((t) => t.id === themeId)?.name ?? themeId ?? '—';
  }

  const canAdd = !!groups.data && !!themes.data;

  return (
    <div className="schedules-manager">
      {revertError && <div className="error-banner" role="alert">{revertError}</div>}
      {schedules.data && schedules.data.length === 0 && (
        <p className="empty-state">No schedules yet.</p>
      )}
      {schedules.data && schedules.data.length > 0 && (
        <ul className="schedule-list">
          {schedules.data.map((s) => {
            const t = timeParts(s);
            return (
              <li key={s.id} className={`schedule-row${s.enabled ? '' : ' disabled'}`}>
                <div className="schedule-row-time ui-mono">
                  {t.big
                    ? <span className="schedule-row-time-big">{t.big}</span>
                    : <span className="schedule-row-time-small">{t.small}</span>}
                </div>
                <div className="schedule-row-divider" aria-hidden="true" />
                <button
                  type="button"
                  className="schedule-row-main"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => setEditingSchedule(s)}
                >
                  <span className="schedule-row-name">{s.name}</span>
                  <span className="schedule-row-sub">
                    {daysLabel(s)} · {s.actionType === 'theme' ? themeName(s) : s.actionType} · {targetLabel(s)}
                  </span>
                </button>
                <Toggle
                  checked={s.enabled}
                  onChange={(checked) => toggleEnabled(s, checked)}
                  label={`${s.name} enabled`}
                  showLabel={false}
                />
                <button
                  type="button"
                  className="schedule-row-remove"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => handleDelete(s.id)}
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
      <Modal open={formOpen} title="New weekly schedule" onClose={handleModalClose}>
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
    </div>
  );
}
