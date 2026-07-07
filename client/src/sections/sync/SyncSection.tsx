import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addSyncGroup, renameSyncGroup, setSyncGroupMembers, deleteSyncGroup,
  activateSyncGroup, deactivateSyncGroup,
  type Controller, type SyncGroup, type SyncMemberResult
} from '../../api/client';
import { useControllers, useSyncGroups } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { SyncGroupModal } from './SyncGroupModal';
import './sync.css';

function memberNames(group: SyncGroup, controllers: Controller[]): string {
  if (group.memberControllerIds.length === 0) return 'No controllers yet';
  return group.memberControllerIds
    .map((id) => controllers.find((c) => c.id === id)?.name ?? id)
    .join(', ');
}

function summarizeResults(results: SyncMemberResult[]): { failed: SyncMemberResult[] } {
  return { failed: results.filter((r) => !r.ok) };
}

function SyncGroupRow({
  group,
  controllers,
  busy,
  onActivate,
  onDeactivate,
  onEdit,
  onDelete
}: {
  group: SyncGroup;
  controllers: Controller[];
  busy: boolean;
  onActivate: (g: SyncGroup) => void;
  onDeactivate: (g: SyncGroup) => void;
  onEdit: (g: SyncGroup) => void;
  onDelete: (g: SyncGroup) => void;
}) {
  return (
    <li className="sync-group-row" data-testid={`sync-group-${group.id}`}>
      <div className="sync-group-row-info">
        <div className="sync-group-row-title">
          <span className="sync-group-row-name">{group.name}</span>
          {group.active
            ? <Chip variant="success">Active</Chip>
            : <Chip>Inactive</Chip>}
        </div>
        <span className="sync-group-row-members">{memberNames(group, controllers)}</span>
      </div>
      <div className="sync-group-row-actions">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onEdit(group)}>
          Edit
        </Button>
        {group.active ? (
          <Button
            variant="secondary" size="sm" disabled={busy}
            aria-label={`Deactivate ${group.name}`}
            onClick={() => onDeactivate(group)}
          >
            Deactivate
          </Button>
        ) : (
          <Button
            variant="primary" size="sm" disabled={busy || group.memberControllerIds.length === 0}
            aria-label={`Activate ${group.name}`}
            onClick={() => onActivate(group)}
          >
            Activate
          </Button>
        )}
        <Button
          variant="danger" size="sm" disabled={busy}
          aria-label={`Delete ${group.name}`}
          onClick={() => onDelete(group)}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

export function SyncSection() {
  const controllersQuery = useControllers();
  const controllers = controllersQuery.data ?? [];
  const syncGroupsQuery = useSyncGroups();
  const groups = syncGroupsQuery.data ?? [];
  const queryClient = useQueryClient();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<SyncGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SyncGroup | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function upsertGroup(updated: SyncGroup) {
    queryClient.setQueryData<SyncGroup[]>(['sync-groups'], (prev) =>
      (prev ?? []).map((g) => (g.id === updated.id ? updated : g))
    );
  }

  function reportResults(action: 'activated' | 'deactivated', groupName: string, results: SyncMemberResult[]) {
    const { failed } = summarizeResults(results);
    if (failed.length === 0) {
      toast.show({ title: `${groupName} ${action}`, variant: 'success' });
    } else {
      toast.show({
        title: `${groupName} ${action} with ${failed.length} controller${failed.length === 1 ? '' : 's'} failing`,
        description: failed.map((f) => f.error).join('; '),
        variant: 'error'
      });
    }
  }

  async function handleCreate(name: string, memberControllerIds: string[]) {
    const created = await addSyncGroup(name, memberControllerIds);
    queryClient.setQueryData<SyncGroup[]>(['sync-groups'], (prev) => [...(prev ?? []), created]);
  }

  async function handleSaveEdit(name: string, memberControllerIds: string[]) {
    if (!editGroup) return;
    const membersChanged =
      !editGroup.active &&
      (memberControllerIds.length !== editGroup.memberControllerIds.length ||
        [...memberControllerIds].sort().some((id, i) => id !== [...editGroup.memberControllerIds].sort()[i]));
    let updated = editGroup;
    if (name !== editGroup.name) updated = await renameSyncGroup(editGroup.id, name);
    if (membersChanged) updated = await setSyncGroupMembers(editGroup.id, memberControllerIds);
    upsertGroup(updated);
  }

  async function handleActivate(group: SyncGroup) {
    setBusyId(group.id);
    try {
      const { group: updated, results } = await activateSyncGroup(group.id);
      upsertGroup(updated);
      reportResults('activated', group.name, results);
    } catch (err: any) {
      toast.show({ title: `Could not activate ${group.name}`, description: err.message, variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate(group: SyncGroup) {
    setBusyId(group.id);
    try {
      const { group: updated, results } = await deactivateSyncGroup(group.id);
      upsertGroup(updated);
      reportResults('deactivated', group.name, results);
    } catch (err: any) {
      toast.show({ title: `Could not deactivate ${group.name}`, description: err.message, variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    try {
      await deleteSyncGroup(target.id);
      queryClient.setQueryData<SyncGroup[]>(['sync-groups'], (prev) => (prev ?? []).filter((g) => g.id !== target.id));
    } catch (err: any) {
      toast.show({ title: `Could not delete ${target.name}`, description: err.message, variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="section sync-section">
      <div className="sync-section-header">
        <h2>Sync</h2>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>New sync group</Button>
      </div>
      <p className="sync-section-intro">
        Wire any set of controllers together with WLED's own real-time UDP
        sync so their effects and colors play in lockstep — managed here
        instead of each device's own settings page. Create a group, activate
        it, and pull it apart whenever you want.
      </p>
      <Card>
        {groups.length === 0 && <p className="empty-state">No sync groups yet.</p>}
        {groups.length > 0 && (
          <ul className="sync-group-list">
            {groups.map((g) => (
              <SyncGroupRow
                key={g.id}
                group={g}
                controllers={controllers}
                busy={busyId === g.id}
                onActivate={handleActivate}
                onDeactivate={handleDeactivate}
                onEdit={setEditGroup}
                onDelete={setDeleteTarget}
              />
            ))}
          </ul>
        )}
      </Card>

      <SyncGroupModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        controllers={controllers}
        onSave={handleCreate}
      />
      <SyncGroupModal
        open={editGroup !== null}
        onClose={() => setEditGroup(null)}
        controllers={controllers}
        group={editGroup ?? undefined}
        onSave={handleSaveEdit}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete sync group"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete</Button>
          </>
        }
      >
        <p>
          Delete “{deleteTarget?.name}”? {deleteTarget?.active
            ? 'Its members will stop broadcasting sync first.'
            : 'This only removes the group from uber-wled — no device settings change.'}
        </p>
      </Modal>
    </section>
  );
}
