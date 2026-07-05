import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createControllerSegment, deleteControllerSegment, updateControllerSegment,
  type DeviceSegment, type SegmentUpdate
} from '../../api/client';
import { useDeviceSegments } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { Slider } from '../../components/ui/Slider';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import { nextFreeSegmentId, validateSegmentBounds } from './segmentLogic';
import './devices.css';

export interface SegmentsTabProps {
  controllerId: string;
  ledCount: number;
  maxSeg: number;
}

export interface SegmentRowProps {
  segment: DeviceSegment;
  ledCount: number;
  busy: boolean;
  onApply: (segId: number, patch: SegmentUpdate) => void;
  onDelete: (segId: number) => void;
}

export function SegmentRow({ segment, ledCount, busy, onApply, onDelete }: SegmentRowProps) {
  const [name, setName] = useState(segment.n ?? '');
  const [start, setStart] = useState(String(segment.start));
  const [stop, setStop] = useState(String(segment.stop));
  const [grp, setGrp] = useState(String(segment.grp));
  const [spc, setSpc] = useState(String(segment.spc));
  const [of, setOf] = useState(String(segment.of));
  const [bri, setBri] = useState(segment.bri);
  useEffect(() => setBri(segment.bri), [segment.bri]);

  const limit = ledCount > 0 ? ledCount : Number.MAX_SAFE_INTEGER;
  const boundsError = validateSegmentBounds(Number(start), Number(stop), limit);

  function apply() {
    if (boundsError) return;
    onApply(segment.id, {
      name,
      start: Number(start),
      stop: Number(stop),
      grp: Number(grp),
      spc: Number(spc),
      of: Number(of)
    });
  }

  return (
    <Card className="segment-row" data-testid={`segment-${segment.id}`}>
      <div className="segment-row-header">
        <h3>Segment {segment.id}</h3>
        <Toggle label={`Segment ${segment.id} power`} checked={segment.on}
          onChange={(on) => onApply(segment.id, { on })} disabled={busy} />
      </div>
      <div className="segment-grid">
        <Field label="Name" htmlFor={`seg-${segment.id}-name`}>
          <input id={`seg-${segment.id}-name`} className="input" value={name}
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Start" htmlFor={`seg-${segment.id}-start`} error={boundsError ?? undefined}>
          <input id={`seg-${segment.id}-start`} className="input" type="number" inputMode="numeric"
            value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Stop" htmlFor={`seg-${segment.id}-stop`}
          hint={ledCount > 0 ? `Device has ${ledCount} LEDs` : undefined}>
          <input id={`seg-${segment.id}-stop`} className="input" type="number" inputMode="numeric"
            value={stop} onChange={(e) => setStop(e.target.value)} />
        </Field>
        <Field label="Grouping" htmlFor={`seg-${segment.id}-grp`}>
          <input id={`seg-${segment.id}-grp`} className="input" type="number" inputMode="numeric"
            value={grp} onChange={(e) => setGrp(e.target.value)} />
        </Field>
        <Field label="Spacing" htmlFor={`seg-${segment.id}-spc`}>
          <input id={`seg-${segment.id}-spc`} className="input" type="number" inputMode="numeric"
            value={spc} onChange={(e) => setSpc(e.target.value)} />
        </Field>
        <Field label="Offset" htmlFor={`seg-${segment.id}-of`}>
          <input id={`seg-${segment.id}-of`} className="input" type="number" inputMode="numeric"
            value={of} onChange={(e) => setOf(e.target.value)} />
        </Field>
      </div>
      <div className="segment-switches">
        <Toggle label={`Segment ${segment.id} reverse`} checked={segment.rev}
          onChange={(rev) => onApply(segment.id, { rev })} disabled={busy} />
        <Toggle label={`Segment ${segment.id} mirror`} checked={segment.mi}
          onChange={(mi) => onApply(segment.id, { mi })} disabled={busy} />
      </div>
      <Slider label={`Segment ${segment.id} brightness`} value={bri} min={1} max={255}
        onChange={setBri} onCommit={(v) => onApply(segment.id, { bri: v })} disabled={busy} />
      <div className="segment-row-actions">
        <Button variant="primary" onClick={apply} disabled={busy || boundsError !== null}>Apply</Button>
        <Button variant="danger" onClick={() => onDelete(segment.id)} disabled={busy}>Delete</Button>
      </div>
    </Card>
  );
}

export function SegmentsTab({ controllerId, ledCount, maxSeg }: SegmentsTabProps) {
  const segments = useDeviceSegments(controllerId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [newStart, setNewStart] = useState('0');
  const [newStop, setNewStop] = useState('');

  async function run(op: () => Promise<DeviceSegment[]>, errorTitle: string) {
    setBusy(true);
    try {
      const next = await op();
      queryClient.setQueryData(['segments', controllerId], next);
    } catch {
      toast.show({ title: errorTitle, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const list = segments.data ?? [];
  const nextId = nextFreeSegmentId(list, maxSeg);
  const limit = ledCount > 0 ? ledCount : Number.MAX_SAFE_INTEGER;
  const createError = newStop === '' ? null : validateSegmentBounds(Number(newStart), Number(newStop), limit);

  if (segments.isLoading) return <Skeleton height="120px" />;
  if (segments.isError) return <p role="alert">Could not load segments — is the device reachable?</p>;

  return (
    <div className="segments-tab">
      {list.map((segment) => (
        <SegmentRow key={segment.id} segment={segment} ledCount={ledCount} busy={busy}
          onApply={(segId, patch) =>
            run(() => updateControllerSegment(controllerId, segId, patch), 'Segment update failed')}
          onDelete={setDeleteId} />
      ))}
      <Card className="segment-create" data-testid="segment-create">
        <h3>New segment</h3>
        <div className="segment-grid">
          <Field label="Start" htmlFor="seg-new-start" error={createError ?? undefined}>
            <input id="seg-new-start" className="input" type="number" inputMode="numeric"
              value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          </Field>
          <Field label="Stop" htmlFor="seg-new-stop"
            hint={ledCount > 0 ? `Up to ${ledCount}` : undefined}>
            <input id="seg-new-stop" className="input" type="number" inputMode="numeric"
              value={newStop} onChange={(e) => setNewStop(e.target.value)} />
          </Field>
        </div>
        {nextId === null && <p role="alert">All {maxSeg} segment slots are in use.</p>}
        <Button variant="primary"
          disabled={busy || nextId === null || newStop === '' || createError !== null}
          onClick={() =>
            run(
              () => createControllerSegment(controllerId, { start: Number(newStart), stop: Number(newStop) }),
              'Segment create failed'
            ).then(() => setNewStop(''))
          }>
          Add segment
        </Button>
      </Card>
      <Modal open={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete segment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy}
              onClick={() => {
                const id = deleteId;
                setDeleteId(null);
                if (id !== null) run(() => deleteControllerSegment(controllerId, id), 'Segment delete failed');
              }}>
              Delete segment
            </Button>
          </>
        }>
        <p>Delete segment {deleteId}? Its LEDs go dark until another segment covers them.</p>
      </Modal>
    </div>
  );
}
