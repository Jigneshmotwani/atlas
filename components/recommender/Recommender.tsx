'use client';
// components/recommender/Recommender.tsx — 5-step wizard (W6).
// URL: ?s=<step 1-5>&pri=<intel.speed.cost>&ow=open|closed&r=yes|no&in=image,…&out=image,…&ctx=128|256|400|1000&f=<focus>&p=<creator ids>
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Calibration, EtaCalibration, Metric, Modality, ModelRow, RecommendInput, RunStat } from '@/lib/contracts';
import { recommend, scoreModels } from '@/lib/engine';
import { fmt1, fmtCtx, fmtTime, fmtUsd } from '@/lib/format';
import { Card, Icon, Pill, ProviderSelect, TableBox, Th } from '@/components/ui';
import { ModelDrawer } from '@/components/detail/ModelDrawer';
import { listOf, oneOf, toQs, useUrlEpoch, useUrlSync, type Query } from '@/components/detail/hooks';
import { fmtTps, scoreFor } from '@/components/detail/labels';
import { useProviders, type CreatorLite } from '@/components/detail/providers';
import { OptGroup } from './OptGroup';
import { PSlider, type Priority } from './PSlider';

export interface RecommenderData {
  models: ModelRow[]; calibrations: Calibration[]; creators: CreatorLite[];
  /** number of open-weight files (unused here; the drawer fetches a model's files itself) */
  fileCount: number; runStats: RunStat[]; eta: EtaCalibration[];
}

const PRI: Priority[] = [
  { k: 'intel', l: 'Intelligence', c: 'var(--acc)', d: 'Average benchmark score across Artificial Analysis, Arena, LiveBench and Epoch AI' },
  { k: 'speed', l: 'Speed', c: 'var(--mint)', d: 'Time for an API endpoint to finish a typical task' },
  { k: 'cost', l: 'Cost', c: 'var(--steel)', d: 'What it costs to run a typical task through the API' },
];
const STEPS: [string, string][] = [
  ['Set your priorities', 'Move the sliders to set how important each factor is for your use case'],
  ['What kind of model?', 'Rule out models you can’t use'],
  ['What goes in and out?', 'Only models that handle every type you pick will show'],
  ['Context and use case', 'The use case decides which score counts as intelligence'],
  ['Your matches', 'Ranked by your priorities. Click a model for details.'],
];
const FOCUS: readonly (readonly [Metric, string])[] = [['intelligence', 'General'], ['coding', 'Coding'], ['agentic', 'Agents & tools'], ['cyber', 'Cybersecurity'], ['math', 'Math'], ['long_ctx', 'Long documents']];
const WEIGHTS = ['any', 'open', 'closed'] as const;
const REASONING = ['any', 'yes', 'no'] as const;
const IN_OPTS = [['image', 'Images'], ['audio', 'Audio'], ['video', 'Video'], ['file', 'Files / PDFs']] as const satisfies readonly (readonly [Modality, string])[];
const OUT_OPTS = [['image', 'Images'], ['audio', 'Audio']] as const satisfies readonly (readonly [Modality, string])[];
const CTX_OPTS = [[0, 'Any'], [128, '128K+'], [256, '256K+'], [400, '400K+'], [1000, '1M+']] as const;
type InMod = (typeof IN_OPTS)[number][0];
type OutMod = (typeof OUT_OPTS)[number][0];

interface Answers {
  intel: number; speed: number; cost: number;
  weights: (typeof WEIGHTS)[number]; reason: (typeof REASONING)[number];
  inp: InMod[]; out: OutMod[]; ctx: number; focus: Metric;
}
const NO_FILES: never[] = [];
const DEFAULT_PRI = { intel: 9, speed: 3, cost: 3 };
const clamp10 = (n: number, d: number) => (Number.isFinite(n) && n >= 1 && n <= 10 ? Math.round(n) : d);

function parse(query: Query): Answers {
  const [i, s, c] = (query?.get('pri') ?? '').split('.').map(Number);
  return {
    intel: clamp10(i, DEFAULT_PRI.intel), speed: clamp10(s, DEFAULT_PRI.speed), cost: clamp10(c, DEFAULT_PRI.cost),
    weights: oneOf(query?.get('ow'), WEIGHTS, 'any'), reason: oneOf(query?.get('r'), REASONING, 'any'),
    inp: listOf(query?.get('in'), IN_OPTS.map(o => o[0])), out: listOf(query?.get('out'), OUT_OPTS.map(o => o[0])),
    ctx: oneOf(Number(query?.get('ctx') ?? 0), CTX_OPTS.map(o => o[0]), 0),
    focus: oneOf(query?.get('f'), FOCUS.map(o => o[0]), 'intelligence'),
  };
}

