'use client';
// components/hardware/Planner.tsx — the Hardware page client (owned by W7).
// State: URL query first (?mode, picks, host, ctx, spec, ai), then localStorage (SavedHardware), then defaults.
// Every change is written back to the URL (debounced history.replaceState) and to SavedHardware.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Calibration, Device, EtaCalibration, FileRow, HardwareSpec, HostPc, ModelRow, RunStat, SetupPick } from '@/lib/contracts';
import { fitModel, scoreModels, specFromPicks } from '@/lib/engine';
import {
  BLANK_SPEC, DEFAULT_HOST, DEFAULT_PICKS, PROBE_HANDOFF_KEY, decodeHost, decodePicks, encodeHost, encodePicks,
  readSavedHardware, takeProbeHandoff, writeSavedHardware, type HardwareMode, type ProbeHandoff,
} from '@/lib/state';
import { Card, Pill } from '@/components/ui';
import { ModelDrawer } from '@/components/detail/ModelDrawer';
import { comparableModelIds } from '@/components/quants/select';
import { AskAi, type AskAiResult, type ChatMsg } from './AskAi';
import { DevicePicker } from './DevicePicker';
import { Results, type FitRow, type HardwareVendor } from './Results';
import { SpecForm } from './SpecForm';
import { HardwareSpecSchema, decodeSpec, encodeSpec } from './spec';

export interface HardwareData {
  models: ModelRow[]; files: FileRow[]; calibrations: Calibration[]; devices: Device[];
  aliases: Record<string, string[]>; runStats: RunStat[]; eta: EtaCalibration[];
  /** vendor-published speeds (NVIDIA / OEM), shown as a labelled tag when the setup matches exactly */
  vendor?: HardwareVendor[];
}

const MODES: [HardwareMode, string][] = [['pick', 'Pick devices'], ['manual', 'Enter specs'], ['ai', 'Ask AI']];
const isMode = (m: string | null): m is HardwareMode => m === 'pick' || m === 'manual' || m === 'ai';
const RANK = { gpu: 0, offload: 1, cpu: 1, no: 2 } as const;
const clampCtx = (n: number) => Math.min(256, Math.max(4, Math.round(n / 4) * 4));
const PROBE_PREFIX = 'Device test: ';
type Params = { get(name: string): string | null; toString(): string };

const noop = () => () => {};
/** false on the server and during hydration, true after: localStorage is only read client-side */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

export function PlannerSkeleton() {
  return (
    <div className="grid lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] gap-5 items-start" aria-busy="true">
      <Card className="p-4 sm:p-5 min-h-[28rem]"><div className="h-12 rounded-full bg-soft border border-line" /></Card>
      <Card className="p-4 sm:p-6 min-h-[28rem]"><div className="h-9 w-2/3 rounded-full bg-soft" /></Card>
    </div>
  );
}

export function HardwarePlanner(props: HardwareData) {
  const mounted = useMounted();
  const params = useSearchParams();
  if (!mounted) return <PlannerSkeleton />;
  return <Planner {...props} params={params} />;
}

interface Init {
  mode: HardwareMode; picks: SetupPick[]; host: HostPc; manual: HardwareSpec; ai: HardwareSpec | null; ctx: number;
  probeLabel: string | null; fromProbe: boolean; setupId: string | null;
}

/** Runs once on the client (lazy useState): URL beats probe handoff beats saved beats defaults. */
function initial(params: Params): Init {
  const saved = readSavedHardware();
  const fromProbe = params.get('from') === 'probe';
  let probe: ProbeHandoff | null = null;
  if (fromProbe) {
    // read without clearing here (initializers may run twice in dev); the effect below clears it
    try { const raw = window.localStorage.getItem(PROBE_HANDOFF_KEY); probe = raw ? (JSON.parse(raw) as ProbeHandoff) : null; } catch { probe = null; }
  }
  const probeSpec = probe ? HardwareSpecSchema.safeParse(probe.spec) : null;
  const m = params.get('mode');
  const ctx = Number(params.get('ctx'));
  // a reload keeps showing "Specs from your device test" while the probe spec is still the manual spec
  const savedProbe = !params.get('spec') && saved?.label?.startsWith(PROBE_PREFIX) ? saved.label.slice(PROBE_PREFIX.length) : null;
  return {
    mode: isMode(m) ? m : probeSpec?.success ? 'manual' : saved?.mode ?? 'pick',
    picks: decodePicks(params.get('picks')) ?? saved?.picks ?? DEFAULT_PICKS,
    host: decodeHost(params.get('host')) ?? saved?.host ?? DEFAULT_HOST,
    manual: (probeSpec?.success ? probeSpec.data : null) ?? decodeSpec(params.get('spec')) ?? saved?.manual ?? BLANK_SPEC,
    ai: decodeSpec(params.get('ai')) ?? saved?.ai ?? null,
    ctx: ctx > 0 ? clampCtx(ctx) : 32,
    probeLabel: probeSpec?.success ? probe!.label : savedProbe,
    fromProbe,
    setupId: params.get('setup'),
  };
}

