import { useState, type ReactNode } from 'react';
import { ChevronRightIcon } from '../../components/icons';

/** A collapsible room section on the Devices page: header + a grid of cards. */
export function RoomGroup({
  title,
  icon,
  count,
  defaultOpen = true,
  children
}: {
  title: string;
  icon?: string | null;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`room-group${open ? ' open' : ''}`}>
      <button
        type="button"
        className="room-group-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRightIcon className="room-group-chevron" />
        {icon && <span className="room-group-icon" aria-hidden="true">{icon}</span>}
        <span className="room-group-name">{title}</span>
        <span className="room-group-count ui-mono">{count}</span>
      </button>
      {open && <div className="devices-grid">{children}</div>}
    </section>
  );
}
