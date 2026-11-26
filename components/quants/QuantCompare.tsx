'use client';
// components/quants/QuantCompare.tsx — the Quants page client (owned by W7). ?model= picks the model.
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import type { EtaCalibration, FileRow, HardwareSpec, ModelRow, RunStat } from '@/lib/contracts';
import { K, fastMemoryGb, fitFile, quantView } from '@/lib/engine';
import { HARDWARE_KEY, readSavedSpec } from '@/lib/state';
import { Card, Chip, Head, SpeedCell, TableBox, Tag, Th } from '@/components/ui';
import { Mark, Scatter, type ScatterPoint } from './Scatter';
import { MIN_RATED_QUANTS, bestEvalSet, kldIn } from './select';

export interface QuantData { models: ModelRow[]; files: FileRow[]; runStats: RunStat[]; eta: EtaCalibration[] }

const subscribe = (cb: () => void) => { window.addEventListener('storage', cb); return () => window.removeEventListener('storage', cb); };
/** saved hardware raw string; null on the server and during hydration */
const useSavedRaw = () => useSyncExternalStore(subscribe, () => { try { return window.localStorage.getItem(HARDWARE_KEY); } catch { return null; } }, () => null);

const kvBytes = (m: ModelRow) => m.kvBytesPerToken ?? Math.min(K.kvFallbackMax, K.kvFallbackBytesPerActiveB * (m.activeParamsB ?? 10));
const NAMES_MAX = 8;

export function QuantCompare({ models, files, runStats, eta }: QuantData) {
  const params = useSearchParams();
  const savedRaw = useSavedRaw();
  const spec: HardwareSpec | null = useMemo(() => (savedRaw ? readSavedSpec() : null), [savedRaw]);

  const filesBy = useMemo(() => {
    const m = new Map<string, FileRow[]>();
    for (const f of files) m.set(f.modelId, [...(m.get(f.modelId) ?? []), f]);
    return m;
  }, [files]);
  const { qm, others } = useMemo(() => {
    const qm: { m: ModelRow; evalSet: string; count: number }[] = [], others: ModelRow[] = [];
    for (const m of models) {
      const b = bestEvalSet(filesBy.get(m.id) ?? []);
      if (b.evalSet && b.count >= MIN_RATED_QUANTS) qm.push({ m, evalSet: b.evalSet, count: b.count }); else if (m.openWeights) others.push(m);
    }
    return { qm, others };
  }, [models, filesBy]);

  const [budRaw, setBud] = useState<number | null>(null);
  // no ?model= → the model with the most rated quants (prototype opens on Qwen3.8-27B)
  const sel = qm.find(x => x.m.id === params.get('model')) ?? [...qm].sort((a, b) => b.count - a.count)[0];
  const othersNote = others.length
    ? `Not enough quants to compare yet for ${others.slice(0, NAMES_MAX).map(x => x.name).join(', ')}${others.length > NAMES_MAX ? ` and ${others.length - NAMES_MAX} more` : ''}.`
    : '';
  const footnote = <p className="text-xs text-mute p-3">KLD = how far a quant&apos;s token probabilities drift from the original BF16 model, measured on the same long, mixed test set for every uploader. {othersNote}</p>;

  if (!sel) {
    return (
      <Card className="p-4 sm:p-6">
        <Head title="No model has enough rated quants yet" />
        <p className="text-mute mt-1">A model shows up here once {MIN_RATED_QUANTS} or more of its quants have a measured KLD.</p>
        {footnote}
      </Card>
    );
  }
  return <View key={sel.m.id} m={sel.m} evalSet={sel.evalSet} files={filesBy.get(sel.m.id) ?? []} qm={qm.map(x => x.m)} spec={spec}
    budRaw={budRaw} setBud={setBud} runStats={runStats} eta={eta} footnote={footnote} />;
}

interface ViewProps {
  m: ModelRow; evalSet: string; files: FileRow[]; qm: ModelRow[]; spec: HardwareSpec | null;
  budRaw: number | null; setBud(n: number): void; runStats: RunStat[]; eta: EtaCalibration[]; footnote: ReactNode;
}

