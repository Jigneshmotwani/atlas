import type { ButtonHTMLAttributes } from 'react';

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean };

export function Chip({ on, children, className = '', type = 'button', ...p }: ChipProps) {
  return (
    <button
      type={type}
      {...p}
      aria-pressed={!!on}
      className={`h-10 px-4 rounded-full border text-sm font-semibold transition-colors ${on ? 'bg-ink text-bg border-ink' : 'border-line bg-card hover:border-ink'} ${className}`}
    >
      {children}
    </button>
  );
}
