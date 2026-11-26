import type { ReactNode } from 'react';

export interface ThProps { children?: ReactNode; r?: boolean }
export interface TableBoxProps { children: ReactNode }

/** Table header cell; `r` right-aligns (numbers). */
export function Th({ children, r }: ThProps) {
  return <th className={`p-3 font-semibold text-xs text-mute ${r ? 'text-right' : 'text-left'}`}>{children}</th>;
}

/** Rounded, horizontally scrolling box around a full-width <table>. */
export function TableBox({ children }: TableBoxProps) {
  return (
    <div className="scroll rounded-2xl border border-line">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
