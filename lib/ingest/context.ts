// lib/ingest/context.ts — one ingestion run's view of the catalog + buffered writes (W4).
//
// Every job preloads creators, models, aliases and the newest fact rows it compares against ONCE, does all matching
// and change detection in memory, then `flush()` writes in bulk (creators → models → aliases → facts → upserts).
// That keeps a daily run to a handful of round trips (< 60 s on Vercel). With `dry: true` nothing touches Supabase:
// the catalog starts from lib/sample-data (= the seed) and flush only reports what it would write.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/server';
import { SAMPLE_CREATORS, SAMPLE_MODELS } from '@/lib/sample-data';
import { similarity } from '@/lib/trigram';
import { creatorIdFor, normalizeName, slugify, stripEffort } from './normalize';
import { errMsg } from './util';

export type Row = Record<string, unknown>;
export type MatchMethod = 'exact' | 'fuzzy' | 'manual' | 'new';
export interface CreatorRec { id: string; name: string; default_selected: boolean }
export interface ModelRec {
  id: string; family_id: string | null; name: string; creator_id: string | null; open_weights: boolean; reasoning: boolean | null;
  in_modalities: string[]; out_modalities: string[]; context_k: number | null; total_params_b: number | null; active_params_b: number | null;
  kv_bytes_per_token: number | null; hf_repo: string | null; released_on: string | null; deprecated_on: string | null;
}
export interface AliasRec { source: string; external_id: string; external_name: string | null; model_id: string | null; match_method: MatchMethod | null; match_score: number | null; confirmed: boolean }

/** History tables written with insert-on-change, and the columns that identify "the same fact". */
export const FACT_KEYS = { scores: ['model_id', 'source', 'metric'], api_offers: ['model_id', 'provider', 'source'] } as const;
export type FactTable = keyof typeof FACT_KEYS;
/** Per-column tolerance: a number = absolute step, `'1%'` = relative. Columns without one compare exactly. */
export type Tolerance = Record<string, number | `${number}%`>;
export const TOL = {
  score: { value: 0.1 } satisfies Tolerance,
  offer: { price_in: 0.001, price_out: 0.001, price_cache: 0.001, tps_median: '1%', ttft_median_s: '1%' } satisfies Tolerance,
};
/** Columns never compared (metadata). */
const IGNORE = new Set(['id', 'fetched_at', 'source_ref']);

/** The PostgREST filter methods jobs use (structural, so callers don't need the deep generic builder types). */
export interface QueryFilter {
  eq(column: string, value: unknown): QueryFilter;
  neq(column: string, value: unknown): QueryFilter;
  is(column: string, value: null | boolean): QueryFilter;
  not(column: string, operator: string, value: unknown): QueryFilter;
  in(column: string, values: readonly unknown[]): QueryFilter;
  order(column: string, options?: { ascending?: boolean }): QueryFilter;
  limit(n: number): QueryFilter;
}

export interface MatchOptions {
  /** extra spellings tried for the exact match (OpenRouter id, AA slug, …) */
  altNames?: string[];
  /** fields for a model created from this source (openrouter / aa only) */
  create?: Partial<ModelRec>;
  /** false = never create a model (default: true for openrouter / aa) */
  allowCreate?: boolean;
  /** false = when nothing matches and nothing is created, don't store an unmatched alias either */
  recordUnmatched?: boolean;
  /** false = skip the "same name without effort tag" fallback (default true for non-creating sources) */
  effortFallback?: boolean;
}

const CREATING_SOURCES = new Set(['openrouter', 'aa']);
const BATCH = 500;

export class IngestContext {
  readonly dry: boolean;
  private db: SupabaseClient | null;
  creators = new Map<string, CreatorRec>();
  models = new Map<string, ModelRec>();
  aliases = new Map<string, AliasRec>();
  private norm = new Map<string, string>();               // model id → normalized name
  private byNorm = new Map<string, string[]>();            // normalized name / id → model ids
  private byCompact = new Map<string, string[]>();         // same without dashes ("qwen-3-8-27b" ≡ "qwen3-8-27b")
  private latest = new Map<string, Row>();
  private loadedLatest = new Set<string>();
  private dirtyCreators = new Map<string, CreatorRec>();
  private dirtyModels = new Map<string, ModelRec>();
  private dirtyAliases = new Map<string, AliasRec>();
  private facts: Record<FactTable, (Row | null)[]> = { scores: [], api_offers: [] };
  /** fact keys written (or found unchanged) this run, with the match rank that claimed them: one fact per key per run */
  private claimed = new Map<string, { rank: number; idx: number }>();
  /** rank of the last matchModel result: 2 = exact / new / confirmed alias, 1 = fuzzy / unconfirmed, 0 = none */
  rank = 0;
  /** facts skipped because a better-matched source name already wrote the same key this run */
  dropped = 0;
  private upserts: { table: string; onConflict: string; rows: Row[] }[] = [];
  inserted = 0;
  unchanged = 0;
  methods: Record<string, number> = {};
  notes: string[] = [];

