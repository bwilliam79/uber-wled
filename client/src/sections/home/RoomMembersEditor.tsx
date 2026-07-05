import { useEffect, useState } from 'react';
import {
  getControllerStatus,
  type Controller,
  type Group,
  type GroupMember
} from '../../api/client';

export function RoomMembersEditor({
  group,
  controllers,
  onMembersChange
}: {
  group: Group;
  controllers: Controller[];
  onMembersChange: (id: string, members: GroupMember[]) => void;
}) {
  const [controllerId, setControllerId] = useState(controllers[0]?.id ?? '');
  const [segId, setSegId] = useState(0);
  const [segOptions, setSegOptions] = useState<number[]>([0]);

  useEffect(() => {
    if (!controllerId) return;
    let cancelled = false;
    getControllerStatus(controllerId)
      .then((s) => {
        if (cancelled) return;
        const ids = s.state?.seg.map((x) => x.id) ?? [0];
        setSegOptions(ids.length > 0 ? ids : [0]);
        setSegId(ids[0] ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setSegOptions([0]);
        setSegId(0);
      });
    return () => {
      cancelled = true;
    };
  }, [controllerId]);

  function controllerName(id: string) {
    return controllers.find((c) => c.id === id)?.name ?? id;
  }

  function addMember() {
    if (!controllerId) return;
    const exists = group.members.some(
      (m) => m.controllerId === controllerId && m.wledSegId === segId
    );
    if (exists) return;
    onMembersChange(group.id, [...group.members, { controllerId, wledSegId: segId }]);
  }

  function removeMember(index: number) {
    onMembersChange(group.id, group.members.filter((_, i) => i !== index));
  }

  return (
    <div className="room-members-editor">
      <ul className="room-members-list">
        {group.members.map((m, i) => (
          <li key={`${m.controllerId}-${m.wledSegId}`} className="room-member-row">
            <span>{controllerName(m.controllerId)} · segment {m.wledSegId}</span>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label={`remove ${controllerName(m.controllerId)} segment ${m.wledSegId} from ${group.name}`}
              onClick={() => removeMember(i)}
            >
              Remove
            </button>
          </li>
        ))}
        {group.members.length === 0 && <li className="empty-state">No members yet.</li>}
      </ul>
      <div className="room-members-add">
        <select
          className="input"
          aria-label={`controller to add to ${group.name}`}
          value={controllerId}
          onChange={(e) => setControllerId(e.target.value)}
        >
          {controllers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          className="input"
          aria-label={`segment to add to ${group.name}`}
          value={segId}
          onChange={(e) => setSegId(Number(e.target.value))}
        >
          {segOptions.map((s) => (
            <option key={s} value={s}>segment {s}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={addMember} disabled={!controllerId}>
          Add member
        </button>
      </div>
    </div>
  );
}
