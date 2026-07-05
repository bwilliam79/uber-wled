import { useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { XIcon } from '../icons';
import { useModalBehavior } from './modalBehavior';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior(panelRef, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="ui-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-modal-head">
          <h3 className="ui-modal-title">{title}</h3>
          <IconButton label="Close" onClick={onClose}><XIcon /></IconButton>
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer !== undefined && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
