import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addGroup, updateGroup, deleteGroup, type Controller, type Group } from '../../api/client';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { IconPicker } from '../../components/ui/IconPicker';

/**
 * Room (group) management for the Devices page — create/rename/icon/delete a
 * room and assign whole controllers to it (as segment-0 members). Replaces the
 * old Home edit mode now that rooms live on Devices.
 */
export function RoomsManagerModal({
  open,
  onClose,
  groups,
  controllers,
  nameFor
}: {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  controllers: Controller[];
  nameFor: (id: string) => string;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['groups'] });

  const isMember = (g: Group, cId: string) => g.members.some((m) => m.controllerId === cId);

  function toggleMember(g: Group, cId: string) {
    const members = isMember(g, cId)
      ? g.members.filter((m) => m.controllerId !== cId)
      : [...g.members, { controllerId: cId, wledSegId: 0 }];
    updateGroup(g.id, { members }).then(invalidate);
  }
  function rename(g: Group, name: string) {
    if (name.trim() && name.trim() !== g.name) updateGroup(g.id, { name: name.trim() }).then(invalidate);
  }
  function setIcon(g: Group, icon: string | null) {
    updateGroup(g.id, { icon }).then(invalidate);
  }
  function remove(g: Group) {
    deleteGroup(g.id).then(invalidate);
  }
  function create() {
    if (!newName.trim()) return;
    addGroup(newName.trim(), [], null).then(() => {
      setNewName('');
      invalidate();
    });
  }

  return (
    <Modal open={open} title="Manage rooms" onClose={onClose} size="lg">
      <div className="rooms-manager">
        {groups.length === 0 && <p className="empty-state">No rooms yet — create one below.</p>}
        {groups.map((g) => (
          <div key={g.id} className="rooms-manager-room">
            <div className="rooms-manager-room-head">
              <input
                className="input"
                defaultValue={g.name}
                aria-label={`Room ${g.name} name`}
                onBlur={(e) => rename(g, e.target.value)}
              />
              <Button variant="danger" size="sm" onClick={() => remove(g)} aria-label={`Delete ${g.name}`}>
                Delete
              </Button>
            </div>
            <IconPicker value={g.icon} onChange={(icon) => setIcon(g, icon)} />
            <div className="rooms-manager-members" role="group" aria-label={`${g.name} controllers`}>
              {controllers.map((c) => (
                <label key={c.id} className="rooms-manager-member">
                  <input
                    type="checkbox"
                    checked={isMember(g, c.id)}
                    onChange={() => toggleMember(g, c.id)}
                    aria-label={`${nameFor(c.id)} in ${g.name}`}
                  />
                  {nameFor(c.id)}
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="rooms-manager-create">
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New room name"
            aria-label="New room name"
          />
          <Button variant="primary" onClick={create} disabled={!newName.trim()}>Add room</Button>
        </div>
      </div>
    </Modal>
  );
}