function Planner({ models, files, calibrations, devices, aliases, runStats, eta, vendor = [], params }: HardwareData & { params: Params }) {
  const [init] = useState(() => initial(params));
  const [mode, setMode] = useState(init.mode);
  const [picks, setPicks] = useState(init.picks);
  const [host, setHost] = useState(init.host);
  const [manual, setManual] = useState(init.manual);
  const [ai, setAi] = useState(init.ai);
  const [ctx, setCtx] = useState(init.ctx);
  const [probeLabel, setProbeLabel] = useState(init.probeLabel);
  const [notice, setNotice] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle');

  // the header "Ask AI ↗" pill (or any link) can change ?mode= while this page is open
  const qsNow = params.toString();
  const [prevQs, setPrevQs] = useState(qsNow);
  if (qsNow !== prevQs) {
    setPrevQs(qsNow);
    const m = params.get('mode');
    if (isMode(m) && m !== mode) setMode(m);
  }

  // probe handoff is read once, then cleared
  useEffect(() => { if (init.fromProbe) takeProbeHandoff(); }, [init.fromProbe]);

  // ?setup=<id> share links load into Enter specs
  useEffect(() => {
    if (!init.setupId) return;
    const ac = new AbortController();
    fetch(`/api/setups?id=${encodeURIComponent(init.setupId)}`, { signal: ac.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { spec?: unknown }) => {
        const s = HardwareSpecSchema.safeParse(d.spec);
        if (!s.success) throw new Error('bad spec');
        setManual(s.data); setMode('manual'); setProbeLabel(null); setNotice(null);
      })
      .catch(() => { if (!ac.signal.aborted) setNotice('That share link could not be opened. It may have expired.'); });
    return () => ac.abort();
  }, [init.setupId]);

  // ---- derived ----------------------------------------------------------------
  const scored = useMemo(() => scoreModels(models.filter(m => m.openWeights), calibrations), [models, calibrations]);
  const filesBy = useMemo(() => {
    const m = new Map<string, FileRow[]>();
    for (const f of files) m.set(f.modelId, [...(m.get(f.modelId) ?? []), f]);
    return m;
  }, [files]);
  const comparable = useMemo(() => comparableModelIds(scored.map(m => m.id), files), [scored, files]);
  const pickSpec = useMemo(() => specFromPicks(picks, devices, host), [picks, devices, host]);
  const spec: HardwareSpec | null = mode === 'pick' ? pickSpec : mode === 'manual' ? manual : ai;

  // vendor numbers apply only to the exact setup they were measured on: N× one catalog device
  const specDeviceId = spec?.deviceId;
  const setup = useMemo(() => mode === 'pick' && picks.length === 1 ? { deviceId: picks[0].deviceId, qty: picks[0].qty }
    : specDeviceId ? { deviceId: specDeviceId, qty: 1 } : null, [mode, picks, specDeviceId]);
  const rows: FitRow[] = useMemo(() => {
    if (!spec) return [];
    return scored.filter(m => (filesBy.get(m.id)?.length ?? 0) > 0).map(m => {
      const mf = filesBy.get(m.id)!;
      const fit = fitModel(m, mf, spec, ctx, { runStats, eta });
      const v = setup ? vendor.find(x => x.modelId === m.id && x.deviceId === setup.deviceId && x.devices === setup.qty && x.genTps != null) : undefined;
      return { m, fit, file: mf.find(f => f.id === fit.best.fileId), compare: comparable.has(m.id), vendor: v };
    }).sort((x, y) => RANK[x.fit.best.where] - RANK[y.fit.best.where] || (y.m.intelligence ?? -1e9) - (x.m.intelligence ?? -1e9));
  }, [spec, scored, filesBy, ctx, runStats, eta, comparable, setup, vendor]);

  const label = useMemo(() => {
    if (mode === 'pick') return picks.map(p => `${p.qty}× ${devices.find(d => d.id === p.deviceId)?.name ?? p.deviceId}`).join(' + ') || undefined;
    if (mode === 'manual') return probeLabel ? PROBE_PREFIX + probeLabel : 'Custom specs';
    return ai ? 'Described to Atlas AI' : undefined;
  }, [mode, picks, devices, probeLabel, ai]);

  // ---- persist: localStorage on every change, URL debounced ----------------------
  useEffect(() => { writeSavedHardware({ mode, picks, host, manual, ai, spec, label }); }, [mode, picks, host, manual, ai, spec, label]);

  const qs = useMemo(() => {
    const p: string[] = [`mode=${mode}`];
    if (picks.length) p.push(`picks=${encodeURIComponent(encodePicks(picks)).replace(/%2C/g, ',').replace(/%3A/g, ':')}`);
    p.push(`host=${encodeHost(host)}`, `ctx=${ctx}`);
    if (mode === 'manual') p.push(`spec=${encodeSpec(manual)}`);
    if (ai) p.push(`ai=${encodeSpec(ai)}`);
    return p.join('&');
  }, [mode, picks, host, ctx, manual, ai]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (window.location.search.replace(/^\?/, '') !== qs) window.history.replaceState(null, '', `${window.location.pathname}?${qs}`);
    }, 250);
    return () => window.clearTimeout(t);
  }, [qs]);

  // ---- actions ------------------------------------------------------------------
  const editManual = (s: HardwareSpec) => { setManual(s); setProbeLabel(null); };
  const onAiResult = (r: AskAiResult) => {
    setAi(r.spec);
    if (r.picks.length) {
      setPicks(r.picks);
      if (r.spec.arch === 'discrete' && r.spec.link !== 'network') setHost({ ramGb: r.spec.ramGb, ramBwGbs: r.spec.ramBwGbs, diskFreeGb: r.spec.diskFreeGb, diskReadGbs: r.spec.diskReadGbs });
    }
  };
  const share = async () => {
    if (!spec || shareState === 'busy') return;
    setShareState('busy');
    try {
      const res = await fetch('/api/setups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }) });
      const d = await res.json().catch(() => null) as { id?: string } | null;
      if (!res.ok || !d?.id) throw new Error('save failed');
      const url = `${window.location.origin}/hardware?setup=${d.id}`;
      try { await navigator.clipboard.writeText(url); setShareState('copied'); setNotice(null); }
      catch { setShareState('idle'); setNotice(`Share link: ${url}`); }
    } catch { setShareState('failed'); }
    window.setTimeout(() => setShareState(s => (s === 'busy' ? s : 'idle')), 2500);
  };

  const openModel = openId ? scored.find(m => m.id === openId) ?? null : null;
  const fastNames = rows.filter(r => r.fit.best.where === 'gpu').slice(0, 3).map(r => r.m.name);
  const shareBtn = (
    <Pill small onClick={share} disabled={shareState === 'busy'} aria-label="Share this setup as a link">
      {shareState === 'copied' ? 'Link copied' : shareState === 'failed' ? 'Could not save' : shareState === 'busy' ? 'Saving…' : 'Share setup'}
    </Pill>
  );

  return (
    <div className="grid lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] gap-5 items-start">
      <Card className="p-4 sm:p-5">
        <div role="tablist" aria-label="Hardware input" className="grid grid-cols-3 p-1 rounded-full bg-soft border border-line">
          {MODES.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={`h-10 rounded-full text-sm font-semibold transition-colors ${mode === k ? 'bg-ink text-bg' : ''}`}>{l}</button>
          ))}
        </div>
        <div key={mode} role="tabpanel" className="fade mt-4 space-y-4">
          {mode === 'ai' ? (
            <AskAi msgs={msgs} setMsgs={setMsgs} spec={spec} onResult={onAiResult} summary={{ run: rows.filter(r => r.fit.best.where !== 'no').length, total: rows.length, fast: fastNames }} />
          ) : mode === 'pick' ? (
            <DevicePicker devices={devices} aliases={aliases} picks={picks} setPicks={setPicks} host={host} setHost={setHost} spec={pickSpec}
              onFineTune={() => { if (pickSpec) { setManual(pickSpec); setProbeLabel(null); setMode('manual'); } }} />
          ) : (
            <SpecForm spec={manual} onChange={editManual} />
          )}
        </div>
      </Card>
      <Results spec={spec} rows={rows} mode={mode} ctx={ctx} setCtx={setCtx} probeLabel={probeLabel} notice={notice} onOpen={m => setOpenId(m.id)} share={shareBtn} />
      {openModel && (
        <ModelDrawer model={openModel} files={filesBy.get(openModel.id) ?? []} calibrations={calibrations} runStats={runStats} eta={eta} onClose={() => setOpenId(null)} spec={spec} />
      )}
    </div>
  );
}