  private constructor(dry: boolean) {
    this.dry = dry;
    this.db = dry ? null : supabaseAdmin();
  }

  /** Build a context: preload the catalog from Supabase, or from the sample data (= seed) when dry. */
  static async create({ dry = false }: { dry?: boolean } = {}): Promise<IngestContext> {
    const ctx = new IngestContext(dry);
    if (dry) {
      for (const c of SAMPLE_CREATORS) ctx.creators.set(c.id, { id: c.id, name: c.name, default_selected: c.defaultSelected });
      for (const m of SAMPLE_MODELS) ctx.addModel({
        id: m.id, family_id: m.familyId, name: m.name, creator_id: m.creatorId, open_weights: m.openWeights, reasoning: m.reasoning,
        in_modalities: m.inModalities, out_modalities: m.outModalities, context_k: m.contextK, total_params_b: m.totalParamsB, active_params_b: m.activeParamsB,
        kv_bytes_per_token: m.kvBytesPerToken, hf_repo: m.hfRepo, released_on: null, deprecated_on: null,
      });
      return ctx;
    }
    const [creators, models, aliases] = await Promise.all([
      ctx.selectAll('creators', 'id,name,default_selected'),
      ctx.selectAll('models', 'id,family_id,name,creator_id,open_weights,reasoning,in_modalities,out_modalities,context_k,total_params_b,active_params_b,kv_bytes_per_token,hf_repo,released_on,deprecated_on'),
      ctx.selectAll('model_aliases', '*'),
    ]);
    for (const c of creators) ctx.creators.set(String(c.id), c as unknown as CreatorRec);
    for (const m of models) ctx.addModel(m as unknown as ModelRec);
    for (const a of aliases) ctx.aliases.set(aliasKey(String(a.source), String(a.external_id)), a as unknown as AliasRec);
    return ctx;
  }

  /** Supabase admin client (throws in dry mode). */
  get client(): SupabaseClient {
    if (!this.db) throw new Error('dry run: no database');
    return this.db;
  }

