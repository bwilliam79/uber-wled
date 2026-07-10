import { useEffect, useState } from 'react';
import type { Controller, SyncGroup } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';

export interface SyncGroupModalProps {
  open: boolean;
  onClose: () => void;
  controllers: Controller[];
  live: Map<string, LiveStatusEntry>;
  /** Present when editing an existing group; absent when creating one. */
  group?: SyncGroup;
  /**
   * Controllers already active in some *other* sync group → that group's name.
   * Membership is still allowed (inactive multi-membership is fine); the label
   * warns that activating *this* group will conflict until that one is
   * deactivated.
   */
  activeElsewhere?: Map<string, string>;
  onSave: (name: string, memberControllerIds: string[]) => Promise<void>;
}

/** Shared create/edit modal — a sync group is just a name plus a set of
 *  controllers, so one form covers both. Membership editing is disabled
 *  (but still visible) while the group is active: changing which devices
 *  are wired together mid-sync means reconciling wire state for whoever
 *  left/joined, so the caller (SyncSection) only opens this for an active
 *  group in read-only form, directing the user to deactivate first. */
export function SyncGroupModal({
  open, onClose, controllers, live, group, activeElsewhere, onSave
}: SyncGroupModalProps) {
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const editingActive = !!group?.active;

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setMemberIds(new Set(group?.memberControllerIds ?? []));
  }, [open, group]);

  function toggle(id: string) {
    if (editingActive) return;
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim(), [...memberIds]);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const selectedActiveElsewhere = [...memberIds]
    .map((id) => {
      const groupName = activeElsewhere?.get(id);
      if (!groupName) return null;
      const ctrlName = live.get(id)?.info?.name || controllers.find((c) => c.id === id)?.name || id;
      return { id, ctrlName, groupName };
    })
    .filter((x): x is { id: string; ctrlName: string; groupName: string } => x !== null);

  return (
    <Modal open={open} onClose={onClose} title={group ? 'Edit sync group' : 'New sync group'}>
      <div className="field">
        <label htmlFor="sync-group-name">Name</label>
        <input
          id="sync-group-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Front of house"
        />
      </div>
      {editingActive && (
        <p className="field-hint sync-group-modal-hint">
          Deactivate this sync group to change its members.
        </p>
      )}
      <fieldset className="sync-group-member-picker" disabled={editingActive}>
        <legend className="control-label">Controllers</legend>
        {controllers.length === 0 && <p className="empty-state">No controllers yet.</p>}
        <ul className="sync-group-member-list">
          {controllers.map((c) => {
            const elsewhere = activeElsewhere?.get(c.id);
            const label = live.get(c.id)?.info?.name || c.name;
            return (
              <li key={c.id}>
                <label className="sync-group-member-row">
                  <input
                    type="checkbox"
                    checked={memberIds.has(c.id)}
                    disabled={editingActive}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="sync-group-member-label">
                    <span>{label}</span>
                    {elsewhere && (
                      <span className="sync-group-member-elsewhere">
                        Active in “{elsewhere}”
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {!editingActive && selectedActiveElsewhere.length > 0 && (
        <p className="field-hint sync-group-modal-hint" role="status">
          A controller can only be active in one sync group at a time. You can
          still save this membership, but activating this group will fail until
          you deactivate {selectedActiveElsewhere.length === 1
            ? `“${selectedActiveElsewhere[0].groupName}”`
            : 'the other active group(s)'}
          {' '}or remove the shared controller
          {selectedActiveElsewhere.length === 1 ? '' : 's'}.
        </p>
      )}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={!name.trim() || busy}>
          {group ? 'Save' : 'Create sync group'}
        </Button>
      </div>
    </Modal>
  );
}
