// Uppercase pill button with the round ↗ that nudges up-right on hover. Renders next/link when `href` is set.
import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { Icon } from './Icon';

export interface PillProps {
  children: ReactNode;
  /** method syntax so handlers typed for a button element are accepted too */
  onClick?(e: MouseEvent<HTMLElement>): void;
  href?: string;
  dark?: boolean;
  small?: boolean;
  acc?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  'aria-label'?: string;
}

export function Pill({ children, onClick, href, dark, small, acc, disabled, type = 'button', className = '', 'aria-label': ariaLabel }: PillProps) {
  const cls = `lift group inline-flex items-center gap-2 rounded-full ${small ? 'h-10 pl-4 pr-1.5' : 'h-12 pl-5 pr-1.5'} text-xs font-bold uppercase tracking-[.06em] border transition-colors disabled:opacity-40 ${acc ? 'bg-acc text-onacc border-acc' : dark ? 'border-white/30 text-white hover:bg-white/10' : 'border-line bg-card hover:border-ink'} ${className}`;
  const arrow = (
    <span className={`arr grid place-items-center rounded-full ${small ? 'h-7 w-7' : 'h-9 w-9'} ${acc ? 'bg-onacc text-white' : dark ? 'bg-white text-night' : 'bg-ink text-bg'}`}>
      <Icon name="arrow" size={16} />
    </span>
  );
  if (href && !disabled) {
    return <Link href={href} onClick={onClick ? e => onClick(e) : undefined} aria-label={ariaLabel} className={cls}>{children}{arrow}</Link>;
  }
  return <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel} className={cls}>{children}{arrow}</button>;
}
