import { Card } from '../../components/ui/Card';
import { FirmwareStatus } from './FirmwareStatus';
import './devices.css';

export function UpdateTab({ controllerId }: { controllerId: string }) {
  return (
    <div className="update-tab">
      <Card>
        <h3>Firmware update</h3>
        <p className="config-warning" role="note">
          OTA updates flash the device and reboot it. Pin the exact asset for this board once —
          the pin is remembered for future releases. Fleet-wide status stays in the Firmware
          section.
        </p>
        <FirmwareStatus controllerId={controllerId} />
      </Card>
    </div>
  );
}
