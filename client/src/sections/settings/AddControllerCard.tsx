import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addController } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';

/**
 * Manual controller add. Lives in Settings because discovery adds controllers
 * on the network automatically — manual add is the occasional escape hatch.
 */
export function AddControllerCard() {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  async function handleAdd() {
    if (!name.trim() || !host.trim()) return;
    setAdding(true);
    try {
      await addController(name.trim(), host.trim());
      await queryClient.invalidateQueries({ queryKey: ['controllers'] });
      toast.show({ title: `Added ${name.trim()}`, variant: 'success' });
      setName('');
      setHost('');
    } catch (e) {
      toast.show({ title: 'Add controller failed', description: (e as Error).message, variant: 'error' });
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card className="settings-group">
      <h3 className="settings-group-title">Add a controller</h3>
      <p className="settings-group-hint">
        Controllers on your network are discovered automatically. Add one manually by host/IP
        only if it isn't found (e.g. on a different subnet).
      </p>
      <div className="settings-field-pair">
        <Field label="Name" htmlFor="add-controller-name">
          <input id="add-controller-name" className="input" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Front Porch" />
        </Field>
        <Field label="Host or IP" htmlFor="add-controller-host">
          <input id="add-controller-host" className="input" value={host}
            onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
        </Field>
      </div>
      <Button variant="primary" onClick={handleAdd} disabled={adding || !name.trim() || !host.trim()}>
        {adding ? 'Adding…' : 'Add controller'}
      </Button>
    </Card>
  );
}
