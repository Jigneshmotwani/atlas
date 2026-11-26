import type { ReactNode } from 'react';

export interface PopNumberProps { value: ReactNode; className?: string }

/** Serif tabular number that pops when its value changes (re-keyed on the value, like the prototype). */
export function PopNumber({ value, className = '' }: PopNumberProps) {
  const k = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : 'node';
  return <span key={k} className={`serif num pop inline-block ${className}`}>{value}</span>;
}