/** Reads the URL (needs a Suspense boundary above it). */
export function RecommenderFromUrl(props: RecommenderData) {
  const sp = useSearchParams();
  const epoch = useUrlEpoch(sp); // outside changes to the URL remount the screen from the URL
  return <Recommender key={epoch} {...props} query={sp} />;
}

/** `query = null` renders step 1 with default answers and never writes the URL (prerendered Suspense fallback). */
export function Recommender({ models, calibrations, creators, runStats, eta, query }: RecommenderData & { query: Query }) {
  const scored = useMemo(() => scoreModels(models, calibrations), [models, calibrations]);
  const [a, setA] = useState<Answers>(() => parse(query));
  const [i, setI] = useState(() => oneOf(Number(query?.get('s') ?? 1), [1, 2, 3, 4, 5], 1) - 1);
  const prov = useProviders(query, creators, models);
  const [openId, setOpenId] = useState<string | null>(null);
  const S = (v: Partial<Answers>) => setA(s => ({ ...s, ...v }));
  const last = STEPS.length - 1;
  const tot = a.intel + a.speed + a.cost;

  const pri = a.intel === DEFAULT_PRI.intel && a.speed === DEFAULT_PRI.speed && a.cost === DEFAULT_PRI.cost ? null : `${a.intel}.${a.speed}.${a.cost}`;
  const qs = toQs([['s', i ? i + 1 : null], ['pri', pri], ['ow', a.weights === 'any' ? null : a.weights], ['r', a.reason === 'any' ? null : a.reason],
    ['in', a.inp.join(',')], ['out', a.out.join(',')], ['ctx', a.ctx || null], ['f', a.focus === 'intelligence' ? null : a.focus], ['p', prov.param]], ['p']);
  useUrlSync(qs, query != null);

  const res = useMemo(() => {
    const input: RecommendInput = {
      weights: { intelligence: a.intel, speed: a.speed, cost: a.cost },
      openWeights: a.weights, reasoning: a.reason, inputs: a.inp, outputs: a.out, minContextK: a.ctx, focus: a.focus, providers: prov.value,
    };
    return recommend(scored, input);
  }, [scored, a, prov.value]);

  const focusLabel = a.focus === 'intelligence' ? 'Intelligence' : FOCUS.find(o => o[0] === a.focus)?.[1] ?? 'Score';
  const pct = (v: number) => Math.round((100 * v) / tot);
  const open = openId ? scored.find(m => m.id === openId) : undefined;

  return (
    <Card className="p-5 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-mute">Step {i + 1} of {STEPS.length}</span>
        <div className="flex gap-1.5">
          {STEPS.map((s, j) => (
            <button key={j} type="button" aria-label={`Go to step ${j + 1}: ${s[0]}`} aria-current={j === i ? 'step' : undefined} onClick={() => setI(j)} className="h-6 flex items-center">
              <span className="block h-1.5 w-8 sm:w-12 rounded-full transition-colors duration-500" style={{ background: j <= i ? 'var(--acc)' : 'var(--line)' }} />
            </button>
          ))}
        </div>
      </div>

      <div key={i} className="slide mt-8">
        <h2 className="text-[clamp(26px,3.4vw,40px)] font-semibold tracking-tight leading-tight [text-wrap:balance]">
          {i === last && res[0] ? `Best match: ${res[0].model.name}` : STEPS[i][0]}
        </h2>
        <p className="text-mute mt-1">{STEPS[i][1]}</p>
        <div className="mt-7">
          {i === 0 && (
            <>
              <div className="grid md:grid-cols-3 gap-4">
                {PRI.map(p => <PSlider key={p.k} p={p} value={a[p.k]} onChange={v => S({ [p.k]: v })} />)}
              </div>
              <div className="mx-auto mt-10 max-w-lg">
                <div className="flex h-3 rounded-full overflow-hidden gap-0.5" role="img" aria-label={PRI.map(p => `${p.l} ${pct(a[p.k])}%`).join(', ')}>
                  {PRI.map(p => <div key={p.k} className="trk h-full" style={{ width: (100 * a[p.k]) / tot + '%', background: p.c }} />)}
                </div>
                <div className="flex justify-between gap-2 text-xs text-mute mt-2 num">
                  {PRI.map(p => <span key={p.k}>{p.l} {pct(a[p.k])}%</span>)}
                </div>
              </div>
            </>
          )}
          {i === 1 && (
            <div className="space-y-9 max-w-3xl">
              <OptGroup label="Weights" value={a.weights} onChange={v => S({ weights: v })} opts={[['any', 'No preference'], ['open', 'Open weights only'], ['closed', 'Closed only']]} />
              <OptGroup label="Reasoning" value={a.reason} onChange={v => S({ reason: v })} opts={[['any', 'No preference'], ['yes', 'Reasoning'], ['no', 'Non-reasoning']]} />
            </div>
          )}
          {i === 2 && (
            <div className="space-y-9 max-w-3xl">
              <OptGroup multi label="Must accept as input" value={a.inp} onChange={v => S({ inp: v })} opts={IN_OPTS} />
              <OptGroup multi label="Must produce" value={a.out} onChange={v => S({ out: v })} opts={OUT_OPTS} />
            </div>
          )}
          {i === 3 && (
            <div className="space-y-9 max-w-3xl">
              <OptGroup label="Minimum context" value={a.ctx} onChange={v => S({ ctx: v })} opts={CTX_OPTS} />
              <OptGroup label="Main use case" value={a.focus} onChange={v => S({ focus: v })} opts={FOCUS} />
              <div>
                <div className="serif text-3xl mb-3">Providers</div>
                <ProviderSelect value={prov.value} onChange={prov.set} providers={prov.options} defaults={prov.defaults} />
              </div>
            </div>
          )}
          {i === last && (res.length ? (
            <TableBox>
              <thead className="bg-soft">
                <tr>{['Rank', 'Model', 'Match', focusLabel, 'Cost / task', 'Time / task', 'Speed', 'Context', 'Weights'].map((h, j) => <Th key={h} r={j > 1}>{h}</Th>)}</tr>
              </thead>
              <tbody>
                {res.map((x, j) => (
                  <tr key={x.model.id} className="border-t border-line fade"
                    style={{ animationDelay: j * 50 + 'ms', background: j === 0 ? 'color-mix(in srgb, var(--butter) 55%, transparent)' : undefined }}>
                    <td className="p-3 num font-bold">{j + 1}</td>
                    <td className="p-3">
                      <button type="button" onClick={() => setOpenId(x.model.id)} className="font-semibold hover:underline text-left">{x.model.name}</button>
                      <div className="text-xs text-mute">{x.model.creatorName}</div>
                    </td>
                    <td className="p-3 text-right num font-bold">{x.match}%</td>
                    <td className="p-3 text-right num">{fmt1(scoreFor(x.model, a.focus))}</td>
                    <td className="p-3 text-right num">{fmtUsd(x.model.costPerTask)}</td>
                    <td className="p-3 text-right num">{fmtTime(x.model.timePerTask)}</td>
                    <td className="p-3 text-right num">{fmtTps(x.model.offer?.tpsMedian)}</td>
                    <td className="p-3 text-right num">{fmtCtx(x.model.contextK)}</td>
                    <td className="p-3 text-right">{x.model.openWeights ? 'Open' : 'Closed'}</td>
                  </tr>
                ))}
              </tbody>
            </TableBox>
          ) : (
            <div className="rounded-2xl bg-soft p-6">
              <p className="font-semibold">Nothing matches all requirements.</p>
              <p className="text-mute text-sm mt-1">Go back a step and loosen one. Output type, context and providers are usually the strictest.</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-10 pt-5 border-t border-line">
        <button type="button" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}
          className="h-12 px-5 rounded-full border border-line text-xs font-bold uppercase tracking-[.06em] disabled:opacity-30 flex items-center gap-1.5">
          <Icon name="back" size={16} />Back
        </button>
        {i < last ? <Pill acc onClick={() => setI(i + 1)}>{i === last - 1 ? 'See matches' : 'Next'}</Pill> : <Pill onClick={() => setI(0)}>Start over</Pill>}
        {i < last && (
          <span key={res.length} className="pop text-sm text-mute ml-auto" aria-live="polite">
            <span className="num font-bold text-ink">{res.length}</span> of {models.length} models match so far
          </span>
        )}
      </div>

      {open && <ModelDrawer model={open} files={NO_FILES} calibrations={calibrations} runStats={runStats} eta={eta} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
