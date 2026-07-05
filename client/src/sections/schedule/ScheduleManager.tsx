import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addSchedule, applyControl, deleteSchedule, getSegmentsSnapshot,
  type CustomTheme, type Schedule
} from '../../api/client';
import { useGroups, useSchedules, useThemes } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { WeeklyScheduleForm, type WeeklyScheduleDraft } from './WeeklyScheduleForm';

interface MemberSnapshot {
  controllerId: string;
  wledSegId: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: number[][];
}

export function ScheduleManager() {
  const schedules = useSchedules();
  const groups = useGroups();
  const themes = useThemes();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<WeeklyScheduleDraft | null>(null);
  const [snapshot, setSnapshot] = useState<MemberSnapshot[] | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  function themeFor(d: WeeklyScheduleDraft): CustomTheme | undefined {
    const themeId = (d.actionPayload as { themeId?: string })?.themeId;
    return (themes.data ?? []).find((t) => t.id === themeId);
  }

  async function handlePreview(nextDraft: WeeklyScheduleDraft) {
    const theme = themeFor(nextDraft);
    if (!theme) return;
    const members =
      (groups.data ?? []).find((g) => g.id === nextDraft.groupId)?.members ?? [];
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
      [{ kind: 'group', groupId: nextDraft.groupId }],
      {
        on: true,
        bri: theme.brightness,
        seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors }
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
      latitude: null, longitude: null, groupId: draft.groupId,
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

  function handleModalClose() {
    if (draft) void handleDiscard();
    setFormOpen(false);
  }

  return (
    <Card className="schedules-card">
      <div className="schedules-card-header">
        <h3>Weekly schedules</h3>
        <Button
          variant="primary"
          disabled={!groups.data || !themes.data}
          onClick={() => setFormOpen(true)}
        >
          + New schedule
        </Button>
      </div>
      {revertError && <div className="error-banner" role="alert">{revertError}</div>}
      {schedules.data && schedules.data.length === 0 && (
        <p className="empty-state">No schedules yet.</p>
      )}
      {schedules.data && schedules.data.length > 0 && (
        <ul className="schedule-list">
          {schedules.data.map((s) => (
            <li key={s.id} className="schedule-list-row">
              <div className="schedule-list-info">
                <span className="schedule-list-name">{s.name}</span>
                <Chip>{s.triggerType}</Chip>
              </div>
              <Button variant="danger" aria-label={`Remove ${s.name}`} onClick={() => handleDelete(s.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={formOpen} title="New weekly schedule" onClose={handleModalClose}>
        <WeeklyScheduleForm
          groups={groups.data ?? []}
          themes={themes.data ?? []}
          onPreview={handlePreview}
          onApprove={handleApprove}
          onDiscard={handleDiscard}
          previewing={draft !== null}
        />
      </Modal>
    </Card>
  );
}
