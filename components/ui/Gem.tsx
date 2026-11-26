// Crystal icons, one shape per section (prototype Gem). Gradient stops are the brand colours.
import type { ReactNode } from 'react';

export type GemKind = 'explorer' | 'recommend' | 'hardware' | 'quants' | 'probe';
export interface GemProps { kind: GemKind; size?: number }

function shape(kind: GemKind, fill: string): ReactNode {
  switch (kind) {
    case 'explorer':
      return <><path d="M20 3l14 8v18l-14 8-14-8V11z" fill={fill} /><path d="M20 3v16l14-8M20 19L6 11M20 19v18" stroke="white" strokeOpacity=".55" strokeWidth="1.2" fill="none" /></>;
    case 'recommend':
      return <><path d="M20 2l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" fill={fill} /><path d="M20 2v36M2 20h36" stroke="white" strokeOpacity=".45" strokeWidth="1.2" /></>;
    case 'hardware':
      return <><rect x="7" y="7" width="26" height="26" rx="6" fill={fill} /><rect x="14" y="14" width="12" height="12" rx="2.5" fill="white" fillOpacity=".55" /><path d="M14 3v4M20 3v4M26 3v4M14 33v4M20 33v4M26 33v4M3 14h4M3 20h4M3 26h4M33 14h4M33 20h4M33 26h4" stroke={fill} strokeWidth="2.4" strokeLinecap="round" /></>;
    case 'quants':
      return <><path d="M6 30l8-14 6 8 6-14 8 20z" fill={fill} /><circle cx="14" cy="16" r="3" fill="white" /><circle cx="26" cy="10" r="3" fill="white" /><path d="M4 34h32" stroke={fill} strokeWidth="2.4" strokeLinecap="round" /></>;
    case 'probe':
      return <><path d="M20 4a16 16 0 1 1 0 32 16 16 0 0 1 0-32z" fill={fill} /><path d="M20 20L29 11" stroke="white" strokeWidth="2.6" strokeLinecap="round" /><circle cx="20" cy="20" r="3" fill="white" /></>;
  }
}

export function Gem({ kind, size = 40 }: GemProps) {
  const id = 'g' + kind;
  return (
    <svg className="gem" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B4D7CD" />
          <stop offset=".55" stopColor="#8EA8C3" />
          <stop offset="1" stopColor="#F47321" />
        </linearGradient>
      </defs>
      {shape(kind, `url(#${id})`)}
    </svg>
  );
}
