import type { ReactNode } from 'react';
import type { Where } from '@/lib/contracts';
import { Icon } from './Icon';

export type TagTone = 'butter' | 'mint' | 'acc' | 'warn';
export interface TagProps { children: ReactNode; tone?: TagTone }
export interface WhereTagProps { where: Where }

const TONE: Record<TagTone, string> = {
  butter: 'bg-butter text-onacc',
  mint: 'bg-mint text-onacc',
  acc: 'bg-acc text-onacc',
  warn: 'text-warn border border-current',
};

export function Tag({ children, tone }: TagProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${tone ? TONE[tone] : 'border border-line text-mute'}`}>
      {children}
    </span>
  );
}

export const WHERE_LABEL: Record<Where, [string, TagTone | undefined]> = {
  gpu: ['All in fast memory', 'mint'],
  offload: ['Spills into RAM', 'butter'],
  cpu: ['CPU only', 'butter'],
  no: ["Won't run", undefined],
};

export function WhereTag({ where }: WhereTagProps) {
  const [label, tone] = WHERE_LABEL[where];
  return (
    <Tag tone={tone}>
      {where === 'no' ? <Icon name="x" size={12} /> : <Icon name="check" size={12} on />}
      {label}
    </Tag>
  );
}
