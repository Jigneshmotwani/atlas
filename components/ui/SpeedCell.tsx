import type { FitResult } from '@/lib/contracts';
import { fmt1 } from '@/lib/format';
import { Tag } from './Tag';

export interface SpeedCellProps { fit: FitResult | null }

export function SpeedCell({ fit }: SpeedCellProps) {
  const s = fit?.speed;
  if (!fit || fit.where === 'no' || !s) return <span className="text-mute">–</span>;
  if (s.kind === 'measured') {
    return (
      <div className="text-right">
        <div className="num font-bold">{fmt1(s.p50)} tok/s</div>
        <div className="text-xs mt-0.5"><Tag tone="mint">measured · {s.nRuns} runs</Tag></div>
      </div>
    );
  }
  return (
    <div className="text-right">
      <div className="num font-semibold">{fmt1(s.lo)}–{fmt1(s.hi)} tok/s</div>
      <div className="text-xs text-mute">estimate</div>
    </div>
  );
}
