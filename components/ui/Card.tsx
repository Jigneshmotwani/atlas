import type { HTMLAttributes } from 'react';

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ children, className = '', ...p }: CardProps) {
  return <div {...p} className={`rounded-[22px] bg-card border border-line ${className}`}>{children}</div>;
}
