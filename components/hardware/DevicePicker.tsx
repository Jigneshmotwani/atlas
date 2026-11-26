'use client';
// components/hardware/DevicePicker.tsx — "Pick devices" tab: catalog search, category chips, quantities, host PC. Owned by W7.
import { useMemo, useState } from 'react';
import { deviceMatchesQuery } from '@/lib/device-names';
import type { Device, HardwareSpec, HostPc, SetupPick } from '@/lib/contracts';
import { Icon } from '@/components/ui';

const SHOW_MAX = 200;
const HOST_FIELDS: [keyof HostPc, string, string][] = [['ramGb', 'System RAM', 'GB'], ['ramBwGbs', 'RAM bandwidth', 'GB/s'], ['diskFreeGb', 'Free disk', 'GB'], ['diskReadGbs', 'Disk speed', 'GB/s']];

export interface DevicePickerProps {
  devices: Device[];
  aliases: Record<string, string[]>;
  picks: SetupPick[];
  setPicks(p: SetupPick[]): void;
  host: HostPc;
  setHost(h: HostPc): void;
  spec: HardwareSpec | null;
  onFineTune(): void;
}

const CATEGORY_ORDER = ['AI box', 'Mac', 'GPU', 'Workstation GPU', 'Data center', 'Laptop GPU'];

export function DevicePicker({ devices, aliases, picks, setPicks, host, setHost, spec, onFineTune }: DevicePickerProps) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  // prototype order: AI box, Mac, GPU, Workstation GPU, Data center, Laptop GPU, then any others; verified first, natural name order inside
  const sorted = useMemo(() => {
    const rank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i; };
    return [...devices].sort((a, b) => Number(b.verified) - Number(a.verified) || rank(a.category) - rank(b.category) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [devices]);
  const cats = useMemo(() => [...new Set(sorted.map(d => d.category))], [sorted]);
  const qty = (id: string) => picks.find(p => p.deviceId === id)?.qty ?? 0;
  const list = useMemo(() => {
    // brand words are ignored: "asus rog 4090" finds GeForce RTX 4090, "dell gb300" finds the DGX Station
    return sorted.filter(d => (cat === 'All' || d.category === cat) && deviceMatchesQuery(q, [d.name, ...(aliases[d.id] ?? [])]));
  }, [sorted, aliases, q, cat]);
  const step = (id: string, dv: number) => {
    const n = Math.max(0, qty(id) + dv);
    const rest = picks.filter(p => p.deviceId !== id);
    setPicks(n > 0 ? (qty(id) ? picks.map(p => (p.deviceId === id ? { ...p, qty: n } : p)) : [...picks, { deviceId: id, qty: n }]) : rest);
  };
  const needsHost = picks.some(p => p.qty > 0 && devices.find(d => d.id === p.deviceId)?.type === 'gpu');
  const total = devices.length.toLocaleString('en-US');

  return (
    <>
      <div className="relative">
        <span className="absolute left-3.5 top-3.5 text-mute"><Icon name="search" size={16} /></span>
        <label htmlFor="dq" className="sr-only">Search devices</label>
        <input id="dq" value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${total} devices`} className="h-11 pl-10 pr-3 w-full rounded-full border border-line bg-card" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {['All', ...cats].map(c => (
          <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c}
            className={`h-9 px-3 rounded-full text-xs font-semibold border ${cat === c ? 'bg-ink text-bg border-ink' : 'border-line'}`}>{c}</button>
        ))}
      </div>
      <ul className="max-h-80 overflow-y-auto divide-y divide-line -mx-1 px-1">
        {list.slice(0, SHOW_MAX).map(d => {
          const n = qty(d.id);
          return (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2.5">
              <div>
                <div className="text-sm font-semibold">{d.name}</div>
                <div className="text-xs text-mute num">{d.memGb} GB {d.type === 'unified' ? 'unified' : d.type === 'cpu' ? 'RAM' : 'VRAM'} · {d.bwGbs} GB/s</div>
              </div>
              {n > 0 ? (
                <div className="flex items-center gap-1 pop">
                  <button type="button" aria-label={'Remove ' + d.name} onClick={() => step(d.id, -1)} className="h-9 w-9 rounded-full border border-line font-bold">−</button>
                  <span className="w-6 text-center num font-bold">{n}</span>
                  <button type="button" aria-label={'Add another ' + d.name} onClick={() => step(d.id, 1)} className="h-9 w-9 rounded-full border border-line font-bold">+</button>
                </div>
              ) : (
                <button type="button" onClick={() => step(d.id, 1)} className="h-9 px-4 rounded-full border border-line text-xs font-bold uppercase tracking-[.06em] hover:bg-acc hover:border-acc hover:text-onacc transition-colors">Add</button>
              )}
            </li>
          );
        })}
        {list.length > SHOW_MAX && <li className="py-3 text-xs text-mute">Showing {SHOW_MAX} of {list.length.toLocaleString('en-US')}. Type to narrow the list.</li>}
        {!list.length && <li className="py-4 text-sm text-mute">No device found. Use Enter specs instead.</li>}
      </ul>
      {needsHost && (
        <div className="rounded-2xl bg-soft p-4">
          <h3 className="font-semibold text-sm">The PC the GPU sits in</h3>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {HOST_FIELDS.map(([k, l, u]) => (
              <div key={k}>
                <label htmlFor={'h' + k} className="text-xs font-semibold">{l}</label>
                <div className="flex mt-1">
                  <input id={'h' + k} type="number" min="0" inputMode="decimal" value={host[k]}
                    onChange={e => setHost({ ...host, [k]: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-10 w-full rounded-l-xl border border-line bg-card px-2 num" />
                  <span className="h-10 px-2 grid place-items-center rounded-r-xl border border-l-0 border-line bg-card text-xs text-mute">{u}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {spec && (
        <button type="button" onClick={onFineTune} className="text-sm font-semibold underline underline-offset-4 decoration-[var(--acc)] decoration-2 h-10">
          Fine-tune these specs by hand
        </button>
      )}
    </>
  );
}
