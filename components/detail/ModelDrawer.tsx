'use client';
// components/detail/ModelDrawer.tsx — model detail drawer (W6). Also opened by the Hardware page (W7); self-contained.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dialog } from 'radix-ui';
import type { Calibration, EtaCalibration, FileRow, HardwareSpec, RunStat, ScoredModel } from '@/lib/contracts';
import { fitFile, K, scoreModels } from '@/lib/engine';
import { fmt1, fmtAgo, fmtCtx, fmtTime, fmtUsd } from '@/lib/format';
import { HARDWARE_KEY, readSavedSpec } from '@/lib/state';
import { Card, Icon, Pill, PopNumber, Select, Tag, Th, WhereTag } from '@/components/ui';
import { useStoredRaw } from './hooks';
import { kldOf, METRIC_LABEL, SOURCES, fmtTps } from './labels';

const CTX_K = 32;

export interface ModelDrawerProps {
  /** `files`: shown when some belong to this model; otherwise the drawer fetches `/api/files?model=` itself */
  model: ScoredModel; files: FileRow[]; calibrations: Calibration[]; runStats: RunStat[]; eta: EtaCalibration[];
  onClose(): void;
  spec?: HardwareSpec | null;   // omitted → readSavedSpec()
}

/** Keyed by model id so the provider / tasks-per-day inputs reset when another model is opened. */
export function ModelDrawer(props: ModelDrawerProps) {
  return <DrawerBody key={props.model.id} {...props} />;
}

