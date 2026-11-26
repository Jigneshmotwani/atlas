// lib/ingest/log.ts — job result type + logRun (ingest_log start/finish). Never throws (W4).
import { supabaseAdmin } from '@/lib/supabase/server';
import type { IngestContext } from './context';
import { errMsg } from './util';

export const JOB_SOURCES = ['openrouter', 'aa', 'arena', 'livebench', 'epoch', 'calibrate'] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export interface JobResult { ok: boolean; inserted: number; unchanged: number; skipped?: string; error?: string }

export interface JobOptions {
  /** fetch + map + count, never write (scripts/run-job.ts --dry) */
  dry?: boolean;
  /** shared context (dry `all` runs chain jobs on one in-memory catalog) */
  ctx?: IngestContext;
  /** local file used instead of the network (AA in dry runs: never spend the 100/day quota while developing) */
  fixture?: string;
  /** progress / diagnostics sink (stdout in scripts; console.info in routes) */
  log?: (msg: string) => void;
}

/** Thrown by a job to end it as `{ ok: true, skipped }` (source unavailable, key missing, terms). */
export class Skip extends Error {}

/**
 * Wrap a job with an ingest_log row: insert at start, update at finish with ok / counts / error.
 * Skips are logged as ok with `error = 'skipped: …'`. Any exception becomes `{ ok: false, error }`; nothing escapes.
 */
export async function logRun(source: string, fn: () => Promise<Omit<JobResult, 'ok'> & { ok?: boolean }>, opts: Pick<JobOptions, 'dry' | 'log'> = {}): Promise<JobResult> {
  const log = opts.log ?? (() => {});
  let id: number | null = null;
  if (!opts.dry) {
    try {
      const { data, error } = await supabaseAdmin().from('ingest_log').insert({ source }).select('id').single();
      if (error) log(`[${source}] ingest_log start failed: ${error.message}`);
      else id = Number((data as { id: number }).id);
    } catch (e) { log(`[${source}] ingest_log start failed: ${errMsg(e)}`); }
  }
  let result: JobResult;
  try {
    const r = await fn();
    result = { ok: r.ok ?? true, inserted: r.inserted, unchanged: r.unchanged, ...(r.skipped ? { skipped: r.skipped } : {}), ...(r.error ? { error: r.error } : {}) };
  } catch (e) {
    result = e instanceof Skip ? { ok: true, inserted: 0, unchanged: 0, skipped: e.message } : { ok: false, inserted: 0, unchanged: 0, error: errMsg(e) };
  }
  if (id != null) {
    try {
      const error = result.skipped ? `skipped: ${result.skipped}` : result.error ?? null;
      const { error: e2 } = await supabaseAdmin().from('ingest_log').update({ finished_at: new Date().toISOString(), ok: result.ok, rows_inserted: result.inserted, rows_unchanged: result.unchanged, error }).eq('id', id);
      if (e2) log(`[${source}] ingest_log finish failed: ${e2.message}`);
    } catch (e) { log(`[${source}] ingest_log finish failed: ${errMsg(e)}`); }
  }
  return result;
}
