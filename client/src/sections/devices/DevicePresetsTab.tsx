import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  applyControl, deleteControllerPreset, saveControllerPreset, type DevicePreset
} from '../../api/client';
import { useDevicePresets } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import './devices.css';

export function DevicePresetsTab({ controllerId }: { controllerId: string }) {
  const presets = useDevicePresets(controllerId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<DevicePreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [includeBrightness, setIncludeBrightness] = useState(true);
  const [saveSegmentBounds, setSaveSegmentBounds] = useState(false);

  async function applyPreset(preset: DevicePreset) {
    try {
      const { results } = await applyControl(
        [{ kind: 'controller', controllerId }],
        { ps: preset.id }
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.show({ title: `Applied “${preset.name}”`, variant: 'success' });
      } else {
        toast.show({ title: `Could not apply “${preset.name}”`, description: failed[0].error, variant: 'error' });
      }
    } catch {
      toast.show({ title: `Could not apply “${preset.name}”`, variant: 'error' });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteControllerPreset(controllerId, deleteTarget.id);
      await queryClient.invalidateQueries({ queryKey: ['presets', controllerId] });
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrent() {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const saved = await saveControllerPreset(controllerId, {
        name: name.trim(), includeBrightness, saveSegmentBounds
      });
      await queryClient.invalidateQueries({ queryKey: ['presets', controllerId] });
      toast.show({ title: `Saved preset ${saved.id}: ${saved.name}`, variant: 'success' });
      setName('');
    } catch {
      toast.show({ title: 'Preset save failed', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (presets.isLoading) return <Skeleton height="120px" />;
  if (presets.isError) return <p role="alert">Could not load presets — is the device reachable?</p>;

  const list = presets.data ?? [];

  return (
    <div className="presets-tab-device">
      <Card>
        <h3>Device presets</h3>
        {list.length === 0 && <p className="empty-state">No presets saved on this device yet.</p>}
        <ul className="device-preset-list">
          {list.map((preset) => (
            <li key={preset.id} className="device-preset-row">
              <span className="device-preset-id">{preset.id}</span>
              <span className="device-preset-name">{preset.name}</span>
              {preset.isPlaylist && <Chip variant="accent">Playlist</Chip>}
              <Button size="sm" onClick={() => applyPreset(preset)}
                aria-label={`Apply preset ${preset.name}`}>Apply</Button>
              <Button size="sm" variant="danger" onClick={() => setDeleteTarget(preset)}
                aria-label={`Delete preset ${preset.name}`}>Delete</Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3>Save current state as preset</h3>
        <Field label="Preset name" htmlFor="preset-save-name">
          <input id="preset-save-name" className="input" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Evening warm" />
        </Field>
        <div className="preset-save-flags">
          <Toggle label="Include brightness" checked={includeBrightness} onChange={setIncludeBrightness} />
          <Toggle label="Save segment bounds" checked={saveSegmentBounds} onChange={setSaveSegmentBounds} />
        </div>
        <Button variant="primary" onClick={saveCurrent} disabled={busy || name.trim() === ''}>
          Save preset
        </Button>
      </Card>
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete preset"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busy}>Delete preset</Button>
          </>
        }>
        <p>
          Delete “{deleteTarget?.name}” (id {deleteTarget?.id}) from the device? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
