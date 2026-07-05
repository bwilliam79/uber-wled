import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** id of the wrapped control, for label association. */
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className={`ui-field${error ? ' has-error' : ''}`}>
      <label className="ui-field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="ui-field-hint">{hint}</span>}
      {error && <span className="ui-field-error" role="alert">{error}</span>}
    </div>
  );
}