function View({ m, evalSet, files, qm, spec, budRaw, setBud, runStats, eta, footnote }: ViewProps) {
  const all = useMemo(() => files.filter(f => f.kind === 'quant').sort((a, b) => a.sizeGb - b.sizeGb), [files]);
  const k = (f: FileRow) => kldIn(f, evalSet);
  const rated = all.filter(f => (k(f) ?? 0) > 0);
  const lo = Math.floor(Math.min(...rated.map(f => f.sizeGb))), hi = Math.ceil(Math.max(...rated.map(f => f.sizeGb)));
  const clampB = (v: number) => Math.min(hi, Math.max(lo, v));
  const fit = spec ? Math.floor(fastMemoryGb(spec) - kvBytes(m) * 32000 / 2 ** 30 - 1.5) : null;
  const bud = clampB(budRaw ?? fit ?? Math.round((lo + hi) / 2));

  const view = useMemo(() => quantView(files, evalSet, bud), [files, evalSet, bud]);
  const byId = new Map(files.map(f => [f.id, f]));
  const pt = (f: FileRow): ScatterPoint => ({ id: f.id, gb: f.sizeGb, kld: k(f) ?? 0, up: f.uploader, q: f.quant });
  const pts = view.points.map(pt);
  const front = view.frontier.map(id => byId.get(id)).filter((f): f is FileRow => !!f).map(pt);
  const frontIds = new Set(view.frontier);
  const best = view.bestUnder != null ? byId.get(view.bestUnder) ?? null : null;
  const gap = view.uploaderGap;
  const ups = [...new Set(view.points.map(f => f.uploader))];
  const pick = (id: string) => window.history.replaceState(null, '', `${window.location.pathname}?model=${encodeURIComponent(id)}`);

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-6">
        <Head title={best ? `Best under ${bud} GB: ${best.uploader} ${best.quant}` : `No ${m.name} quant fits in ${bud} GB`} />
        <p className="text-mute mt-1">
          {best ? `KLD ${k(best)} at ${best.sizeGb} GB. ` : ''}
          {gap ? `At about ${Math.round(gap.a.sizeGb)} GB, ${gap.a.uploader}'s file loses ${gap.ratio.toFixed(1)}× less than ${gap.b.uploader}'s.` : ''}
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          {qm.map(x => <Chip key={x.id} on={x.id === m.id} onClick={() => pick(x.id)}>{x.name}</Chip>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="bud" className="text-sm font-semibold">Memory budget</label>
          <input id="bud" type="range" min={lo} max={hi} step="0.5" value={bud} onChange={e => setBud(+e.target.value)} className="flex-1 min-w-[10rem] accent-[var(--acc)] h-8" />
          <span className="num font-semibold text-sm w-16 text-right">{bud} GB</span>
          {fit != null && (
            <button type="button" onClick={() => setBud(clampB(fit))} className="h-9 px-4 rounded-full border border-line text-xs font-bold uppercase tracking-[.06em] hover:border-ink">
              Use my hardware ({fit} GB)
            </button>
          )}
        </div>
        <div className="mt-4"><Scatter pts={pts} front={front} best={best ? pt(best) : null} bud={bud} /></div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-xs font-semibold">
          {ups.map(u => <span key={u} className="flex items-center gap-1.5"><svg width="16" height="16" aria-hidden="true"><Mark x={8} y={8} u={u} r={5} /></svg>{u}</span>)}
          <span className="flex items-center gap-1.5 text-mute">
            <svg width="22" height="10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" stroke="var(--ink)" strokeDasharray="5 4" strokeWidth="1.5" /></svg>best trade-off line
          </span>
        </div>
      </Card>
      <Card className="p-2 sm:p-3">
        <TableBox>
          <thead className="bg-soft"><tr><Th>Uploader</Th><Th>Quant</Th><Th r>Bits</Th><Th r>Size</Th><Th r>KLD</Th><Th>Quality</Th>{spec && <Th r>On your hardware</Th>}</tr></thead>
          <tbody>
            {all.map(f => {
              const kv = k(f), r = spec ? fitFile(m, f, spec, 32, { runStats, eta }) : null, under = f.sizeGb <= bud;
              return (
                <tr key={f.id} className={`border-t border-line ${under ? '' : 'opacity-50'}`} style={{ background: best?.id === f.id ? 'color-mix(in srgb, var(--butter) 55%, transparent)' : undefined }}>
                  <td className="p-3"><span className="flex items-center gap-2"><svg width="14" height="14" aria-hidden="true"><Mark x={7} y={7} u={f.uploader} r={4.5} /></svg><span className="font-semibold">{f.uploader}</span></span></td>
                  <td className="p-3 num">{f.quant}{frontIds.has(f.id) && <span className="ml-1.5"><Tag>best trade-off</Tag></span>}</td>
                  <td className="p-3 text-right num">{f.bitsPerWeight}</td>
                  <td className="p-3 text-right num">{f.sizeGb} GB</td>
                  <td className="p-3 text-right num font-semibold">{kv ?? '–'}</td>
                  <td className="p-3">{kv == null ? <span className="text-xs text-mute">not rated</span> : kv <= K.kld.nearLossless ? <Tag tone="mint">near-lossless</Tag> : kv < K.kld.small ? <Tag>small loss</Tag> : <Tag tone="warn">noticeable loss</Tag>}</td>
                  {spec && <td className="p-3">{!r || r.where === 'no' ? <span className="text-xs text-mute">Won&apos;t run</span> : <SpeedCell fit={r} />}</td>}
                </tr>
              );
            })}
          </tbody>
        </TableBox>
        {footnote}
      </Card>
    </div>
  );
}
