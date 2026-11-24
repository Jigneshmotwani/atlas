// lib/data/_db.ts — shared helpers for the loaders. Owned by W1.
import 'server-only';
import { hasSupabase, supabaseServer } from '@/lib/supabase/server';

export type Row = Record<string, unknown>;
export const num = (v: unknown): number | null => (v == null || v === '' ? null : isFinite(Number(v)) ? Number(v) : null);
export const str = (v: unknown): string | null => (v == null ? null : String(v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any; // PostgREST filter builder; typed loosely on purpose (private to lib/data)

/** Read every row of a view (PostgREST caps responses at 1,000 rows). */
export async function selectAll(view: string, columns = '*', filter?: (q: Q) => Q): Promise<Row[]> {
  const db = supabaseServer(), page = 1000, out: Row[] = [];
  for (let from = 0; ; from += page) {
    let q: Q = db.from(view).select(columns).range(from, from + page - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${view}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < page) return out;
  }
}

/** Run a loader against Supabase; fall back to the prototype sample data when the
 *  env is missing, ATLAS_SAMPLE=1, the query fails, or (with emptyIsSample) it returns nothing. */
export async function withFallback<T>(name: string, load: () => Promise<T[]>, sample: () => T[], emptyIsSample = false): Promise<T[]> {
  if (process.env.ATLAS_SAMPLE === '1' || !hasSupabase()) return sample();
  try {
    const rows = await load();
    return emptyIsSample && rows.length === 0 ? sample() : rows;
  } catch (e) {
    console.warn(`[lib/data] ${name} failed, using sample data:`, (e as Error).message);
    return sample();
  }
}
