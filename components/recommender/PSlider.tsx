'use client';
// components/recommender/PSlider.tsx — 1–10 pill priority slider (prototype PSlider), W6.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export interface Priority { k: 'intel' | 'speed' | 'cost'; l: string; c: string; d: string }

export const importance = (v: number) => v <= 2 ? 'Not important' : v <= 4 ? 'Low importance' : v <= 6 ? 'Moderately important' : v <= 8 ? 'Important' : 'Very important';

export function PSlider({ p, value, onChange }: { p: Priority; value: number; onChange(v: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(Math.min(10, Math.max(1, Math.ceil((10 * (e.clientX - r.left)) / r.width))));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    const next = k === 'ArrowRight' || k === 'ArrowUp' ? Math.min(10, value + 1) : k === 'ArrowLeft' || k === 'ArrowDown' ? Math.max(1, value - 1)
      : k === 'Home' ? 1 : k === 'End' ? 10 : k === 'PageUp' ? Math.min(10, value + 3) : k === 'PageDown' ? Math.max(1, value - 3) : null;
    if (next == null) return;
    e.preventDefault();
    if (next !== value) onChange(next);
  };
  const label = importance(value);
  return (
    <div className="rounded-[20px] bg-soft border border-line p-5 sm:p-6 flex flex-col">
      <div className="flex items-center gap-3">
        <span className="h-5 w-5 rounded-md" style={{ background: p.c, boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--onacc) 18%, transparent)' }} />
        <h3 className="serif text-[34px] leading-none">{p.l}</h3>
      </div>
      <p className="text-mute text-sm mt-3 min-h-[2.8rem]">{p.d}</p>
      <div className="flex justify-end items-baseline gap-2 mt-auto pt-6">
        <span key={label} className="fade font-semibold">{label}</span>
        <span className="num text-xs text-mute">{value}/10</span>
      </div>
      <div ref={ref} role="slider" tabIndex={0} aria-label={p.l + ' importance'} aria-valuemin={1} aria-valuemax={10} aria-valuenow={value}
        aria-valuetext={`${value} of 10, ${label}`} aria-orientation="horizontal"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
        onPointerMove={e => { if (e.buttons) at(e); }}
        onKeyDown={key}
        className="relative mt-2 h-12 rounded-full bg-card border border-line cursor-pointer touch-none select-none overflow-hidden">
        <div className="trk absolute inset-y-0 left-0 rounded-full" style={{ width: `${value * 10}%`, background: `color-mix(in srgb, ${p.c} 38%, transparent)` }}>
          <span key={value} className="pop absolute right-2 top-1/2 -mt-4 h-8 w-8 rounded-full grid place-items-center text-xs font-bold num text-onacc"
            style={{ background: p.c, boxShadow: '0 2px 8px color-mix(in srgb, var(--onacc) 25%, transparent)' }}>{value}</span>
        </div>
        {Array.from({ length: 10 }, (_, i) => i + 1).filter(n => n > value).map(n => (
          <span key={n} className="absolute top-1/2 -mt-[3px] h-1.5 w-1.5 -ml-[3px] rounded-full" style={{ left: `${n * 10 - 5}%`, background: 'color-mix(in srgb, var(--mute) 40%, transparent)' }} />
        ))}
      </div>
    </div>
  );
}
