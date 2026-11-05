import type { ReactNode } from 'react';
import { Button } from './Button';

/** Persistent outcome for a batch operation. The toast can expire; this stays until dismissed. */
export function ResultPanel({
  title,
  onDismiss,
  children
}: {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div className="result-panel" role="region" aria-label={title}>
      <div className="result-panel-head">
        <h3>{title}</h3>
        <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
      </div>
      {children}
    </div>
  );
}
