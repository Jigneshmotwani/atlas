// lib/data/meta.ts — calibrations and source status. Owned by W1.
import 'server-only';
import { cache } from 'react';
import type { Calibration, Metric, SourceId, SourceStatus } from '@/lib/contracts';
import { SAMPLE_CALIBRATIONS, SAMPLE_SOURCE_STATUS } from '@/lib/sample-data';
import { selectAll, str, withFallback } from './_db';

/** Fitted source → AA-scale calibrations (aa itself is identity). */
export const loadCalibrations = cache((): Promise<Calibration[]> =>
  withFallback('calibrations', async () => (await selectAll('calibrations')).map((r): Calibration => ({
    source: r.source as SourceId, metric: r.metric as Metric, a: Number(r.a), b: Number(r.b), nOverlap: Number(r.n_overlap),
  })), () => SAMPLE_CALIBRATIONS, true));

/** Last finished run of every ingestion job (footer "last sync"). */
export const loadSourceStatus = cache((): Promise<SourceStatus[]> =>
  withFallback('v_source_status', async () => (await selectAll('v_source_status')).map((r): SourceStatus => ({
    source: String(r.source), finishedAt: String(r.finished_at), ok: !!r.ok, error: str(r.error),
  })), () => SAMPLE_SOURCE_STATUS)); // empty view = nothing synced yet; don't show fake sync times
