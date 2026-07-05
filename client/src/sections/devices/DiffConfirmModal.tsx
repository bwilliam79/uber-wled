import { useEffect, useState } from 'react';
import type { ConfigDiffEntry } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { isStrandRisk } from './configPatches';
import './devices.css';

export interface DiffConfirmModalProps {
  open: boolean;
  diff: ConfigDiffEntry[];
  rebootRequired: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)';
  return JSON.stringify(value);
}

export function DiffConfirmModal({
  open, diff, rebootRequired, busy = false, onConfirm, onCancel
}: DiffConfirmModalProps) {
  const risky = diff.some((entry) => isStrandRisk(entry.path));
  const [ackRisk, setAckRisk] = useState(false);
  useEffect(() => {
    if (!open) setAckRisk(false);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Review config changes"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={risky ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy || diff.length === 0 || (risky && !ackRisk)}
          >
            {busy ? 'Applying…' : `Apply ${diff.length} change${diff.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      {diff.length === 0 ? (
        <p className="diff-empty">No changes — the device already matches this form.</p>
      ) : (
        <ul className="diff-list">
          {diff.map((entry) => (
            <li key={entry.path}
              className={isStrandRisk(entry.path) ? 'diff-row diff-row-risky' : 'diff-row'}>
              <code className="diff-path">{entry.path}</code>
              <span className="diff-values">
                <span className="diff-from">{formatValue(entry.from)}</span>
                <span aria-hidden="true"> → </span>
                <span className="diff-to">{formatValue(entry.to)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rebootRequired && (
        <p className="diff-reboot-note" role="status">
          <Chip variant="warning">Reboot required</Chip> The device reboots (or must be rebooted)
          before these changes take effect — lights blink out for a few seconds.
        </p>
      )}
      {risky && (
        <div className="diff-risk-warning" role="alert">
          <p>
            <strong>This change touches WiFi or GPIO settings.</strong> A wrong SSID, password, or
            pin assignment can strand the device off the network or stop its LED output entirely —
            recovery may require joining its WLED-AP fallback or reflashing over USB.
          </p>
          <label className="diff-risk-ack">
            <input type="checkbox" checked={ackRisk} onChange={(e) => setAckRisk(e.target.checked)} />
            I understand this device may become unreachable
          </label>
        </div>
      )}
    </Modal>
  );
}
