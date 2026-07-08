import { Card } from '../../components/ui/Card';
import { FirmwareStatus } from './FirmwareStatus';
import './devices.css';

export function UpdateTab({ controllerId }: { controllerId: string }) {
  return (
    <div className="update-tab">
      <Card>
        <h3>Firmware update</h3>
        <FirmwareStatus controllerId={controllerId} />
      </Card>
    </div>
  );
}
