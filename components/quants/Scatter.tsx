'use client';
// components/quants/Scatter.tsx — KLD (log) vs file size scatter, hand-written SVG like the prototype. Owned by W7.
import { useEffect, useRef, useState } from 'react';

/** uploader → [fill, shape]; colours are the brand tokens (prototype UPC) */
const UPC: Record<string, [string, Shape]> = {
  unsloth: ['var(--acc)', 'circle'], bartowski: ['var(--steel)', 'square'], 'lmstudio-community': ['var(--mint)', 'diamond'],
  mradermacher: ['var(--butter)', 'triangle'], 'ggml-org': ['var(--ink)', 'circle'],
};
type Shape = 'circle' | 'square' | 'diamond' | 'triangle';
const OTHER: [string, Shape] = ['color-mix(in srgb, var(--mute) 40%, var(--card))', 'circle'];
const upStyle = (u: string) => UPC[u] ?? OTHER;

export function Mark({ x, y, u, r = 6.5, ring }: { x: number; y: number; u: string; r?: number; ring?: boolean }) {
  const [c, sh] = upStyle(u);
  const p = { style: { fill: c }, stroke: 'var(--ink)', strokeWidth: 1.2 };
  return (
    <g>
      {ring && <circle cx={x} cy={y} r={r + 6} fill="none" stroke="var(--acc)" strokeWidth="2.5" />}
      {sh === 'square' ? <rect x={x - r + 0.5} y={y - r + 0.5} width={2 * r - 1} height={2 * r - 1} rx="1.5" {...p} />
        : sh === 'diamond' ? <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z`} {...p} />
          : sh === 'triangle' ? <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y + r}L${x - r - 1} ${y + r}Z`} {...p} />
            : <circle cx={x} cy={y} r={r} {...p} />}
    </g>
  );
}

export interface ScatterPoint { id: number; gb: number; kld: number; up: string; q: string }

export function Scatter({ pts, front, best, bud }: { pts: ScatterPoint[]; front: ScatterPoint[]; best: ScatterPoint | null; bud: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSz({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <div ref={ref} className="relative h-[340px] sm:h-[380px]">{sz && pts.length > 0 && <Plot {...sz} pts={pts} front={front} best={best} bud={bud} />}</div>;
}

function Plot({ w, h, pts, front, best, bud }: { w: number; h: number; pts: ScatterPoint[]; front: ScatterPoint[]; best: ScatterPoint | null; bud: number }) {
  const narrow = w < 520, L = narrow ? 44 : 56, R = 16, T = 18, B = 42;
  const xs = pts.map(p => p.gb), x0 = Math.floor(Math.min(...xs) * 0.9), x1 = Math.ceil(Math.max(...xs) * 1.05);
  const yk = pts.map(p => p.kld), y0 = Math.log10(Math.min(...yk) * 0.7), y1 = Math.log10(Math.max(...yk) * 1.4);
  const X = (v: number) => L + (w - L - R) * (v - x0) / (x1 - x0 || 1);
  const Y = (v: number) => T + (h - T - B) * (Math.log10(v) - y0) / (y1 - y0 || 1);
  const yt = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3].filter(v => Math.log10(v) >= y0 && Math.log10(v) <= y1);
  const step = x1 - x0 > 200 ? 100 : x1 - x0 > 60 ? 20 : x1 - x0 > 25 ? 5 : 2;
  const xt: number[] = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) xt.push(v);
  const bx = X(Math.min(Math.max(bud, x0), x1));
  const halo = { paintOrder: 'stroke' as const, stroke: 'var(--card)', strokeWidth: 4 };
  return (
    <svg width={w} height={h} role="img" aria-label="Quality loss versus file size for each quant, by uploader">
      <rect x={bx} y={T} width={Math.max(0, w - R - bx)} height={h - T - B} fill="var(--soft)" />
      {yt.map(v => (
        <g key={v}>
          <line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
          <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="var(--mute)">{v}</text>
        </g>
      ))}
      {xt.filter((_, i) => !narrow || i % 2 === 0).map(v => <text key={v} x={X(v)} y={h - B + 18} textAnchor="middle" fontSize="12" fill="var(--mute)">{v} GB</text>)}
      <text x={L} y={h - 6} fontSize="12" fill="var(--mute)">File size →</text>
      <text x={L - 6} y={T - 6} fontSize="12" fill="var(--mute)" textAnchor="start" transform={`translate(${-L + 14} 0)`}>Quality loss (KLD, log) — lower is better</text>
      <polyline points={front.map(p => `${X(p.gb)},${Y(p.kld)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="5 4" />
      <line x1={bx} x2={bx} y1={T} y2={h - B} stroke="var(--acc)" strokeWidth="2" />
      <text x={Math.min(bx + 6, w - R - 70)} y={T + 14} fontSize="12" fontWeight="700" fill="var(--ink)" style={halo}>{bud} GB budget</text>
      {pts.map(p => <Mark key={p.id} x={X(p.gb)} y={Y(p.kld)} u={p.up} ring={best?.id === p.id} />)}
      {best && <text x={Math.min(X(best.gb) + 14, w - R - 150)} y={Math.max(Y(best.kld) - 14, T + 30)} fontSize="13" fontWeight="700" fill="var(--ink)" style={halo}>{best.up} {best.q}</text>}
    </svg>
  );
}
