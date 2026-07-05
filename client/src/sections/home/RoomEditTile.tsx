import { useState } from 'react';
import type { Controller, Group, GroupMember } from '../../api/client';
import { IconPicker } from './IconPicker';
import { RoomMembersEditor } from './RoomMembersEditor';

export function RoomEditTile({
  group,
  controllers,
  onRename,
  onSetIcon,
  onDelete,
  onMembersChange
}: {
  group: Group;
  controllers: Controller[];
  onRename: (id: string, name: string) => void;
  onSetIcon: (id: string, icon: string | null) => void;
  onDelete: (id: string) => void;
  onMembersChange: (id: string, members: GroupMember[]) => void;
}) {
  const [name, setName] = useState(group.name);
  const [showIcons, setShowIcons] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== group.name) onRename(group.id, trimmed);
  }

  return (
    <div className="home-tile home-tile-edit" data-testid={`edit-tile-${group.id}`}>
      <div className="home-tile-top">
        <button
          type="button"
          className="home-tile-icon-btn"
          aria-label={`change icon for ${group.name}`}
          onClick={() => setShowIcons((v) => !v)}
        >
          {group.icon ?? '＋'}
        </button>
        <input
          className="input home-tile-name-input"
          aria-label={`rename ${group.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      {showIcons && (
        <IconPicker
          value={group.icon}
          onChange={(icon) => {
            onSetIcon(group.id, icon);
            setShowIcons(false);
          }}
        />
      )}
      <div className="home-tile-edit-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setShowMembers((v) => !v)}>
          Members
        </button>
        <button type="button" className="btn btn-destructive" onClick={() => onDelete(group.id)}>
          Delete
        </button>
      </div>
      {showMembers && (
        <RoomMembersEditor group={group} controllers={controllers} onMembersChange={onMembersChange} />
      )}
    </div>
  );
}
