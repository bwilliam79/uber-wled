import type { ReactNode } from 'react';
import { XIcon } from '../icons';

export interface ChipProps {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'danger' | 'warning';
  onRemove?: () => void;
}

export function Chip({ children, variant = 'default', onRemove }: ChipProps) {
  const cls = `ui-chip${variant !== 'default' ? ` ui-chip-${variant}` : ''}`;
  return (
    <span className={cls}>
      {children}
      {onRemove && (
        <button type="button" className="ui-chip-remove" aria-label="Remove" onClick={onRemove}>
          <XIcon />
        </button>
      )}
    </span>
  );
}
