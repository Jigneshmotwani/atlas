'use client';
// Providers dropdown (prototype ProviderSelect): search, All / None / Default, checkboxes with model counts.
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface ProviderSelectProps {
  value: string[];
  onChange(v: string[]): void;
  providers: { name: string; count: number }[];
  defaults: string[];
}

export function ProviderSelect({ value, onChange, providers, defaults }: ProviderSelectProps) {
  const [o, setO] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const qid = useId();

  useEffect(() => {
    if (!o) return;
    const c = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setO(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setO(false); };
    addEventListener('pointerdown', c);
    addEventListener('keydown', k);
    return () => { removeEventListener('pointerdown', c); removeEventListener('keydown', k); };
  }, [o]);

  const list = providers.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
  const quick: [string, string[]][] = [['All', providers.map(p => p.name)], ['None', []], ['Default', defaults]];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={o}
        onClick={() => setO(!o)}
        className="h-10 pl-4 pr-3 rounded-full border border-line bg-card text-sm font-semibold flex items-center gap-2"
      >
        Providers <span className="num rounded-full bg-butter px-2 text-xs font-bold text-onacc">{value.length} of {providers.length}</span>
        <span style={{ transition: 'transform .3s', transform: o ? 'rotate(180deg)' : 'none' }}><Icon name="chev" size={14} /></span>
      </button>
      {o && (
        <div className="fade absolute left-0 z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-2 shadow-[0_18px_40px_rgba(11,18,32,.18)]">
          <label htmlFor={qid} className="sr-only">Search providers</label>
          <input
            id={qid}
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search providers"
            className="h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm"
          />
          <div className="flex gap-3 px-1 py-2 text-xs font-bold">
            {quick.map(([l, v]) => (
              <button key={l} type="button" onClick={() => onChange(v)} className="h-8 underline underline-offset-4 decoration-acc decoration-2">{l}</button>
            ))}
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {list.map(p => (
              <li key={p.name}>
                <label className="flex items-center gap-2.5 h-10 px-2 rounded-xl hover:bg-soft cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value.includes(p.name)}
                    onChange={() => onChange(value.includes(p.name) ? value.filter(x => x !== p.name) : [...value, p.name])}
                    className="h-4 w-4 accent-acc"
                  />
                  <span className="text-sm flex-1">{p.name}</span>
                  {p.count > 0 && <span className="text-xs text-mute num">{p.count}</span>}
                </label>
              </li>
            ))}
            {!list.length && <li className="p-3 text-sm text-mute">No provider found</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
