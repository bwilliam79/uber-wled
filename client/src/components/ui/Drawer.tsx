import { useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { XIcon } from '../icons';
import { useModalBehavior } from './modalBehavior';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** When omitted, no header is rendered — the host owns the full body (Phase D ControlSurface). */
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, title, children, className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior(panelRef, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="ui-overlay ui-overlay-drawer" onClick={onClose}>
      <div
        ref={panelRef}
        className={`ui-drawer${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Panel'}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="ui-drawer-head">
            <h3 className="ui-drawer-title">{title}</h3>
            <IconButton label="Close" onClick={onClose}><XIcon /></IconButton>
          </div>
        )}
        <div className="ui-drawer-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
