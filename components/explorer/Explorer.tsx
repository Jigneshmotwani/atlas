'use client';
// components/explorer/Explorer.tsx — Explorer screen (W6): stat tiles, metric chart, table, drawer.
// URL: ?m=<metric>&q=<search>&w=open|closed&r=yes|no&ctx=128|256|1000&p=<creator ids>&in=image,audio,video
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Calibration, EtaCalibration, ModelRow, Modality, RunStat, SourceId } from '@/lib/contracts';
import { scoreModels } from '@/lib/engine';
import { fmt1, fmtCtx, fmtTime, fmtUsd } from '@/lib/format';
import { Card, Chip, Head, Icon, Pill, PopNumber, ProviderSelect, Select, TableBox, Tag, Th } from '@/components/ui';
import { ModelDrawer } from '@/components/detail/ModelDrawer';
import { listOf, oneOf, toQs, useUrlEpoch, useUrlSync, type Query } from '@/components/detail/hooks';
import { FLAG_LABEL, modelSub, SOURCES } from '@/components/detail/labels';
import { useProviders, type CreatorLite } from '@/components/detail/providers';
import { EXPLORER_METRICS, metricDef, type ExplorerMetric } from './metrics';

export interface ExplorerData {
  models: ModelRow[]; calibrations: Calibration[]; creators: CreatorLite[];
  /** number of open-weight files (the drawer fetches a model's files itself) */
  fileCount: number; runStats: RunStat[]; eta: EtaCalibration[];
}

const WEIGHTS = ['any', 'open', 'closed'] as const;
const REASONING = ['any', 'yes', 'no'] as const;
const CTX = [0, 128, 256, 1000] as const;
const INPUTS = ['image', 'audio', 'video'] as const satisfies readonly Modality[];
interface Filters { w: (typeof WEIGHTS)[number]; r: (typeof REASONING)[number]; ctx: number; inp: (typeof INPUTS)[number][] }
const NO_FILES: never[] = [];
const BAR_LIMIT = 15, ROW_LIMIT = 50;
const NO_FILTERS: Filters = { w: 'any', r: 'any', ctx: 0, inp: [] };

/** Reads the URL (needs a Suspense boundary above it). */
export function ExplorerFromUrl(props: ExplorerData) {
  const sp = useSearchParams();
  const epoch = useUrlEpoch(sp); // outside changes to the URL remount the screen from the URL
  return <Explorer key={epoch} {...props} query={sp} />;
}