function DrawerBody(props: ModelDrawerProps) {
  const { model, files, calibrations, runStats, eta, onClose } = props;

  // saved hardware (read after hydration; null = never set up)
  const savedRaw = useStoredRaw(HARDWARE_KEY);
  const saved = useMemo(() => (savedRaw ? readSavedSpec() : null), [savedRaw]);
  const spec = props.spec === undefined ? saved : props.spec;

  // API provider switch: re-score this one model with the chosen offer
  const providers = useMemo(() => [...new Set(model.offers.filter(o => o.priceIn != null).map(o => o.provider))], [model.offers]);
  const [provider, setProvider] = useState<string>(model.offer?.provider ?? providers[0] ?? '');
  const m = useMemo(() => provider && provider !== model.offer?.provider
    ? scoreModels([model], calibrations, { provider: { [model.id]: provider } })[0] ?? model
    : model, [model, calibrations, provider]);
  const [perDay, setPerDay] = useState(50);
  const monthly = m.costPerTask != null ? m.costPerTask * perDay * 30 : null;

  // intelligence by source
  const intel = m.perSource.filter(p => p.metric === 'intelligence');
  const missing = SOURCES.filter(s => !intel.some(p => p.source === s.id)).map(s => ({
    ...s, scored: m.scores.some(x => x.source === s.id && x.metric === 'intelligence'),
  }));

  // files from the prop, else fetched once for this model (the Explorer / Recommender don't ship them)
  const given = useMemo(() => files.filter(f => f.modelId === model.id), [files, model.id]);
  const needFetch = model.openWeights && given.length === 0;
  const [fetched, setFetched] = useState<FileRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!needFetch) return;
    let live = true;
    fetch(`/api/files?model=${encodeURIComponent(model.id)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: unknown) => { if (live) setFetched(Array.isArray(rows) ? (rows as FileRow[]).filter(f => f.modelId === model.id) : []); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [needFetch, model.id]);
  const loading = needFetch && fetched == null && !failed;

  // files: official rows, then one file nearest 4.8 bits per derivative repo (finetune / abliterated / merge) and per quant uploader
  const own = given.length ? given : fetched ?? [];
  const quants = own.filter(f => f.kind === 'quant');
  const ups = [...new Set(quants.map(f => f.uploader))];
  const nearest = (fs: FileRow[]) => [...fs].sort((a, b) => Math.abs(a.bitsPerWeight - 4.8) - Math.abs(b.bitsPerWeight - 4.8))[0];
  const derived = own.filter(f => f.kind !== 'quant' && f.kind !== 'official');
  const show = [
    ...own.filter(f => f.kind === 'official'),
    ...[...new Set(derived.map(f => f.repo))].map(r => nearest(derived.filter(f => f.repo === r))),
    ...ups.map(u => nearest(quants.filter(f => f.uploader === u))),
  ];

  const o = m.offer;
  const details: [string, string][] = [
    // domain scores this model doesn't have (most, on the free AA tier) are left out rather than shown as '–'
    ...(['coding', 'agentic', 'cyber', 'math', 'long_ctx'] as const).filter(k => m.domain[k] != null).map((k): [string, string] => [METRIC_LABEL[k], fmt1(m.domain[k])]),
    ['Context window', fmtCtx(m.contextK)],
    ['Price in / out', o?.priceIn != null && o.priceOut != null ? `$${o.priceIn} / $${o.priceOut}` : '–'],
    ['Speed', fmtTps(o?.tpsMedian)],
    ['Input', m.inModalities.join(', ')],
    ['Output', m.outModalities.join(', ')],
  ];

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade fixed inset-0 z-50" style={{ background: 'color-mix(in srgb, var(--night) 50%, transparent)' }} />
        <Dialog.Content aria-describedby={undefined}
          className="slide fixed inset-y-0 right-0 z-50 w-full max-w-xl h-full overflow-y-auto bg-bg text-ink p-5 sm:p-7 focus:outline-none">
          <div className="flex justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-mute">{m.creatorName}</div>
              <Dialog.Title className="text-3xl font-semibold tracking-tight">{m.name}</Dialog.Title>
            </div>
            <Dialog.Close aria-label="Close" className="h-11 w-11 shrink-0 grid place-items-center rounded-full border border-line bg-card"><Icon name="x" /></Dialog.Close>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-5">
            {([['Intelligence', fmt1(m.intelligence)], [m.costEstimated ? 'Cost / task · est.' : 'Cost / task', fmtUsd(m.costPerTask)], ['Time / task', fmtTime(m.timePerTask)]] as const).map(([l, v]) => (
              <Card key={l} className="p-3"><div className="text-xs text-mute">{l}</div><PopNumber value={v} className="text-[clamp(26px,6vw,36px)] leading-tight" /></Card>
            ))}
          </div>

          {providers.length > 0 && (
            <Card className="mt-2 p-3.5 flex flex-wrap items-end gap-x-5 gap-y-3">
              <label className="flex flex-col gap-1.5 text-xs text-mute min-w-0">
                API provider
                <Select value={provider} onChange={e => setProvider(e.target.value)} className="max-w-full">
                  {providers.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-mute">
                Tasks per day
                <input type="number" min={0} step={10} inputMode="numeric" value={perDay}
                  onChange={e => setPerDay(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="h-10 w-28 rounded-full border border-line bg-card px-4 text-sm font-semibold text-ink num" />
              </label>
              <div className="ml-auto text-right">
                <div className="text-xs text-mute">Per month</div>
                <PopNumber value={fmtUsd(monthly)} className="text-3xl leading-tight" />
              </div>
            </Card>
          )}

          <h3 className="font-semibold mt-7">Intelligence by source</h3>
          <Card className="mt-2 p-1">
            <div className="scroll">
              <table className="w-full text-sm">
                <thead><tr><Th>Source</Th><Th r>Raw</Th><Th r>Calibrated</Th><Th r>Synced</Th></tr></thead>
                <tbody>
                  {intel.map(s => (
                    <tr key={s.source} className="border-t border-line">
                      <td className="p-3 font-semibold">{SOURCES.find(x => x.id === s.source)?.name ?? s.source}</td>
                      <td className="p-3 text-right num">{fmt1(s.raw)}</td>
                      <td className="p-3 text-right num font-bold">{fmt1(s.calibrated)}</td>
                      <td className="p-3 text-right text-mute whitespace-nowrap">{fmtAgo(s.fetchedAt)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ink">
                    <td className="p-3 font-bold">Average</td><td />
                    <td className="p-3 text-right num font-bold">{fmt1(m.intelligence)}</td>
                    <td className="p-3 text-right text-xs text-mute whitespace-nowrap">{m.spread != null ? `spread ${fmt1(m.spread)}` : intel.length === 1 ? 'one source' : ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          {missing.map(s => (
            <p key={s.id} className="text-xs text-mute mt-1">
              {s.name}: {s.scored ? 'not calibrated yet, left out of the average' : 'not tested, left out of the average'}
            </p>
          ))}

          <dl className="grid grid-cols-2 gap-x-6 text-sm mt-6">
            {details.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-line py-2"><dt className="text-mute">{k}</dt><dd className="num font-semibold text-right">{v}</dd></div>
            ))}
          </dl>

          {m.openWeights && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-7">
                <h3 className="font-semibold">Files on Hugging Face</h3>
                {ups.length > 1 && <Pill small href={`/quants?model=${encodeURIComponent(m.id)}`}>Compare {quants.length} quants</Pill>}
              </div>
              <p className="text-sm text-mute mt-1">
                {spec ? 'Checked against your hardware at 32K context.' : <><Link href="/hardware" className="underline underline-offset-4 decoration-2" style={{ textDecorationColor: 'var(--acc)' }}>Set up your hardware</Link> to see what runs.</>}
              </p>
              {loading ? <p className="text-sm text-mute mt-3" aria-live="polite">Loading files…</p>
                : failed ? <p className="text-sm text-mute mt-3">Couldn&apos;t load files. Close and reopen to try again.</p>
                : !show.length && <p className="text-sm text-mute mt-3">No files synced yet.</p>}
              <div className="mt-3 space-y-2">
                {show.map(f => {
                  const r = spec ? fitFile(m, f, spec, CTX_K, { runStats, eta }) : null;
                  const kld = kldOf(f);
                  return (
                    <Card key={f.id} className="p-3.5">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm break-all">{f.repo}</div>
                          <div className="text-xs text-mute num">{f.quant} · {fmt1(f.bitsPerWeight)} bits · {fmt1(f.sizeGb)} GB</div>
                        </div>
                        {r && <WhereTag where={r.where} />}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {f.kind !== 'quant' && <Tag tone={f.kind === 'abliterated' ? 'warn' : undefined}>{f.kind}</Tag>}
                        {kld === 0 ? <Tag>reference</Tag>
                          : kld == null ? <Tag tone="warn">no quality data</Tag>
                          : <Tag>KLD {kld}{kld <= K.kld.nearLossless ? ' · near-lossless' : kld < K.kld.small ? ' · small loss' : ' · noticeable loss'}</Tag>}
                        {r?.speed?.kind === 'measured' ? <Tag tone="mint">{r.speed.p50} tok/s measured</Tag>
                          : r && r.where !== 'no' && r.speed?.kind === 'estimate' ? <Tag>{r.speed.lo}–{r.speed.hi} tok/s est.</Tag> : null}
                      </div>
                      {r?.where === 'no' && r.why && <p className="text-xs text-mute mt-1.5">{r.why}</p>}
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
