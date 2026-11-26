'use client';
// components/hardware/SpecForm.tsx — "Enter specs" two-column form (prototype FIELDS). Owned by W7.
import { useState } from 'react';
import type { HardwareSpec } from '@/lib/contracts';
import { Icon, Switch } from '@/components/ui';

type Key = keyof Pick<HardwareSpec, 'arch' | 'gpus' | 'vramGb' | 'ramGb' | 'gpuBwGbs' | 'ramBwGbs' | 'link' | 'fp16Tflops' | 'backend' | 'fp8' | 'diskFreeGb' | 'diskReadGbs'>;
interface FieldDef {
  k: Key; l: string; t: 'n' | 'sel' | 'bool'; u?: string; wide?: boolean; o?: [string, string][]; h: string;
  hide?: (s: HardwareSpec) => boolean;
}

const FIELDS: { g: string; f: FieldDef[] }[] = [
  { g: 'Memory', f: [
    { k: 'arch', l: 'Memory type', t: 'sel', wide: true, o: [['discrete', 'Separate GPU memory (PC with graphics card)'], ['unified', 'Unified / shared memory (Mac, DGX Spark, Ryzen AI Max)'], ['cpu', 'No GPU (CPU only)']], h: 'Unified memory lets the whole RAM act as GPU memory. With a separate card, only the card’s VRAM is fast.' },
    { k: 'gpus', l: 'GPUs / devices', t: 'n', u: '', h: 'More cards add memory. Splitting one model across cards costs some speed.', hide: s => s.arch === 'cpu' },
    { k: 'vramGb', l: 'VRAM per GPU', t: 'n', u: 'GB', h: 'The hard limit for fast inference. Weights + context cache must fit here to run at full speed.', hide: s => s.arch !== 'discrete' },
    { k: 'ramGb', l: 'System RAM', t: 'n', u: 'GB', h: 'On unified machines this is the model memory. On PCs it holds whatever spills out of VRAM, at much lower speed.' },
  ] },
  { g: 'Speed', f: [
    { k: 'gpuBwGbs', l: 'GPU bandwidth', t: 'n', u: 'GB/s', h: 'Sets how fast tokens come out. On the GPU spec sheet (e.g. RTX 4090 ≈ 1,008 GB/s).', hide: s => s.arch === 'cpu' },
    { k: 'ramBwGbs', l: 'RAM bandwidth', t: 'n', u: 'GB/s', h: 'Matters when layers spill into RAM. Dual-channel DDR5 ≈ 80–100 GB/s.', hide: s => s.arch === 'unified' },
    { k: 'link', l: 'Link between GPUs', t: 'sel', wide: true, o: [['pcie', 'PCIe'], ['nvlink', 'NVLink'], ['network', 'Network (separate machines)']], h: 'Only matters with 2+ devices. Separate machines are the slowest to split a model across.', hide: s => s.gpus < 2 || s.arch === 'cpu' },
  ] },
  { g: 'Compute & software', f: [
    { k: 'fp16Tflops', l: 'Compute (FP16)', t: 'n', u: 'TFLOPS', h: 'Sets how fast long prompts are read before the first token.' },
    { k: 'backend', l: 'Software platform', t: 'sel', o: [['cuda', 'NVIDIA CUDA'], ['rocm', 'AMD ROCm'], ['metal', 'Apple Metal'], ['vulkan', 'Vulkan (other GPUs)'], ['cpu', 'CPU only']], h: 'GGUF files run on all of these via llama.cpp. vLLM/SGLang formats need CUDA or ROCm.' },
    { k: 'fp8', l: 'Supports FP8', t: 'bool', h: 'Some official weights ship in FP8 and need a recent GPU (RTX 40/50, H100, Blackwell).' },
  ] },
  { g: 'Storage', f: [
    { k: 'diskFreeGb', l: 'Free disk', t: 'n', u: 'GB', h: 'You must download the full file before running it.' },
    { k: 'diskReadGbs', l: 'Disk speed', t: 'n', u: 'GB/s', h: 'Sets load time. NVMe ≈ 3–7 GB/s, SATA SSD ≈ 0.5 GB/s, HDD ≈ 0.15 GB/s.' },
  ] },
];

/** Any hand edit makes the spec "custom": it no longer is exactly one catalog device. */
function edit(s: HardwareSpec, k: Key, v: HardwareSpec[Key]): HardwareSpec {
  const { deviceId: _d, single: _s, ...rest } = s;
  void _d; void _s;
  return { ...rest, [k]: v } as HardwareSpec;
}

function Field({ d, s, set }: { d: FieldDef; s: HardwareSpec; set(s: HardwareSpec): void }) {
  const [h, setH] = useState(false);
  const id = 'f-' + d.k;
  const value = s[d.k];
  return (
    <div className={d.wide ? 'col-span-2' : ''}>
      <div className="flex items-center gap-1">
        {d.t === 'bool'
          ? <span id={id + '-l'} className="text-sm font-semibold">{d.l}</span>
          : <label htmlFor={id} className="text-sm font-semibold">{d.l}</label>}
        <button type="button" aria-label={'About ' + d.l} aria-expanded={h} onClick={() => setH(!h)} className="h-8 w-8 grid place-items-center rounded-full text-mute hover:text-ink">
          <Icon name="info" size={16} />
        </button>
      </div>
      {h && <p className="fade text-xs text-mute mb-1.5">{d.h}</p>}
      {d.t === 'n' && (
        <div className="flex">
          <input id={id} type="number" min="0" inputMode="decimal" value={Number(value)}
            onChange={e => { const v = Math.max(0, Number(e.target.value) || 0); set(edit(s, d.k, (d.k === 'gpus' ? Math.max(1, Math.round(v)) : v) as HardwareSpec[Key])); }}
            className={`h-11 w-full ${d.u ? 'rounded-l-xl' : 'rounded-xl'} border border-line bg-card px-3 num`} />
          {d.u && <span className="h-11 px-2.5 grid place-items-center rounded-r-xl border border-l-0 border-line bg-soft text-sm text-mute">{d.u}</span>}
        </div>
      )}
      {d.t === 'sel' && (
        <select id={id} value={d.k === 'link' && value === 'none' ? 'pcie' : String(value)}
          onChange={e => set(edit(s, d.k, e.target.value as HardwareSpec[Key]))}
          className="h-11 w-full rounded-xl border border-line bg-card px-2">
          {d.o!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
      {d.t === 'bool' && <Switch id={id} aria-labelledby={id + '-l'} checked={!!value} onChange={v => set(edit(s, d.k, v))} />}
    </div>
  );
}

export function SpecForm({ spec, onChange }: { spec: HardwareSpec; onChange(s: HardwareSpec): void }) {
  return (
    <div className="space-y-5">
      {FIELDS.map(g => (
        <div key={g.g}>
          <h3 className="serif text-2xl">{g.g}</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 mt-2 items-start">
            {g.f.filter(d => !d.hide || !d.hide(spec)).map(d => <Field key={d.k} d={d} s={spec} set={onChange} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
