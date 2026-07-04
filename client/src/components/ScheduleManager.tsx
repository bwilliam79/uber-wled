import { useEffect, useState } from 'react';
import {
  listSchedules, addSchedule, deleteSchedule, listGroups, listThemes,
  applyControl, getSegmentsSnapshot,
  type Schedule, type Group, type CustomTheme
} from '../api/client';
import { WeeklyScheduleForm, type WeeklyScheduleDraft } from './WeeklyScheduleForm';
import { TrashIcon } from './icons';

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
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [draft, setDraft] = useState<WeeklyScheduleDraft | null>(null);
  const [snapshot, setSnapshot] = useState<MemberSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  useEffect(() => {
    listSchedules().then(setSchedules).catch((e: Error) => setError(e.message));
    listGroups().then(setGroups);
    listThemes().then(setThemes);
  }, []);

  async function handleDelete(id: string) {
    await deleteSchedule(id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

  function membersForGroup(groupId: string) {
    return groups.find((g) => g.id === groupId)?.members ?? [];
  }

  async function handlePreview(nextDraft: WeeklyScheduleDraft) {
    const members = membersForGroup(nextDraft.groupId);
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
    await applyControl(members, { type: nextDraft.actionType, ...(nextDraft.actionPayload as object) } as any);
  }

  /**
   * Reverts every previewed member to its snapshot. Per the scheduling
   * spec's error-handling section, a revert failure must surface as a
   * visible error in the editor rather than silently leaving lights in the
   * previewed state — `applyControl`'s per-controller `results` are checked
   * for `ok: false` explicitly, since `applyControl` itself never throws
   * (Task 12's batch-apply isolates failures per controller instead).
   */
  async function revertToSnapshot(): Promise<boolean> {
    if (!snapshot) return true;
    const failures: string[] = [];
    for (const s of snapshot) {
      const powerResult = await applyControl(
        [{ controllerId: s.controllerId, wledSegId: s.wledSegId }],
        { type: 'power', on: s.on } as any
      );
      const briResult = await applyControl(
        [{ controllerId: s.controllerId, wledSegId: s.wledSegId }],
        { type: 'brightness', value: s.bri } as any
      );
      for (const r of [...powerResult.results, ...briResult.results]) {
        if (!r.ok) failures.push(`${s.controllerId}/${s.wledSegId}: ${r.error ?? 'unknown error'}`);
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
    const reverted = await revertToSnapshot();
    if (!reverted) return; // keep draft/snapshot around so the user can retry Approve/Discard
    const created = await addSchedule({
      name: draft.name,
      triggerType: 'weekly',
      cronExpr: null,
      daysOfWeek: draft.daysOfWeek,
      timeOfDay: draft.timeOfDay,
      offsetMinutes: 0,
      latitude: null,
      longitude: null,
      groupId: draft.groupId,
      actionType: draft.actionType,
      actionPayload: draft.actionPayload,
      enabled: true
    });
    setSchedules((prev) => [...prev, created]);
    setDraft(null);
    setSnapshot(null);
  }

  async function handleDiscard() {
    const reverted = await revertToSnapshot();
    if (!reverted) return; // keep draft/snapshot around so the user can see the error and retry
    setDraft(null);
    setSnapshot(null);
  }

  return (
    <section className="section">
      <h2>Schedules</h2>
      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        {revertError && <div className="error-banner" role="alert">{revertError}</div>}
        {schedules.length === 0 ? (
          <p className="empty-state">No schedules yet.</p>
        ) : (
          <ul className="controller-list">
            {schedules.map((s) => (
              <li key={s.id} className="controller-row">
                <div className="controller-info">
                  <span className="controller-name">{s.name}</span>
                  <span className="controller-meta">{s.triggerType}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={() => handleDelete(s.id)}
                  aria-label={`Remove ${s.name}`}
                >
                  <TrashIcon />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <WeeklyScheduleForm
          groups={groups}
          themes={themes}
          onPreview={handlePreview}
          onApprove={handleApprove}
          onDiscard={handleDiscard}
          previewing={draft !== null}
        />
      </div>
    </section>
  );
}
