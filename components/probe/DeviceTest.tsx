'use client';
// Device test (/probe): three step cards copied from the prototype's DEVICE TEST (W8).
// Step 3 turns a pasted atlas-probe profile into a HardwareSpec and hands it to Hardware → Enter specs.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, Icon, Pill, Switch } from '@/components/ui';
import type { Arch, Backend, HardwareSpec } from '@/lib/contracts';
import { BLANK_SPEC, writeProbeHandoff } from '@/lib/state';
import { resolveDevice, type DeviceName } from './match';

/** A sample DGX Spark profile in the exact Profile JSON format the CLI prints. */
const SAMPLE = JSON.stringify({
  probe_version: '1.0.0', device_name_raw: 'NVIDIA GB10', arch: 'unified', devices: 1, vram_gb: 0, memory_gb: 128,
  measured_bw_gbs: 251, ram_bw_gbs: 251, fp16_tflops: 118, fp8: true, backend: 'cuda', disk_free_gb: 2800, disk_read_gbs: 6.1,
  fingerprint: '3f2c9a4e-8b1d-4c6f-9e2a-7d5b1c0e4f8a',
  runs: [{ file: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL', runtime: 'llama.cpp', runtime_version: 'b6123', ctx: 4096, gen_tps: 9.6, prompt_tps: 640, load_s: 3.1 }],
});

const NOT_A_PROFILE = 'That isn’t an Atlas profile. Paste the JSON the probe prints.';
const ARCHES: Arch[] = ['discrete', 'unified', 'cpu'];
const BACKENDS: Backend[] = ['cuda', 'rocm', 'metal', 'vulkan', 'cpu'];

const pos = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
const nonneg = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);

/** Parse a pasted profile into the Hardware handoff; null when it isn't a profile. */
function readProfile(txt: string, devices: DeviceName[]): { spec: HardwareSpec; label: string; deviceId: string | null } | null {
  let j: unknown;
  try { j = JSON.parse(txt); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const p = j as Record<string, unknown>;
  const memoryGb = pos(p.memory_gb), bw = pos(p.measured_bw_gbs);
  if (memoryGb == null || bw == null) return null;

  const name = typeof p.device_name_raw === 'string' && p.device_name_raw.trim() ? p.device_name_raw.trim() : null;
  const arch = ARCHES.includes(p.arch as Arch) ? (p.arch as Arch) : 'discrete';
  const gpus = Math.max(1, Math.round(pos(p.devices) ?? 1));
  const match = name ? resolveDevice(name, devices) : null;
  const deviceId = match?.id ?? null;
  const spec: HardwareSpec = {
    arch, gpus, vramGb: nonneg(p.vram_gb, 0), gpuBwGbs: bw, link: gpus > 1 ? 'pcie' : 'none',
    ramGb: memoryGb, ramBwGbs: pos(p.ram_bw_gbs) ?? bw, fp16Tflops: nonneg(p.fp16_tflops, 0), fp8: p.fp8 === true,
    backend: BACKENDS.includes(p.backend as Backend) ? (p.backend as Backend) : 'cuda',
    diskFreeGb: nonneg(p.disk_free_gb, BLANK_SPEC.diskFreeGb), diskReadGbs: pos(p.disk_read_gbs) ?? BLANK_SPEC.diskReadGbs,
    ...(deviceId && gpus === 1 ? { deviceId } : {}),
  };
  return { spec, label: `${name ?? 'Your device'}, ${memoryGb} GB, ${bw} GB/s measured`, deviceId };
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="serif text-5xl leading-none text-acc">{n}</span>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

export function DeviceTest({ runs, devicesWithRuns, devices }: { runs: number; devicesWithRuns: number; devices: DeviceName[] }) {
  const router = useRouter();
  const [txt, setTxt] = useState(SAMPLE);
  const [err, setErr] = useState('');
  const [cp, setCp] = useState('');
  const [run, setRun] = useState(false);
  const [share, setShare] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  const cmd = share ? 'npx atlas-probe --bench --share' : 'npx atlas-probe --bench';

  const copy = () => {
    navigator.clipboard?.writeText(cmd).then(() => { setCp('Copied'); later(() => setCp(''), 1400); }).catch(() => {});
  };

  const apply = () => {
    const h = readProfile(txt, devices);
    if (!h) { setErr(NOT_A_PROFILE); return; }
    setRun(true);
    later(() => {
      writeProbeHandoff(h);
      router.push('/hardware?mode=manual&from=probe');
    }, 700);
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4 items-start">
      <Step n="1" title="Choose what to share">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-none"><Switch checked={share} onChange={setShare} aria-labelledby="shl" /></div>
          <div>
            <p id="shl" className="font-semibold text-sm">Share speed results</p>
            <p className="text-sm text-mute mt-1">Adds your measured tok/s to the planner for everyone with the same device. Only device model, file and speeds are sent; no hostname or files.</p>
          </div>
        </div>
        <p className="text-sm mt-4">
          <span className="serif text-3xl num">{runs.toLocaleString('en-US')}</span>{' '}
          <span className="text-mute">runs shared so far across {devicesWithRuns.toLocaleString('en-US')} devices</span>
        </p>
      </Step>

      <Step n="2" title="Run the probe">
        <div className="flex items-center gap-2 rounded-2xl bg-night text-white p-3">
          <span className="text-acc"><Icon name="term" on size={18} /></span>
          <code key={cmd} className="fade flex-1 font-mono text-sm break-all">{cmd}</code>
          <button type="button" onClick={copy} className="h-9 px-3 rounded-full bg-white text-night text-xs font-bold min-w-[4.5rem]">
            {cp ? <span className="pop inline-block">{cp}</span> : 'Copy'}
          </button>
        </div>
        <p className="text-sm text-mute mt-3">Reads GPU, memory, disk and platform, tests memory bandwidth and compute, then times two small models in llama.cpp. About 2 minutes.</p>
      </Step>

      <Step n="3" title="Paste the result">
        <label htmlFor="prof" className="sr-only">Profile JSON</label>
        <textarea
          id="prof" value={txt} rows={5} spellCheck={false}
          onChange={e => { setTxt(e.target.value); setErr(''); }}
          aria-invalid={!!err} aria-describedby={err ? 'prof-err' : undefined}
          className="w-full rounded-2xl border border-line bg-soft p-3 font-mono text-xs"
        />
        {err && <p id="prof-err" role="alert" className="text-warn text-sm font-semibold mt-1">{err}</p>}
        <div className="mt-3"><Pill acc onClick={apply} disabled={run}>{run ? 'Reading profile' : 'See what runs'}</Pill></div>
        <p className="text-xs text-mute mt-2">Pre-filled with a sample DGX Spark profile.</p>
      </Step>
    </div>
  );
}