  /** Read every row of a table/view (1,000-row pages). */
  async selectAll(table: string, columns = '*', filter?: (q: QueryFilter) => QueryFilter): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      let q = this.client.from(table).select(columns).range(from, from + 999) as unknown as QueryFilter;
      if (filter) q = filter(q);
      const { data, error } = await (q as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
      if (error) throw new Error(`${table}: ${error.message}`);
      const rows = (data ?? []) as Row[];
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  /** Preload the newest row per key of one history table for one source (no-op when dry). */
  async preloadLatest(table: FactTable, source: string): Promise<void> {
    const tag = `${table}|${source}`;
    if (this.dry || this.loadedLatest.has(tag)) return;
    const view = table === 'scores' ? 'v_latest_scores' : 'v_latest_offers';
    const rows = await this.selectAll(view, '*', q => q.eq('source', source));
    for (const r of rows) this.latest.set(factKey(table, r), r);
    this.loadedLatest.add(tag);
  }

  // ------------------------------------------------------------ creators
  /** Resolve an external creator spelling to a creator id; creates the creator (default_selected false) when unknown. */
  creator(raw: string | null | undefined, displayName?: string | null): string | null {
    const known = creatorIdFor(raw) ?? creatorIdFor(displayName);
    if (known && this.creators.has(known)) return known;
    const name = (displayName ?? raw ?? '').trim();
    if (!name) return null;
    const id = known ?? slugify(name);
    if (!id) return null;
    if (this.creators.has(id)) return id;
    const byName = [...this.creators.values()].find(c => slugify(c.name) === id);
    if (byName) return byName.id;
    const rec: CreatorRec = { id, name: known ? name : titleCase(name), default_selected: false };
    this.creators.set(id, rec);
    this.dirtyCreators.set(id, rec);
    return id;
  }

  // ------------------------------------------------------------ models
  private addModel(m: ModelRec) {
    this.models.set(m.id, m);
    const n = normalizeName(m.name);
    this.norm.set(m.id, n);
    for (const k of new Set([n, m.id])) this.byNorm.set(k, [...(this.byNorm.get(k) ?? []), m.id]);
    for (const k of new Set([compact(n), compact(m.id)])) this.byCompact.set(k, [...(this.byCompact.get(k) ?? []), m.id]);
  }

  /** Patch fields of an existing model; queues an update only when something changed. */
  patchModel(id: string, patch: Partial<ModelRec>): void {
    const m = this.models.get(id);
    if (!m) return;
    let changed = false;
    for (const [k, v] of Object.entries(patch) as [keyof ModelRec, unknown][]) {
      if (v === undefined) continue;
      if (JSON.stringify(m[k]) !== JSON.stringify(v)) { (m as unknown as Row)[k] = v; changed = true; }
    }
    if (changed) this.dirtyModels.set(id, m);
  }

  private newModelId(base: string): string {
    const b = base || 'model';
    if (!this.models.has(b)) return b;
    for (let i = 2; ; i++) if (!this.models.has(`${b}-${i}`)) return `${b}-${i}`;
  }

  /**
   * SPEC "matchModel": alias hit → exact normalized name (any spelling in altNames, any creator) → trigram ≥ 0.92 within the
   * same creator (fuzzy, unconfirmed) → [non-creating sources] same name without effort tag (fuzzy, unconfirmed) →
   * create the model for openrouter / aa (alias 'new') → else alias with model_id null for /admin/match.
   */
  matchModel(source: string, externalId: string, name: string, creatorId: string | null, opts: MatchOptions = {}): string | null {
    const key = aliasKey(source, externalId);
    const hit = this.aliases.get(key);
    if (hit) {
      this.count('alias');
      this.rank = !hit.model_id ? 0 : hit.confirmed || hit.match_method === 'exact' || hit.match_method === 'new' || hit.match_method === 'manual' ? 2 : 1;
      return hit.model_id;
    }

    const names = [...new Set([name, ...(opts.altNames ?? [])].map(normalizeName).filter(Boolean))];
    const sameCreator = (id: string) => !creatorId || this.models.get(id)?.creator_id === creatorId;
    const alias = (model_id: string | null, match_method: MatchMethod | null, match_score: number | null, confirmed: boolean): string | null => {
      const rec: AliasRec = { source, external_id: externalId, external_name: name, model_id, match_method, match_score: match_score == null ? null : Math.round(match_score * 1000) / 1000, confirmed };
      this.aliases.set(key, rec);
      this.dirtyAliases.set(key, rec);
      this.count(match_method ?? 'unmatched');
      this.rank = !model_id ? 0 : match_method === 'fuzzy' ? 1 : 2;
      return model_id;
    };

    for (const index of [this.byNorm, this.byCompact]) for (const n of names) {
      const ids = index.get(index === this.byNorm ? n : compact(n));
      if (ids?.length) return alias(ids.find(sameCreator) ?? ids[0], 'exact', 1, true);
    }

    const pool = [...this.models.values()].filter(m => creatorId ? m.creator_id === creatorId : true);
    let best: { id: string; s: number } | null = null;
    for (const m of pool) {
      const mn = this.norm.get(m.id) ?? '';
      const s = Math.max(...names.map(n => (digits(n) === digits(mn) ? similarity(n, mn) : 0)));
      if (!best || s > best.s) best = { id: m.id, s };
    }
    if (best && best.s >= 0.92) return alias(best.id, 'fuzzy', best.s, false);

    const creating = CREATING_SOURCES.has(source) && opts.allowCreate !== false;
    if (!creating && opts.effortFallback !== false) {
      for (const n of names) {
        const base = stripEffort(n);
        if (base === n) continue;
        const ids = this.byNorm.get(base);
        if (ids?.length) { const id = ids.find(sameCreator) ?? ids[0]; return alias(id, 'fuzzy', similarity(n, base), false); }
      }
    }

    if (creating && names[0]) {
      const id = this.newModelId(names[0]);
      const rec: ModelRec = {
        id, family_id: null, name, creator_id: creatorId, open_weights: false, reasoning: null, in_modalities: ['text'], out_modalities: ['text'],
        context_k: null, total_params_b: null, active_params_b: null, kv_bytes_per_token: null, hf_repo: null, released_on: null, deprecated_on: null,
        ...opts.create,
      };
      rec.id = id;
      this.addModel(rec);
      this.dirtyModels.set(id, rec);
      return alias(id, 'new', null, source === 'openrouter');
    }
    if (opts.recordUnmatched === false) { this.count('ignored'); return null; }
    return alias(null, null, best?.s ?? null, false);
  }

  // ------------------------------------------------------------ facts
  /**
   * SPEC "insertIfChanged": compare with the newest row for the key; queue an insert only when a compared column changed
   * by at least its tolerance (or went null ↔ value). Returns true when the row will be inserted.
   * When several source names resolve to one model, only one fact per key is kept per run: the best match rank wins
   * (`rank` defaults to the rank of the last matchModel call), ties keep the first.
   */
  insertIfChanged(table: FactTable, key: Row, row: Row, tolerance: Tolerance = {}, rank: number = this.rank): boolean {
    const full = { ...row, ...key };
    const k = factKey(table, full);
    const claim = this.claimed.get(k);
    if (claim) {
      this.dropped++;
      if (rank <= claim.rank) return false;
      if (claim.idx >= 0) this.facts[table][claim.idx] = null; else this.unchanged--;
    }
    const prev = this.latest.get(k);
    if (prev && !changed(prev, full, tolerance, new Set<string>(FACT_KEYS[table]))) { this.unchanged++; this.claimed.set(k, { rank, idx: -1 }); return false; }
    this.facts[table].push(full);
    this.claimed.set(k, { rank, idx: this.facts[table].length - 1 });
    return true;
  }

  /** Queue a plain upsert (tables without history: task_profile, metric_sources, calibrations, …). */
  upsert(table: string, rows: Row[], onConflict: string): void {
    if (rows.length) this.upserts.push({ table, onConflict, rows });
  }

  /** Count of queued writes per table (what a dry run prints). */
  pending(): Record<string, number> {
    const out: Record<string, number> = {
      creators: this.dirtyCreators.size, models: this.dirtyModels.size, model_aliases: this.dirtyAliases.size,
      scores: this.facts.scores.filter(Boolean).length, api_offers: this.facts.api_offers.filter(Boolean).length,
    };
    for (const u of this.upserts) out[u.table] = (out[u.table] ?? 0) + u.rows.length;
    return out;
  }

  /** Write everything queued, in FK order. Returns rows written. Dry: clears the queues and returns the would-be count. */
  async flush(): Promise<number> {
    const p = this.pending();
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    const creators = [...this.dirtyCreators.values()], models = [...this.dirtyModels.values()], aliases = [...this.dirtyAliases.values()];
    const facts = this.facts, upserts = this.upserts;
    this.dirtyCreators = new Map(); this.dirtyModels = new Map(); this.dirtyAliases = new Map();
    this.facts = { scores: [], api_offers: [] }; this.upserts = [];
    for (const [k, c] of this.claimed) if (c.idx >= 0) { const t = k.split('\u0000')[0] as FactTable; const r = facts[t][c.idx]; if (r) this.latest.set(k, r); }
    this.claimed = new Map();
    this.inserted += total;
    if (this.dry) return total;
    await this.write('creators', creators as unknown as Row[], 'id');
    await this.write('models', models as unknown as Row[], 'id');
    await this.write('model_aliases', aliases as unknown as Row[], 'source,external_id');
    await this.write('scores', facts.scores.filter((r): r is Row => r != null), null);
    await this.write('api_offers', facts.api_offers.filter((r): r is Row => r != null), null);
    for (const u of upserts) await this.write(u.table, u.rows, u.onConflict);
    return total;
  }

  private async write(table: string, rows: Row[], onConflict: string | null) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const q = this.client.from(table);
      const { error } = onConflict ? await q.upsert(chunk, { onConflict }) : await q.insert(chunk);
      if (error) throw new Error(`write ${table}: ${error.message}`);
    }
  }

  count(method: string) { this.methods[method] = (this.methods[method] ?? 0) + 1; }
  note(msg: string) { if (this.notes.length < 50) this.notes.push(msg.slice(0, 300)); }
}

