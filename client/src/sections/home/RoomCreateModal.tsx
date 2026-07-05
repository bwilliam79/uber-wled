import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { IconPicker } from './IconPicker';

export function RoomCreateModal({
  open,
  onClose,
  onCreate
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string | null) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), icon);
      setName('');
      setIcon(null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="New room" onClose={onClose}>
      <div className="field">
        <label htmlFor="room-name">Name</label>
        <input
          id="room-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Living room"
        />
      </div>
      <IconPicker value={icon} onChange={setIcon} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || busy}
          onClick={handleCreate}
        >
          Create room
        </button>
      </div>
    </Modal>
  );
}
