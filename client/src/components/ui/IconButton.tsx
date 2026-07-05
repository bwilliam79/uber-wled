import type { ButtonHTMLAttributes } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also shown as tooltip. */
  label: string;
}

export function IconButton({ label, className = '', type = 'button', ...rest }: IconButtonProps) {
  const cls = `ui-iconbtn${className ? ` ${className}` : ''}`;
  return <button type={type} aria-label={label} title={label} className={cls} {...rest} />;
}