export const aliasKey = (source: string, externalId: string) => `${source}\u0000${externalId}`;
const factKey = (table: FactTable, r: Row) => [table, ...FACT_KEYS[table].map(k => String(r[k] ?? ''))].join('\u0000');
/** Version numbers in order ("gpt-5-5" → "5.5"): fuzzy matches must agree on them (trigram sets ignore repeats). */
const compact = (norm: string) => norm.replace(/-/g, '');
const digits = (norm: string) => norm.split('-').filter(t => /\d/.test(t)).map(t => t.replace(/\D+/g, '.')).join('|');
const titleCase = (s: string) => (/[A-Z]/.test(s) ? s : s.replace(/(^|[\s-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()));

function changed(prev: Row, next: Row, tol: Tolerance, keys: Set<string>): boolean {
  for (const [col, v] of Object.entries(next)) {
    if (keys.has(col) || IGNORE.has(col)) continue;
    const a = prev[col];
    if (a == null && v == null) continue;
    if (a == null || v == null) return true;
    const t = tol[col], x = Number(a), y = Number(v);
    if (t != null && Number.isFinite(x) && Number.isFinite(y)) {
      const d = Math.abs(x - y);
      if (typeof t === 'number' ? d >= t - 1e-9 : d >= Math.abs(x) * (parseFloat(t) / 100) - 1e-12 && d > 0) return true;
      continue;
    }
    if (typeof v === 'number' || typeof a === 'number' ? x !== y : String(a) !== String(v)) return true;
  }
  return false;
}

export { errMsg };
