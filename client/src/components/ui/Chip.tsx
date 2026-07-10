import type { ReactNode } from 'react';
import { XIcon } from '../icons';

export interface ChipProps {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'danger' | 'warning';
  onRemove?: () => void;
  /** Native tooltip text (e.g. to explain a status badge). */
  title?: string;
}

export function Chip({ children, variant = 'default', onRemove, title }: ChipProps) {
  const cls = `ui-chip${variant !== 'default' ? ` ui-chip-${variant}` : ''}`;
  return (
    <span className={cls} title={title}>
      {children}
      {onRemove && (
        <button type="button" className="ui-chip-remove" aria-label="Remove" onClick={onRemove}>
          <XIcon />
        </button>
      )}
    </span>
  );
}
