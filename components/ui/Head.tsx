import type { ReactNode } from 'react';

export interface HeadProps { title: ReactNode; right?: ReactNode }

/** Section heading (h2) with an optional right-hand slot. */
export function Head({ title, right }: HeadProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-[clamp(24px,3vw,34px)] font-semibold tracking-tight leading-[1.1] [text-wrap:balance]">{title}</h2>
      {right}
    </div>
  );
}
