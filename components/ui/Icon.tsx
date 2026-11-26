// Line icons from the prototype (Ico). `on` replays the stroke-draw animation.
import type { ReactNode } from 'react';

export type IconName = 'check' | 'x' | 'back' | 'info' | 'search' | 'arrow' | 'spark' | 'chev' | 'send' | 'term';
export interface IconProps { name: IconName; on?: boolean; size?: number }

const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7" {...p} />,
  x: <path d="M6 6l12 12M18 6L6 18" {...p} />,
  back: <path d="M15 5l-7 7 7 7" {...p} />,
  info: <><circle cx="12" cy="12" r="9" {...p} /><path d="M12 11v5M12 8h.01" {...p} /></>,
  search: <><circle cx="11" cy="11" r="7" {...p} /><path d="M20 20l-4-4" {...p} /></>,
  arrow: <path d="M7 17L17 7M9 7h8v8" {...p} />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" {...p} />,
  chev: <path d="M6 9l6 6 6-6" {...p} />,
  send: <path d="M5 12h14M13 6l6 6-6 6" {...p} />,
  term: <><polyline points="4 17 9 12 4 7" {...p} /><line x1="12" y1="18" x2="20" y2="18" {...p} /></>,
};

export function Icon({ name, on, size = 20 }: IconProps) {
  return (
    <svg className={`ico ${on ? 'on' : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
