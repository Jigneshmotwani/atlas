'use client';
// components/hardware/Results.tsx — right card of the Hardware page: tiles, context slider, fit table. Owned by W7.
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FileRow, HardwareSpec, ModelFit, ScoredModel } from '@/lib/contracts';
import { fastMemoryGb, spillMemoryGb } from '@/lib/engine';
import { fmtTime } from '@/lib/format';
import { Card, Gem, Head, PopNumber, SpeedCell, TableBox, Th, WhereTag } from '@/components/ui';
import type { HardwareMode } from '@/lib/state';

/** A vendor-published speed for this model on exactly this setup (lib/data VendorBenchmark, trimmed for the client). */
export interface HardwareVendor { deviceId: string; devices: number; modelId: string | null; genTps: number | null; precision: string; runtime: string; sourceName: string; sourceUrl: string }
export interface FitRow { m: ScoredModel; fit: ModelFit; file: FileRow | undefined; compare: boolean; vendor?: HardwareVendor }

export interface ResultsProps {
  spec: HardwareSpec | null;
  rows: FitRow[];
  mode: HardwareMode;
  ctx: number;
  setCtx(n: number): void;
  probeLabel: string | null;
  notice: string | null;
  onOpen(m: ScoredModel): void;
  share: ReactNode;
}

const kldOf = (f: FileRow) => (f.kind === 'official' ? 0 : f.quality[0]?.kld ?? null);

export function Results({ spec, rows, mode, ctx, setCtx, probeLabel, notice, onOpen, share }: ResultsProps) {
  const fast = rows.filter(r => r.fit.best.where === 'gpu').length;
  const any = rows.filter(r => r.fit.best.where !== 'no').length;
  const nMeas = rows.filter(r => r.fit.best.speed?.kind === 'measured').length;
  const tiles: [string, string | number, string][] = spec ? [
    ['Fast memory', Math.round(fastMemoryGb(spec)), 'GB'],
    ['Spill-over RAM', spec.arch === 'unified' ? '–' : Math.round(spillMemoryGb(spec)), 'GB'],
    ['Bandwidth', Math.round(spec.arch === 'cpu' ? spec.ramBwGbs : spec.gpuBwGbs), 'GB/s'],
    ['Measured rows', nMeas, ''],
  ] : [];

  return (
    <Card className="p-4 sm:p-6">
      <Head title={spec ? `${any} of ${rows.length} open models run here, ${fast} at full speed` : 'Tell Atlas what hardware you have'} right={spec ? share : undefined} />
      {probeLabel && mode === 'manual' && <p className="text-sm text-mute mt-1">Specs from your device test: {probeLabel}</p>}
      {notice && <p className="text-sm text-warn mt-1">{notice}</p>}
      {spec ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
            {tiles.map(([l, v, u]) => (
              <div key={l} className="rounded-2xl bg-soft p-3.5">
                <div className="text-xs text-mute">{l}</div>
                <div className="flex items-baseline gap-1"><PopNumber value={v} className="text-4xl" /><span className="text-xs text-mute">{u}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label htmlFor="pctx" className="text-sm font-semibold">Context to reserve</label>
            <input id="pctx" type="range" min="4" max="256" step="4" value={ctx} onChange={e => setCtx(+e.target.value)} className="flex-1 accent-[var(--acc)] h-8" />
            <span className="num font-semibold text-sm w-24 text-right">{ctx}K tokens</span>
          </div>
          <div className="mt-3">
            <TableBox>
              <thead className="bg-soft"><tr><Th>Model</Th><Th>Best file</Th><Th>Runs</Th><Th r>Memory</Th><Th r>Speed</Th><Th r>Prompt read</Th><Th r>Load</Th></tr></thead>
              <tbody>
                {rows.map(r => { const { m, fit, file, compare } = r;
                  const best = fit.best, k = file ? kldOf(file) : null, measured = best.speed?.kind === 'measured';
                  return (
                    <tr key={m.id} className="border-t border-line hover:bg-soft align-top">
                      <td className="p-3">
                        <button type="button" onClick={() => onOpen(m)} className="font-semibold hover:underline text-left">{m.name}</button>
                        <div className="text-xs text-mute num">{m.totalParamsB ?? '–'}B · {m.activeParamsB ?? '–'}B active</div>
                      </td>
                      <td className="p-3 text-xs">
                        {file && <><div className="font-semibold">{file.uploader} · {file.quant}</div>
                          <div className="text-mute num">{file.sizeGb} GB{k != null && k > 0 ? ` · KLD ${k}` : k === 0 ? ' · original' : ''}</div></>}
                        {compare && <Link href={`/quants?model=${encodeURIComponent(m.id)}`} className="inline-block mt-1 underline underline-offset-2 decoration-[var(--acc)] font-semibold">compare quants</Link>}
                      </td>
                      <td className="p-3">
                        <WhereTag where={best.where} />
                        {best.where !== 'no' && <div className="text-xs text-mute mt-1">via {best.runtime}{best.soloDevice ? ' · one device' : ''}</div>}
                        {best.where === 'no' && <div className="text-xs text-mute mt-1 max-w-[12rem]">{best.why}</div>}
                        {!best.fitsDisk && best.where !== 'no' && <div className="text-xs text-warn mt-1 font-semibold">Not enough disk</div>}
                      </td>
                      <td className="p-3 text-right num">{best.needGb} GB</td>
                      <td className="p-3">
                        <SpeedCell fit={best.where === 'no' ? null : best} />
                        {r.vendor?.genTps != null && (
                          <a href={r.vendor.sourceUrl} target="_blank" rel="noreferrer" title={`Published by ${r.vendor.sourceName} on its own tuned setup; not used in Atlas's estimate`}
                            className="mt-1 block text-right text-xs text-mute underline underline-offset-2 whitespace-nowrap">
                            {r.vendor.sourceName.startsWith('NVIDIA') ? 'NVIDIA' : r.vendor.sourceName}: {r.vendor.genTps} tok/s · {r.vendor.precision}
                          </a>
                        )}
                      </td>
                      <td className="p-3 text-right num">{best.where === 'no' || best.promptTps == null ? '–' : `${measured ? '' : '≈'}${best.promptTps} tok/s`}</td>
                      <td className="p-3 text-right num">{best.where === 'no' ? '–' : fmtTime(best.loadS)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableBox>
          </div>
          <p className="text-xs text-mute mt-3">Measured rows come from device tests people shared for this exact device and file. Everything else is an estimate from memory bandwidth (ceiling) and typical efficiency.</p>
        </>
      ) : (
        <div className="mt-6 rounded-2xl bg-soft p-8 text-center">
          <Gem kind="hardware" size={48} />
          <p className="font-semibold mt-3">{mode === 'ai' ? 'Describe your hardware to see which models run.' : 'Add a device to see which models run.'}</p>
        </div>
      )}
    </Card>
  );
}
