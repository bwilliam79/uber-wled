import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  const cls = `ui-btn ui-btn-${variant} ui-btn-${size}${className ? ` ${className}` : ''}`;
  return <button type={type} className={cls} {...rest} />;
}
