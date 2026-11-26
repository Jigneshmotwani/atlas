import type { SelectHTMLAttributes } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** The prototype's pill-shaped native select. */
export function Select({ className = '', children, ...p }: SelectProps) {
  return (
    <select {...p} className={`h-10 rounded-full border border-line bg-card pl-4 pr-8 text-sm font-semibold ${className}`}>
      {children}
    </select>
  );
}
