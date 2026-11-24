// lib/data/files.ts — v_files → FileRow[]. Owned by W1.
import 'server-only';
import { cache } from 'react';
import type { FileFormat, FileKind, FileRow } from '@/lib/contracts';
import { SAMPLE_FILES } from '@/lib/sample-data';
import { num, selectAll, withFallback, type Row } from './_db';

export function toFileRow(r: Row): FileRow {
  return {
    id: Number(r.id), modelId: String(r.model_id), repo: String(r.repo), uploader: String(r.uploader), quant: String(r.quant),
    format: r.format as FileFormat, bitsPerWeight: num(r.bits_per_weight) ?? 0, sizeGb: Number(r.size_gb), kind: r.kind as FileKind, downloads: num(r.downloads),
    quality: ((r.quality as Row[] | null) ?? []).map(q => ({ kld: num(q.kld), evalSet: String(q.eval_set), source: String(q.source), measuredAt: String(q.measured_at) })),
  };
}

/** Number of files (all models). Cheap: the Explorer stat tile needs only this. */
export const loadFileCount = cache(async (): Promise<number> => {
  const rows = await withFallback('v_files count', async () => {
    const { supabaseServer } = await import('@/lib/supabase/server');
    const { count, error } = await supabaseServer().from('files').select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ? [count] : [];
  }, () => [SAMPLE_FILES.length], true);
  return rows[0] ?? 0;
});

/** All files, or only one model's files. */
export const loadFiles = cache((modelId?: string): Promise<FileRow[]> =>
  withFallback('v_files', async () => (await selectAll('v_files', '*', modelId ? q => q.eq('model_id', modelId) : undefined)).map(toFileRow),
    () => (modelId ? SAMPLE_FILES.filter(f => f.modelId === modelId) : SAMPLE_FILES), !modelId));
