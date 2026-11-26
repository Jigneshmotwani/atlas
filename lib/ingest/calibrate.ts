// lib/ingest/calibrate.ts — nightly fits: source → AA-scale calibrations, and η from measured runs (W4).
import type { DeviceType, ModelRow } from '@/lib/contracts';
import { fitCalibrations, fitEta, fitFile, isMoe, specFromPicks, val } from '@/lib/engine';
import { SAMPLE_MODELS } from '@/lib/sample-data';
import { DEFAULT_HOST } from '@/lib/state';
import { IngestContext } from './context';
import { logRun, type JobOptions, type JobResult } from './log';
import { deviceOf, fileRowOf, modelRowOf } from './rows';
import { round } from './util';

type Run = { estimate: number; measured: number; deviceType: DeviceType; runtime: string; moe: boolean };

/** Mean absolute error of a calibration over its overlap set (AA scale). */
function mae(models: ModelRow[], c: { source: string; metric: string; a: number; b: number }): number | null {
  if (c.source === 'aa') return 0;
  const errs = models.flatMap(m => {
    const r = val(m, 'aa', c.metric as never), s = val(m, c.source as never, c.metric as never);
    return r != null && s != null ? [Math.abs(c.a + c.b * s - r)] : [];
  });
  return errs.length ? round(errs.reduce((x, y) => x + y, 0) / errs.length, 3) : null;
}

async function sync(opts: JobOptions): Promise<Omit<JobResult, 'ok'>> {
  const log = opts.log ?? (() => {});
  const ctx = opts.ctx ?? await IngestContext.create({ dry: opts.dry });
  const i0 = ctx.inserted;
  const models = ctx.dry ? SAMPLE_MODELS : (await ctx.selectAll('v_models')).map(modelRowOf);
  const now = new Date().toISOString();

  const cals = fitCalibrations(models);
  ctx.upsert('calibrations', cals.map(c => ({ source: c.source, metric: c.metric, a: c.a, b: c.b, n_overlap: c.nOverlap, mae: mae(models, c), fitted_at: now })), 'source,metric');

  // η: one estimate per measured run on its single-device spec, uncalibrated, fully in fast memory (or CPU-only)
  let etaRows = 0, used = 0, total = 0;
  if (!ctx.dry) {
    const runs = await ctx.selectAll('runs', 'device_id,file_id,runtime,ctx,gen_tps', q => q.is('rejected_reason', null).not('device_id', 'is', null).not('file_id', 'is', null).neq('fingerprint', 'seed')); // seed runs are prototype samples, never fit η on them
    total = runs.length;
    if (runs.length) {
      const devices = (await ctx.selectAll('devices', 'id,name,category,type,mem_gb,bw_gbs,fp16_tflops,fp8,fp4,backend,usable_frac,source,verified')).map(deviceOf);
      const fileIds = [...new Set(runs.map(r => Number(r.file_id)))];
      const files = new Map<number, ReturnType<typeof fileRowOf>>();
      for (let i = 0; i < fileIds.length; i += 200) for (const r of await ctx.selectAll('v_files', '*', q => q.in('id', fileIds.slice(i, i + 200)))) { const f = fileRowOf(r); files.set(f.id, f); }
      const byId = new Map(models.map(m => [m.id, m])), devById = new Map(devices.map(d => [d.id, d]));
      const input: Run[] = [];
      for (const r of runs) {
        const d = devById.get(String(r.device_id)), f = files.get(Number(r.file_id)), m = f && byId.get(f.modelId);
        if (!d || !f || !m) continue;
        const spec = specFromPicks([{ deviceId: d.id, qty: 1 }], devices, DEFAULT_HOST);
        if (!spec) continue;
        const ctxK = r.ctx ? Math.max(1, Number(r.ctx) / 1000) : 4;
        const fit = fitFile(m, f, spec, ctxK, { runStats: [], eta: [] });
        const ok = fit.where === 'gpu' || (d.type === 'cpu' && fit.where === 'cpu');
        if (!ok || fit.speed?.kind !== 'estimate') continue;
        input.push({ estimate: fit.speed.mid, measured: Number(r.gen_tps), deviceType: d.type, runtime: String(r.runtime), moe: isMoe(m) });
      }
      used = input.length;
      const etas = fitEta(input);
      etaRows = etas.length;
      ctx.upsert('eta_calibrations', etas.map(e => ({ device_type: e.deviceType, runtime: e.runtime, moe: e.moe, eta: e.eta, n_runs: e.nRuns, fitted_at: now })), 'device_type,runtime,moe');
    }
  }
  log(`calibrate: ${models.length} models → ${cals.length} calibrations (${cals.filter(c => c.source !== 'aa').map(c => `${c.source}/${c.metric} n=${c.nOverlap}`).join(', ') || 'no non-AA fits yet'}); runs ${total}, usable ${used} → ${etaRows} η groups`);
  await ctx.flush();
  return { inserted: ctx.inserted - i0, unchanged: 0 };
}

export const run = (opts: JobOptions = {}): Promise<JobResult> => logRun('calibrate', () => sync(opts), opts);