/** `query = null` renders the default view and never writes the URL (prerendered Suspense fallback). */
export function Explorer({ models, calibrations, creators, fileCount, runStats, eta, query }: ExplorerData & { query: Query }) {
  const scored = useMemo(() => scoreModels(models, calibrations), [models, calibrations]);
  const [mk, setMk] = useState<ExplorerMetric>(() => metricDef(query?.get('m')).k);
  const [q, setQ] = useState(() => query?.get('q') ?? '');
  const [f, setF] = useState<Filters>(() => ({
    w: oneOf(query?.get('w'), WEIGHTS, 'any'),
    r: oneOf(query?.get('r'), REASONING, 'any'),
    ctx: oneOf(Number(query?.get('ctx') ?? 0), CTX, 0),
    inp: listOf(query?.get('in'), INPUTS),
  }));
  const prov = useProviders(query, creators, models);
  const [openId, setOpenId] = useState<string | null>(null);
  // real data has hundreds of models: show the prototype-sized top N, with "Show all" (W1, Wave 2)
  const [allBars, setAllBars] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const searchId = useId();

  const M = metricDef(mk);
  const qs = toQs([['m', mk === 'intelligence' ? null : mk], ['q', q.trim()], ['w', f.w === 'any' ? null : f.w], ['r', f.r === 'any' ? null : f.r],
    ['ctx', f.ctx || null], ['p', prov.param], ['in', f.inp.join(',')]], ['p']);
  useUrlSync(qs, query != null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = scored.filter(m => (m.name + ' ' + m.creatorName).toLowerCase().includes(needle)
      && (f.w === 'any' || (f.w === 'open') === m.openWeights) && (f.r === 'any' || (f.r === 'yes') === !!m.reasoning)
      && prov.value.includes(m.creatorName) && f.inp.every(x => m.inModalities.includes(x)) && (m.contextK ?? 0) >= f.ctx);
    // models without a value for this metric sort last (table shows "–") and get no bar
    return pool.map(m => ({ m, v: M.get(m) })).sort((a, b) => a.v == null ? (b.v == null ? 0 : 1) : b.v == null ? -1 : M.hi ? b.v - a.v : a.v - b.v);
  }, [scored, q, f, prov.value, M]);
  const bars = rows.filter((x): x is { m: (typeof x)['m']; v: number } => x.v != null);
  const max = Math.max(0, ...bars.map(x => x.v)) || 1;
  const leader = bars[0]?.m;

  const averaged = useMemo(() => SOURCES.filter(s => scored.some(m => m.perSource.some(p => p.source === s.id))), [scored]);
  const intelSources = averaged.filter(s => scored.some(m => m.perSource.some(p => p.source === s.id && p.metric === 'intelligence')));
  const raw = (m: (typeof scored)[number], s: SourceId) => m.perSource.find(p => p.source === s && p.metric === 'intelligence')?.raw ?? null;

  const tiles: [string, number][] = [
    ['Models tracked', models.length],
    ['Open-weight files on Hugging Face', fileCount],
    ['Measured speed runs', runStats.reduce((a, r) => a + r.nRuns, 0)],
    ['Benchmark sources averaged', averaged.length],
  ];

  const reset = () => { setQ(''); setF(NO_FILTERS); prov.set(prov.defaults); };
  const tabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = EXPLORER_METRICS.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    setMk(EXPLORER_METRICS[j].k);
    (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
  };

  const title = leader ? `${leader.name} leads on ${M.l.toLowerCase()}`
    : rows.length ? `No ${M.l.toLowerCase()} data for these models` : 'No models match these filters';
  const open = openId ? scored.find(m => m.id === openId) : undefined;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(([l, v], i) => (
          <Card key={l} className="fade p-4 sm:p-5 flex items-end justify-between gap-3" style={{ animationDelay: i * 70 + 'ms' }}>
            <span className="text-xs sm:text-sm text-mute leading-snug max-w-[9rem]">{l}</span>
            <PopNumber value={v} className="text-[clamp(40px,5vw,60px)] leading-none" />
          </Card>
        ))}
      </div>

      <Card className="p-4 sm:p-6">
        <Head title={title} />
        <div className="scroll nobar edge mt-5 -mx-1 px-1">
          <div className="flex gap-1.5 w-max p-1 rounded-full bg-soft border border-line" role="tablist" aria-label="Metric">
            {EXPLORER_METRICS.map((x, i) => (
              <button key={x.k} type="button" role="tab" aria-selected={mk === x.k} tabIndex={mk === x.k ? 0 : -1}
                onClick={() => setMk(x.k)} onKeyDown={e => tabKey(e, i)}
                className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${mk === x.k ? 'bg-ink text-bg' : 'hover:bg-card'}`}>{x.l}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4 items-center">
          <div className="relative w-full sm:w-56">
            <span className="absolute left-3.5 top-3 text-mute"><Icon name="search" size={16} /></span>
            <label htmlFor={searchId} className="sr-only">Search models</label>
            <input id={searchId} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search models"
              className="h-10 pl-10 pr-3 rounded-full border border-line bg-card w-full" />
          </div>
          <Select aria-label="Weights" value={f.w} onChange={e => setF({ ...f, w: oneOf(e.target.value, WEIGHTS, 'any') })}>
            <option value="any">All weights</option><option value="open">Open weights</option><option value="closed">Closed</option>
          </Select>
          <Select aria-label="Reasoning" value={f.r} onChange={e => setF({ ...f, r: oneOf(e.target.value, REASONING, 'any') })}>
            <option value="any">Reasoning: any</option><option value="yes">Reasoning</option><option value="no">Non-reasoning</option>
          </Select>
          <Select aria-label="Minimum context" value={f.ctx} onChange={e => setF({ ...f, ctx: oneOf(Number(e.target.value), CTX, 0) })}>
            {([[0, 'Any context'], [128, '≥128K'], [256, '≥256K'], [1000, '≥1M']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <ProviderSelect value={prov.value} onChange={prov.set} providers={prov.options} defaults={prov.defaults} />
          {INPUTS.map(x => (
            <Chip key={x} type="button" on={f.inp.includes(x)}
              onClick={() => setF(s => ({ ...s, inp: s.inp.includes(x) ? s.inp.filter(y => y !== x) : [...s.inp, x] }))}>{x} in</Chip>
          ))}
        </div>

        {rows.length ? (
          <div key={mk + rows.length} className="mt-6 space-y-2">
            {(allBars ? bars : bars.slice(0, BAR_LIMIT)).map(({ m, v }, i) => (
              <button key={m.id} type="button" onClick={() => setOpenId(m.id)}
                className="w-full grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5rem] sm:grid-cols-[13rem_minmax(0,1fr)_6rem] gap-3 items-center text-left group">
                <span className="text-sm font-semibold truncate group-hover:underline">{m.name}</span>
                <span className="h-6 rounded-full bg-soft overflow-hidden">
                  <span className="bar block h-full rounded-full"
                    style={{ width: Math.max(0, (100 * v) / max) + '%', background: i === 0 ? 'var(--acc)' : m.openWeights ? 'var(--mint)' : 'var(--steel)', animationDelay: i * 40 + 'ms' }} />
                </span>
                <span className="num text-sm font-bold text-right">{M.fmt(v)}</span>
              </button>
            ))}
            {!bars.length && <p className="text-sm text-mute">None of these models has a {M.l.toLowerCase()} value yet.</p>}
            {bars.length > BAR_LIMIT && (
              <button type="button" onClick={() => setAllBars(!allBars)} className="h-10 text-sm font-semibold underline underline-offset-4 decoration-acc decoration-2">
                {allBars ? `Show top ${BAR_LIMIT}` : `Show all ${bars.length}`}
              </button>
            )}
          </div>
        ) : (
          <div className="fade mt-6 rounded-2xl bg-soft p-6">
            <p className="font-semibold">No models match these filters</p>
            <p className="text-mute text-sm mt-1">Search, weights, context, providers and input types all have to match.</p>
            <div className="mt-4"><Pill small onClick={reset}>Reset filters</Pill></div>
          </div>
        )}

        <div className="flex flex-wrap gap-4 mt-4 text-xs text-mute font-semibold">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-steel" />Closed</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-mint" />Open weights</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-acc" />Leader</span>
          <span className="ml-auto">{M.hi ? 'Higher is better' : 'Lower is better'}</span>
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="p-2 sm:p-3">
          <TableBox>
            <thead className="bg-soft">
              <tr>
                <Th>#</Th><Th>Model</Th>
                {mk === 'intelligence' ? intelSources.map(s => <Th key={s.id} r>{s.name}</Th>) : <Th r>{M.l}</Th>}
                <Th r>{mk === 'intelligence' ? 'Average' : 'Intelligence'}</Th>
                <Th r>Cost / task</Th><Th r>Time / task</Th><Th r>Context</Th>
              </tr>
            </thead>
            <tbody>
              {(allRows ? rows : rows.slice(0, ROW_LIMIT)).map(({ m, v }, i) => (
                <tr key={m.id} className="border-t border-line hover:bg-soft">
                  <td className="p-3 num text-mute">{i + 1}</td>
                  <td className="p-3">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <button type="button" onClick={() => setOpenId(m.id)} className="font-semibold hover:underline text-left">{m.name}</button>
                      {m.flags.map(fl => <Tag key={fl} tone={fl === 'one-source' ? undefined : 'warn'}>{FLAG_LABEL[fl]}</Tag>)}
                    </span>
                    <div className="text-xs text-mute">{modelSub(m)}</div>
                  </td>
                  {mk === 'intelligence'
                    ? intelSources.map(s => { const x = raw(m, s.id); return <td key={s.id} className="p-3 text-right num">{x != null ? fmt1(x) : <span className="text-mute">–</span>}</td>; })
                    : <td className="p-3 text-right num font-bold">{M.fmt(v)}</td>}
                  <td className="p-3 text-right num font-bold">{mk === 'intelligence' && m.intelligence != null ? m.intelligence.toFixed(1) : fmt1(m.intelligence)}</td>
                  <td className="p-3 text-right num">{fmtUsd(m.costPerTask)}</td>
                  <td className="p-3 text-right num">{fmtTime(m.timePerTask)}</td>
                  <td className="p-3 text-right num">{fmtCtx(m.contextK)}</td>
                </tr>
              ))}
            </tbody>
          </TableBox>
          {rows.length > ROW_LIMIT && (
            <div className="px-3 pt-2">
              <button type="button" onClick={() => setAllRows(!allRows)} className="h-10 text-sm font-semibold underline underline-offset-4 decoration-acc decoration-2">
                {allRows ? `Show top ${ROW_LIMIT}` : `Show all ${rows.length} models`}
              </button>
            </div>
          )}
          <p className="text-xs text-mute p-3">Average = each source mapped onto the Artificial Analysis scale, then averaged. Sources that haven&apos;t tested a model are skipped.</p>
        </Card>
      )}

      {open && <ModelDrawer model={open} files={NO_FILES} calibrations={calibrations} runStats={runStats} eta={eta} onClose={() => setOpenId(null)} />}
    </div>
  );
}
