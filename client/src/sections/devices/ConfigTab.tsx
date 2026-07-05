import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  applyControllerConfig, dryRunControllerConfig, rebootController, type ConfigDiffEntry
} from '../../api/client';
import { useDeviceConfig } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import type { Cfg } from './configPatches';
import { DiffConfirmModal } from './DiffConfirmModal';
import { IdentityForm } from './config/IdentityForm';
import './devices.css';

const CONFIG_PAGES = [
  { id: 'identity', label: 'Identity' }
];

interface PendingSave {
  patch: Cfg;
  diff: ConfigDiffEntry[];
  rebootRequired: boolean;
}

export function ConfigTab({ controllerId }: { controllerId: string }) {
  const config = useDeviceConfig(controllerId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState('identity');
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebootOffer, setRebootOffer] = useState(false);

  async function requestSave(patch: Cfg) {
    setBusy(true);
    try {
      const res = await dryRunControllerConfig(controllerId, patch);
      if (res.diff.length === 0) {
        toast.show({ title: 'No changes to save', variant: 'info' });
        return;
      }
      setPending({ patch, diff: res.diff, rebootRequired: res.rebootRequired });
    } catch {
      toast.show({
        title: 'Could not preview changes',
        description: 'Dry-run failed — is the device reachable?',
        variant: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmSave() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await applyControllerConfig(controllerId, pending.patch);
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ['config', controllerId] });
      if (res.rebootRequired) setRebootOffer(true);
      else toast.show({ title: 'Config saved', variant: 'success' });
    } catch {
      toast.show({ title: 'Config save failed', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function rebootNow() {
    setRebootOffer(false);
    try {
      await rebootController(controllerId);
      toast.show({ title: 'Rebooting', description: 'The device drops offline for a few seconds.', variant: 'info' });
    } catch {
      toast.show({ title: 'Reboot failed', variant: 'error' });
    }
  }

  if (config.isLoading) return <Skeleton height="200px" />;
  if (config.isError || !config.data) {
    return <p role="alert">Could not load the device config — is it reachable?</p>;
  }

  const cfg = config.data as Cfg;

  return (
    <div className="config-tab">
      <Tabs label="Config pages" tabs={CONFIG_PAGES} active={page} onChange={setPage} />
      {page === 'identity' && <IdentityForm cfg={cfg} busy={busy} onSave={requestSave} />}
      <DiffConfirmModal
        open={pending !== null}
        diff={pending?.diff ?? []}
        rebootRequired={pending?.rebootRequired ?? false}
        busy={busy}
        onConfirm={confirmSave}
        onCancel={() => setPending(null)}
      />
      {rebootOffer && (
        <div className="config-reboot-offer" role="status">
          <p>Saved. These changes need a reboot to take effect.</p>
          <Button variant="primary" onClick={rebootNow}>Reboot now</Button>
          <Button variant="ghost" onClick={() => setRebootOffer(false)}>Later</Button>
        </div>
      )}
    </div>
  );
}
