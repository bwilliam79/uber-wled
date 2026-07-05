import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card${className ? ` ${className}` : ''}`} {...rest} />;
}
