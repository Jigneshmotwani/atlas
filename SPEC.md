# Atlas — Build Spec for Claude Code

Nov 24, 2026 · @Jignesh

## Read me first

This spec is the single source of truth for building Atlas v1 in one pass with up to 8 Claude Code agents working in parallel. Read it whole once, then each agent takes one workstream from the Agent plan and touches only the files it owns. The visual reference is the prototype file `design/prototype.html` (put it in the repo before starting); match its layout, colours, copy and motion.

**Rules for every agent**

1. Code against the contracts in Shared contracts. Types and function signatures there are fixed; if one must change, the Lead agent changes it and tells the others.
2. Own your files. Never edit a file another workstream owns; ask the Lead instead.
3. No test files, no test frameworks, no CI test steps. Check your work by running the app and the scripts locally and looking at the result.
4. Free tiers only: Vercel Hobby, Supabase Free, GitHub Actions free minutes, free public data APIs. No paid service, no new account beyond those listed in Setup.
5. TypeScript strict, no `any` in shared contracts. Server-only secrets never reach client components.
6. When something in this spec is missing or contradicts itself, pick the simplest option that keeps the UI identical to the prototype, write a one-line note in `NOTES.md`, and keep going.

**Changes from the engine design doc**

| Engine design said | This spec does | Why |
| --- | --- | --- |
| Supabase Edge Functions for ingestion | Vercel cron routes (daily) + GitHub Actions for heavy jobs | Hobby cron runs once a day and functions stop at 300 s; GitHub Actions gives 2,000 free minutes a month |
| Unit tests per iteration | No tests; manual checks in Definition of done | Speed of one-shot build |
| Claude via Anthropic API | Any OpenAI-compatible endpoint via `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Works with the AI key you already have |
| Every fetch inserts a row | Insert only when a value changed | Keeps the database well under the 500 MB free limit |

## Scope

v1 ships the five prototype screens on real data, the nightly data pipeline, the probe CLI and the Ask AI route. It is a private, single-owner tool: no sign-up, no public sharing of Artificial Analysis numbers.

| In v1 | Not in v1 |
| --- | --- |
| Explorer: 10 metric tabs, filters, provider dropdown (12 default of all), chart + table, model detail drawer with per-source scores and provider switch | User accounts and logins (one optional admin password for `/admin`) |
| Recommender: 5-step wizard, 1–10 priority sliders, results table | "Must run on my hardware" filter in the recommender |
| Hardware: Pick devices (catalog search, quantities, host PC), Enter specs (2-column form), Ask AI chat; results table with measured or estimated speed | Price-drop and new-model alerts, email of any kind |
| Quants: model chips, memory budget, KLD-vs-size scatter with best trade-off line, table | Running our own KLD measurements automatically (manual script only) |
| Device test page + `atlas-probe` CLI that prints a profile and can share runs | Evals on your own data |
| Ingestion: Artificial Analysis, OpenRouter, Hugging Face, dbgpu daily/weekly; Arena, LiveBench, Epoch AI as best-effort jobs | Mobile app, i18n |
| `/admin/match` page to confirm model-name matches | Payments, analytics, cookies banner |
| Light and dark theme, works at 400 px wide |  |

## Free-tier stack

Everything runs on free plans; the only key you bring is your AI provider's. Limits below were checked on 24 Nov 2026 and drive several design choices.

| Service | Used for | Free limit that matters | How Atlas stays inside it |
| --- | --- | --- | --- |
| [Vercel Hobby](https://vercel.com/docs/cron-jobs/usage-and-pricing) | Next.js app, API routes, light daily cron jobs | Cron at most once per day, ±59 min precision; [functions up to 300 s](https://vercel.com/docs/functions/edge-functions/limits) | One cron route per light source, each finishes in < 60 s |
| [Supabase Free](https://supabase.com/pricing) | Postgres, views, storage of all data | [500 MB database per project](https://supabase.com/docs/pricing); paused after 1 week inactive | Insert-on-change history; daily jobs keep it awake |
| [GitHub Actions](https://docs.github.com/billing/managing-billing-for-your-products/managing-billing-for-github-actions) | Heavy jobs: Hugging Face sync, dbgpu import, calibration | 2,000 minutes/month on private repos (free and unlimited on public) | \~10 min/day budget ≈ 300 min/month |
| AI provider (your key) | Ask AI parsing only | Your provider's limits | Fast model, temperature 0, 10 requests/min per browser |
| Artificial Analysis free API | Scores, speed, price | 100 requests/day, internal use only, attribution required | One call per day |
| OpenRouter public API | Prices, providers, modalities, context | None for model listing | Daily |
| Hugging Face Hub API | Files, sizes, config.json | Free token, rate-limited | Daily in GitHub Actions, only models with `hf_repo` |
| npm registry | Publishing `atlas-probe` | Free | Public package, no secrets inside |

**AI provider settings.** The app calls any OpenAI-compatible Chat Completions endpoint with the `openai` npm package: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` in env. The domain aianc.com currently redirects to a domain-for-sale page, so the provider's real base URL must be filled in by hand; if the provider is Anthropic-native instead, set `AI_PROVIDER=anthropic` and the route uses the `@anthropic-ai/sdk` with the same three variables.

**Keeping the database small.** Writers compare with the newest row for the same key and insert only when a value changed by more than a rounding step (0.1 for scores, $0.001 for prices, 1% for speeds). Expect under 50 MB in year one.

## Repo structure and conventions

One repo, one Next.js app at the root, plus a separate `cli/` package for the probe. The tag after each path is the workstream that owns it (see Agent plan).

```text
atlas/
  design/prototype.html            # visual reference, read-only          [W1]
  NOTES.md                         # decisions agents made on the fly    [all, append-only]
  .env.example                                                            [W1]
  vercel.json                      # cron schedule                        [W4]
  supabase/migrations/*.sql        # schema, views, RLS                   [W3]
  supabase/seed.sql                # sample data from the prototype       [W3]
  .github/workflows/*.yml          # heavy scheduled jobs                 [W4]
  scripts/                         # tsx scripts run by GitHub Actions    [W4, W3: import-dbgpu]
  lib/contracts.ts                 # shared types (frozen)                [W1]
  lib/sample-data.ts               # prototype data typed as contracts    [W1]
  lib/supabase/{server,browser}.ts # clients                              [W1]
  lib/data/*.ts                    # loaders: views -> contract types     [W1]
  lib/engine/*.ts                  # all maths, pure functions            [W5]
  lib/ingest/*.ts                  # source clients + matching + writers  [W4]
  lib/ai.ts                        # OpenAI-compatible client             [W7]
  components/ui/*                  # primitives, icons, gems, Reticle     [W2]
  components/shell/*               # header, hero, stars, footer          [W2]
  components/explorer/*, recommender/*, detail/*                          [W6]
  components/hardware/*, quants/*                                         [W7]
  components/probe/*                                                      [W8]
  app/layout.tsx, app/globals.css  # fonts, tokens, theme                 [W2]
  app/page.tsx (Explorer), app/recommend/page.tsx                         [W6]
  app/hardware/page.tsx, app/quants/page.tsx                              [W7]
  app/probe/page.tsx                                                      [W8]
  app/admin/match/page.tsx                                                [W4]
  app/api/cron/[source]/route.ts                                          [W4]
  app/api/ask-hardware/route.ts                                           [W7]
  app/api/runs/route.ts                                                   [W8]
  cli/                             # atlas-probe npm package              [W8]
```

**Stack.** Latest stable Next.js (App Router, React Server Components), TypeScript strict, Tailwind CSS v4, Radix UI primitives (Dialog, Popover, Tabs, Slider, Switch, Checkbox, Select), Motion (`motion/react`), `@supabase/supabase-js` v2, Zod, `openai` npm. Fonts with `next/font/google`: Inter and Instrument Serif. pnpm. No chart library: charts are hand-written SVG like the prototype.

**Conventions**

- Routes: `/` Explorer, `/recommend`, `/hardware`, `/quants`, `/probe`, `/admin/match`. Hash-routing from the prototype becomes real routes.
- Data flow: each page is a Server Component that loads one view via `lib/data`, passes plain JSON to one Client Component, which runs `lib/engine` on load.
- State that should survive reloads (hardware setup, priorities, selected providers) lives in the URL query string first, then `localStorage`.
- Colours only through the CSS variables in `globals.css`; no hex values in components except the five brand colours already defined there.
- Every user-visible number shows its unit; every sourced number can show its source and sync time.

## Setup

You create four free accounts and paste keys into Vercel and GitHub; everything else is code. Do steps 1–4 before starting the agents so they can run against a real database.

1. **Supabase:** new project on the Free plan, region Southeast Asia (Singapore). Copy the project URL, publishable key (sb_publishable_…) and secret key (sb_secret_…) from Settings → API Keys.
2. **Artificial Analysis:** sign in to the Insights Platform, create a free API key.
3. **Hugging Face:** create a read-only access token.
4. **GitHub:** new private repo `atlas`; add `design/prototype.html` (the prototype file) at the root before the first agent starts.
5. **Vercel:** import the repo on Hobby, paste the env vars below, deploy. Cron jobs register from `vercel.json` on deploy.
6. **GitHub Actions secrets:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `HF_TOKEN`.
7. **First data load:** run each workflow once with "Run workflow", then call each cron route once with `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/<source>`.

**Environment variables** (`.env.example` lists them all; server-only unless prefixed `NEXT_PUBLIC_`)

| Name | Example / format | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Browser + server reads |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | sb_publishable_… | Read-only views |
| `SUPABASE_SECRET_KEY` | sb_secret_… | Cron routes, scripts, `/api/runs`, `/admin` |
| `AA_API_KEY` | from step 2 | `/api/cron/aa` |
| `HF_TOKEN` | `hf_…` | GitHub Actions HF sync |
| `AI_PROVIDER` | `openai` (default) or `anthropic` | `/api/ask-hardware` |
| `AI_BASE_URL` | your provider's OpenAI-compatible base URL, e.g. `https://api.example.com/v1` | `/api/ask-hardware` |
| `AI_API_KEY` | your key | `/api/ask-hardware` |
| `AI_MODEL` | the provider's fast, cheap model id | `/api/ask-hardware` |
| `CRON_SECRET` | 32+ random characters | Vercel sends it as a Bearer token on cron calls; routes reject calls without it |
| `ADMIN_PASSWORD` | your choice | `/admin/match` (cookie after one prompt) |
| `RUNS_SALT` | 32+ random characters | Hashing probe fingerprints |
| `NEXT_PUBLIC_SITE_URL` | `https://atlas-xxxx.vercel.app` | Probe default endpoint, links |

## Database

One migration file creates 15 tables and 6 read views; the browser only ever reads views with the publishable key (which uses the anon Postgres role), and only server code with the secret key writes. Copy this into `supabase/migrations/0001_init.sql` as is.

```sql
create extension if not exists pg_trgm;

-- catalog -------------------------------------------------------------
create table creators (
  id text primary key, name text not null,
  default_selected boolean not null default false
);

create table models (
  id text primary key,                         -- slug: 'claude-opus-5-5-max'
  family_id text, name text not null,
  creator_id text references creators(id),
  open_weights boolean not null default false,
  reasoning boolean,
  in_modalities text[] not null default '{text}',
  out_modalities text[] not null default '{text}',
  context_k int,
  total_params_b numeric, active_params_b numeric,
  kv_bytes_per_token int,                      -- from config.json
  hf_repo text, released_on date, deprecated_on date,
  created_at timestamptz not null default now()
);

create table model_aliases (
  source text not null, external_id text not null, external_name text,
  model_id text references models(id) on delete cascade,
  match_method text check (match_method in ('exact','fuzzy','manual','new')),
  match_score numeric, confirmed boolean not null default false,
  primary key (source, external_id)
);

-- facts with history (insert only when a value changed) -------------
create table scores (
  id bigserial primary key,
  model_id text not null references models(id) on delete cascade,
  source text not null,        -- aa | arena | livebench | epoch
  metric text not null,        -- intelligence | coding | agentic | cyber | math | long_ctx
  value numeric not null,
  scale text not null,         -- index | elo | pct
  source_ref text,
  fetched_at timestamptz not null default now()
);
create index scores_latest on scores (model_id, source, metric, fetched_at desc);

create table api_offers (
  id bigserial primary key,
  model_id text not null references models(id) on delete cascade,
  provider text not null, source text not null,   -- aa | openrouter
  price_in numeric, price_out numeric, price_cache numeric,  -- USD per 1M tokens
  tps_median numeric, ttft_median_s numeric,
  context_k int, quantization text,
  fetched_at timestamptz not null default now()
);
create index offers_latest on api_offers (model_id, provider, source, fetched_at desc);

create table task_profile (
  model_id text primary key references models(id) on delete cascade,
  task_in_tokens int not null, task_out_tokens int not null,
  estimated boolean not null default true,
  updated_at timestamptz not null default now()
);

-- open-weight files ------------------------------------------------
create table files (
  id bigserial primary key,
  model_id text not null references models(id) on delete cascade,
  repo text not null, uploader text not null, quant text not null,
  format text not null check (format in ('gguf','bf16','fp16','fp8','int4','mlx','awq','gptq')),
  bits_per_weight numeric, size_gb numeric not null,
  kind text not null check (kind in ('official','quant','finetune','abliterated','merge')),
  downloads int, updated_at timestamptz,
  unique (repo, quant)
);

create table file_quality (
  id bigserial primary key,
  file_id bigint not null references files(id) on delete cascade,
  kld numeric, ppl_delta numeric,
  eval_set text not null,
  reference_file_id bigint references files(id),
  source text not null, source_ref text,      -- atlas | unsloth | localbench | ...
  measured_at timestamptz not null default now(),
  unique (file_id, eval_set, source)
);

-- hardware -----------------------------------------------------------
create table devices (
  id text primary key, name text not null, category text not null,
  type text not null check (type in ('gpu','unified','cpu')),
  mem_gb numeric not null, bw_gbs numeric not null, fp16_tflops numeric,
  fp8 boolean not null default false, fp4 boolean not null default false,
  backend text not null check (backend in ('cuda','rocm','metal','vulkan','cpu')),
  usable_frac numeric,                         -- null = engine default
  source text not null check (source in ('curated','dbgpu','probe')),
  verified boolean not null default false,
  aliases text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index devices_name_trgm on devices using gin (name gin_trgm_ops);

create table runs (
  id bigserial primary key,
  device_id text references devices(id), device_name_raw text,
  file_id bigint references files(id), file_ref text not null,   -- 'repo:quant'
  runtime text not null, runtime_version text, ctx int,
  gen_tps numeric not null, prompt_tps numeric, ttft_s numeric, load_s numeric,
  probe_version text, fingerprint text not null,
  verified boolean not null default false, rejected_reason text,
  created_at timestamptz not null default now()
);
create index runs_group on runs (device_id, file_id, runtime);

create table setups (
  id text primary key default substr(md5(random()::text), 1, 8),
  spec jsonb not null, created_at timestamptz not null default now()
);

-- calibration + ops ------------------------------------------------
create table metric_sources (
  metric text not null, source text not null, source_metric text not null,
  weight numeric not null default 1, primary key (metric, source)
);
create table calibrations (
  source text not null, metric text not null,
  a numeric not null, b numeric not null, n_overlap int not null, mae numeric,
  fitted_at timestamptz not null default now(), primary key (source, metric)
);
create table eta_calibrations (
  device_type text not null, runtime text not null, moe boolean not null,
  eta numeric not null, n_runs int not null, fitted_at timestamptz not null default now(),
  primary key (device_type, runtime, moe)
);
create table ingest_log (
  id bigserial primary key, source text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  ok boolean, rows_inserted int, rows_unchanged int, error text
);

-- read views (owner rights; anon reads views only) -----------------
create view v_latest_scores as
  select distinct on (model_id, source, metric) model_id, source, metric, value, scale, fetched_at
  from scores order by model_id, source, metric, fetched_at desc;

create view v_latest_offers as
  select distinct on (model_id, provider, source) *
  from api_offers order by model_id, provider, source, fetched_at desc;

create view v_models as
  select m.*, c.name as creator_name,
    coalesce((select jsonb_agg(to_jsonb(s) - 'model_id') from v_latest_scores s where s.model_id = m.id), '[]') as scores,
    coalesce((select jsonb_agg(to_jsonb(o) - 'model_id' - 'id') from v_latest_offers o where o.model_id = m.id), '[]') as offers,
    (select to_jsonb(t) - 'model_id' from task_profile t where t.model_id = m.id) as task
  from models m left join creators c on c.id = m.creator_id
  where m.deprecated_on is null or m.deprecated_on > current_date - 30;

create view v_files as
  select f.*,
    coalesce((select jsonb_agg(jsonb_build_object('kld', q.kld, 'eval_set', q.eval_set, 'source', q.source, 'measured_at', q.measured_at))
              from file_quality q where q.file_id = f.id), '[]') as quality
  from files f;

create view v_run_stats as
  select device_id, file_id, runtime, count(*) as n_runs,
    percentile_cont(0.5)  within group (order by gen_tps)    as gen_p50,
    percentile_cont(0.25) within group (order by gen_tps)    as gen_p25,
    percentile_cont(0.75) within group (order by gen_tps)    as gen_p75,
    percentile_cont(0.5)  within group (order by prompt_tps) as prompt_p50,
    bool_or(verified) as any_verified, max(created_at) as last_run
  from runs
  where rejected_reason is null and created_at > now() - interval '365 days'
  group by device_id, file_id, runtime;

create view v_source_status as
  select distinct on (source) source, finished_at, ok, error
  from ingest_log where finished_at is not null order by source, finished_at desc;

-- security ---------------------------------------------------------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

-- anon may read catalog tables directly; runs and setups only through views/API
create policy read_all on creators     for select to anon using (true);
create policy read_all on models       for select to anon using (true);
create policy read_all on devices      for select to anon using (true);
create policy read_all on calibrations for select to anon using (true);
create policy read_all on metric_sources for select to anon using (true);
create policy read_all on eta_calibrations for select to anon using (true);
grant select on v_latest_scores, v_latest_offers, v_models, v_files, v_run_stats, v_source_status to anon;
```

**Seed** (`supabase/seed.sql`): the prototype's 10 models, 12 default creators plus the other 36 provider names, all variants and their KLD values (`eval_set = 'prototype-sample'`), the 20 devices (`source = 'curated'`), the sample measured runs, and `metric_sources` rows mapping each metric to its source fields. Seed rows are replaced by real data after the first ingestion; keep the seed so the app renders on a fresh database.

## Shared contracts

`lib/contracts.ts` is written first by the Lead (W1) and is frozen after that: every loader returns these types, every engine function takes and returns them, every component renders them. Agents may add their own private types, never change these.

```ts
// lib/contracts.ts
export type SourceId = 'aa' | 'arena' | 'livebench' | 'epoch';
export type Metric = 'intelligence' | 'coding' | 'agentic' | 'cyber' | 'math' | 'long_ctx';
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file';

export interface SourceScore { source: SourceId; metric: Metric; value: number; scale: 'index' | 'elo' | 'pct'; fetchedAt: string }
export interface ApiOffer { provider: string; source: 'aa' | 'openrouter'; priceIn: number | null; priceOut: number | null; priceCache: number | null; tpsMedian: number | null; ttftS: number | null; contextK: number | null; quantization: string | null; fetchedAt: string }
export interface ModelRow {
  id: string; familyId: string | null; name: string; creatorId: string; creatorName: string;
  openWeights: boolean; reasoning: boolean | null; inModalities: Modality[]; outModalities: Modality[];
  contextK: number | null; totalParamsB: number | null; activeParamsB: number | null; kvBytesPerToken: number | null;
  hfRepo: string | null; scores: SourceScore[]; offers: ApiOffer[];
  task: { inTokens: number; outTokens: number; estimated: boolean } | null;
}

export type FileFormat = 'gguf' | 'bf16' | 'fp16' | 'fp8' | 'int4' | 'mlx' | 'awq' | 'gptq';
export type FileKind = 'official' | 'quant' | 'finetune' | 'abliterated' | 'merge';
export interface FileQuality { kld: number | null; evalSet: string; source: string; measuredAt: string }
export interface FileRow { id: number; modelId: string; repo: string; uploader: string; quant: string; format: FileFormat; bitsPerWeight: number; sizeGb: number; kind: FileKind; downloads: number | null; quality: FileQuality[] }

export type DeviceType = 'gpu' | 'unified' | 'cpu';
export type Backend = 'cuda' | 'rocm' | 'metal' | 'vulkan' | 'cpu';
export interface Device { id: string; name: string; category: string; type: DeviceType; memGb: number; bwGbs: number; fp16Tflops: number | null; fp8: boolean; fp4: boolean; backend: Backend; usableFrac: number | null; source: 'curated' | 'dbgpu' | 'probe'; verified: boolean }
export interface RunStat { deviceId: string; fileId: number; runtime: string; nRuns: number; genP50: number; genP25: number; genP75: number; promptP50: number | null; anyVerified: boolean; lastRun: string }
export interface SourceStatus { source: string; finishedAt: string; ok: boolean; error: string | null }
export interface Calibration { source: SourceId; metric: Metric; a: number; b: number; nOverlap: number }
export interface EtaCalibration { deviceType: DeviceType; runtime: string; moe: boolean; eta: number; nRuns: number }

// hardware ------------------------------------------------------------
export type Arch = 'discrete' | 'unified' | 'cpu';
export type Link = 'none' | 'pcie' | 'nvlink' | 'network';
export interface HardwareSpec {
  arch: Arch; gpus: number; vramGb: number; gpuBwGbs: number; link: Link;
  ramGb: number; ramBwGbs: number; fp16Tflops: number; fp8: boolean; backend: Backend;
  diskFreeGb: number; diskReadGbs: number;
  deviceId?: string;                                   // set when the setup is exactly one catalog device
  single?: { memGb: number; bwGbs: number; fp16Tflops: number }; // largest single device
  macGpuCap?: number;                                  // default 0.75
}
export interface SetupPick { deviceId: string; qty: number }
export interface HostPc { ramGb: number; ramBwGbs: number; diskFreeGb: number; diskReadGbs: number }

// engine outputs --------------------------------------------------------
export interface ScoredModel extends ModelRow {
  intelligence: number | null;                         // calibrated weighted average
  domain: Record<Metric, number | null>;
  perSource: { source: SourceId; metric: Metric; raw: number; calibrated: number; fetchedAt: string }[];
  nSources: number; spread: number | null; flags: ('one-source' | 'disagree' | 'stale')[];
  offer: ApiOffer | null;                              // chosen provider
  costPerTask: number | null; timePerTask: number | null; blendedPrice: number | null; costEstimated: boolean;
}
export type Where = 'gpu' | 'offload' | 'cpu' | 'no';
export interface FitResult {
  fileId: number; where: Where; why: string | null; needGb: number; fitsDisk: boolean; soloDevice: boolean;
  runtime: string | null;
  speed: { kind: 'measured'; p50: number; p25: number; p75: number; nRuns: number }
       | { kind: 'estimate'; mid: number; lo: number; hi: number } | null;
  promptTps: number | null; loadS: number | null;
}
export interface ModelFit { modelId: string; best: FitResult; all: FitResult[] }
export interface RecommendInput {
  weights: { intelligence: number; speed: number; cost: number };   // 1..10 each
  openWeights: 'any' | 'open' | 'closed'; reasoning: 'any' | 'yes' | 'no';
  inputs: Modality[]; outputs: Modality[]; minContextK: number; focus: Metric; providers: string[];
}
export interface Recommendation { model: ScoredModel; match: number }   // 0..100
export interface QuantView { points: FileRow[]; frontier: number[]; bestUnder: number | null; uploaderGap: { a: FileRow; b: FileRow; ratio: number } | null }
```

**Engine signatures** (`lib/engine/index.ts` re-exports all; owned by W5):

```ts
export function scoreModels(models: ModelRow[], calibrations: Calibration[], opts?: { disabledSources?: SourceId[]; provider?: Record<string, string> }): ScoredModel[];
export function fitCalibrations(models: ModelRow[]): Calibration[];        // used by the nightly job
export function recommend(models: ScoredModel[], input: RecommendInput): Recommendation[];
export function specFromPicks(picks: SetupPick[], devices: Device[], host: HostPc): HardwareSpec | null;
export function fitFile(model: ModelRow, file: FileRow, spec: HardwareSpec, ctxK: number, ctx: { runStats: RunStat[]; eta: EtaCalibration[] }): FitResult;
export function fitModel(model: ModelRow, files: FileRow[], spec: HardwareSpec, ctxK: number, ctx: { runStats: RunStat[]; eta: EtaCalibration[] }): ModelFit;
export function fastMemoryGb(spec: HardwareSpec): number;
export function spillMemoryGb(spec: HardwareSpec): number;
export function quantView(files: FileRow[], evalSet: string, budgetGb: number): QuantView;
export function physicalCeilingTps(model: ModelRow, file: FileRow, bwGbs: number): number;  // used by /api/runs
export function fitEta(runs: { estimate: number; measured: number; deviceType: DeviceType; runtime: string; moe: boolean }[]): EtaCalibration[];
```

## Engine

The engine is about 400 lines of pure TypeScript with no imports beyond `contracts.ts`; W5 writes it from the reference code below, which is complete enough to paste and tidy. The formulas and the reasons for each constant are in the engine design doc; this section is the code.

```ts
// lib/engine/constants.ts
export const K = {
  fileOverhead: 1.05, runtimeGb: 1.5,
  usable: { discrete: 0.92, unified: 0.85, macDefault: 0.75 },
  spill: { frac: 0.8, osGb: 4 },
  eta: { single: 0.6, pcie: 0.45, nvlink: 0.55, network: 0.35 }, ramEta: 0.6,
  moePenalty: 0.7, metalPenalty: 0.8, range: [0.7, 1.15] as const,
  prefillEff: 0.3, cpuTflops: 2,
  kld: { nearLossless: 0.01, small: 0.05 },
  minRunsMeasured: 3, minOverlap: 8, disagree: 8, staleHours: 48,
  blend: { cache: 7, input: 2, output: 1 },
  kvFallbackBytesPerActiveB: 2400, kvFallbackMax: 160_000,
};
export const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
```

```ts
// lib/engine/scores.ts  — calibration + multi-source average + derived metrics
export function theilSen(x: number[], y: number[]) {
  const sl: number[] = [];
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) sl.push((y[j] - y[i]) / (x[j] - x[i]));
  const b = median(sl); return { a: median(y.map((v, i) => v - b * x[i])), b };
}
// reference = Artificial Analysis for each metric; other sources map onto it
export function fitCalibrations(models: ModelRow[]): Calibration[] {
  const out: Calibration[] = [];
  for (const metric of METRICS) for (const source of ['arena', 'livebench', 'epoch'] as SourceId[]) {
    const pairs = models.flatMap(m => { const r = val(m, 'aa', metric), s = val(m, source, metric); return r != null && s != null ? [[s, r]] : []; });
    if (pairs.length < K.minOverlap) continue;
    const { a, b } = theilSen(pairs.map(p => p[0]), pairs.map(p => p[1]));
    out.push({ source, metric, a, b, nOverlap: pairs.length });
  }
  for (const metric of METRICS) out.push({ source: 'aa', metric, a: 0, b: 1, nOverlap: models.length });
  return out;
}
export function scoreModels(models: ModelRow[], cals: Calibration[], opts: { disabledSources?: SourceId[]; provider?: Record<string, string> } = {}): ScoredModel[] {
  const taskMedian = (r: boolean | null) => { const t = models.filter(m => m.task && !m.task.estimated && m.reasoning === r).map(m => m.task!); return t.length ? { inTokens: median(t.map(x => x.inTokens)), outTokens: median(t.map(x => x.outTokens)) } : { inTokens: 40000, outTokens: r ? 12000 : 6000 }; };
  return models.map(m => {
    const perSource = m.scores.filter(s => !opts.disabledSources?.includes(s.source)).flatMap(s => {
      const c = cals.find(c => c.source === s.source && c.metric === s.metric); return c ? [{ source: s.source, metric: s.metric, raw: s.value, calibrated: c.a + c.b * s.value, fetchedAt: s.fetchedAt }] : [];
    });
    const avg = (metric: Metric) => { const v = perSource.filter(p => p.metric === metric).map(p => p.calibrated); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const intel = perSource.filter(p => p.metric === 'intelligence').map(p => p.calibrated);
    const spread = intel.length > 1 ? Math.max(...intel) - Math.min(...intel) : null;
    const stale = perSource.some(p => Date.now() - Date.parse(p.fetchedAt) > K.staleHours * 3.6e6);
    const offer = pickOffer(m, opts.provider?.[m.id]);
    const task = m.task ?? taskMedian(m.reasoning);
    const costPerTask = offer?.priceIn != null && offer.priceOut != null ? (task.inTokens * offer.priceIn + task.outTokens * offer.priceOut) / 1e6 : null;
    const timePerTask = offer?.tpsMedian ? (offer.ttftS ?? 0) + task.outTokens / offer.tpsMedian : null;
    const blendedPrice = offer?.priceIn != null && offer.priceOut != null ? (K.blend.cache * (offer.priceCache ?? offer.priceIn) + K.blend.input * offer.priceIn + K.blend.output * offer.priceOut) / 10 : null;
    const flags = [...(intel.length === 1 ? ['one-source'] : []), ...(spread != null && spread > K.disagree ? ['disagree'] : []), ...(stale ? ['stale'] : [])] as ScoredModel['flags'];
    return { ...m, intelligence: avg('intelligence'), domain: Object.fromEntries(METRICS.map(x => [x, avg(x)])) as Record<Metric, number | null>, perSource, nSources: intel.length, spread, flags, offer, costPerTask, timePerTask, blendedPrice, costEstimated: !m.task || m.task.estimated };
  });
}
// maker's own API if listed, else the offer with the median input price
function pickOffer(m: ModelRow, chosen?: string) {
  const priced = m.offers.filter(o => o.priceIn != null);
  return priced.find(o => o.provider === chosen) ?? priced.find(o => o.provider.toLowerCase().includes(m.creatorName.toLowerCase())) ?? [...priced].sort((a, b) => a.priceIn! - b.priceIn!)[priced.length >> 1] ?? null;
}
```

```ts
// lib/engine/recommend.ts
export function recommend(models: ScoredModel[], q: RecommendInput): Recommendation[] {
  const pool = models.filter(m => q.providers.includes(m.creatorName) && (q.openWeights === 'any' || (q.openWeights === 'open') === m.openWeights)
    && (q.reasoning === 'any' || (q.reasoning === 'yes') === !!m.reasoning) && q.inputs.every(x => m.inModalities.includes(x))
    && q.outputs.every(x => m.outModalities.includes(x)) && (m.contextK ?? 0) >= q.minContextK);
  const I = (m: ScoredModel) => q.focus === 'intelligence' ? m.intelligence : m.domain[q.focus];
  const rng = (f: (m: ScoredModel) => number | null) => { const v = pool.map(f).filter((x): x is number => x != null); return [Math.min(...v), Math.max(...v)]; };
  const sc = (v: number | null, [lo, hi]: number[], invert = false) => v == null ? 0 : hi === lo ? 1 : invert ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
  const ri = rng(I), rc = rng(m => m.costPerTask && Math.log(m.costPerTask)), rt = rng(m => m.timePerTask && Math.log(m.timePerTask));
  const w = q.weights, tot = w.intelligence + w.speed + w.cost;
  return pool.map(m => ({ model: m, match: Math.round(100 * (w.intelligence * sc(I(m), ri) + w.cost * sc(m.costPerTask && Math.log(m.costPerTask), rc, true) + w.speed * sc(m.timePerTask && Math.log(m.timePerTask), rt, true)) / tot) }))
    .sort((a, b) => b.match - a.match || (I(b.model) ?? 0) - (I(a.model) ?? 0) || (a.model.costPerTask ?? 1e9) - (b.model.costPerTask ?? 1e9));
}
```

```ts
// lib/engine/hardware.ts
export function specFromPicks(picks: SetupPick[], devices: Device[], host: HostPc): HardwareSpec | null {
  const items = picks.filter(p => p.qty > 0).map(p => ({ d: devices.find(d => d.id === p.deviceId)!, qty: p.qty })).filter(x => x.d);
  if (!items.length) return null;
  const uni = items.filter(x => x.d.type === 'unified'), gpu = items.filter(x => x.d.type === 'gpu');
  const n = items.reduce((a, x) => a + x.qty, 0), deviceId = items.length === 1 && items[0].qty === 1 ? items[0].d.id : undefined;
  const big = [...items].sort((a, b) => b.d.memGb - a.d.memGb)[0].d;
  const tf = items.reduce((a, x) => a + (x.d.fp16Tflops ?? 0) * x.qty, 0), minBw = Math.min(...items.map(x => x.d.bwGbs));
  if (!gpu.length) return { arch: 'unified', gpus: n, vramGb: 0, gpuBwGbs: minBw, link: n > 1 ? 'network' : 'none', ramGb: uni.reduce((a, x) => a + x.d.memGb * x.qty, 0), ramBwGbs: minBw, fp16Tflops: tf, fp8: uni.every(x => x.d.fp8), backend: big.backend, diskFreeGb: host.diskFreeGb, diskReadGbs: host.diskReadGbs, deviceId, single: { memGb: big.memGb * usableFrac(big), bwGbs: big.bwGbs, fp16Tflops: big.fp16Tflops ?? 0 } };
  const cnt = gpu.reduce((a, x) => a + x.qty, 0);
  return { arch: 'discrete', gpus: cnt, vramGb: gpu.reduce((a, x) => a + x.d.memGb * x.qty, 0) / cnt, gpuBwGbs: Math.min(...gpu.map(x => x.d.bwGbs)), link: uni.length ? 'network' : 'pcie', ramGb: host.ramGb + uni.reduce((a, x) => a + x.d.memGb * x.qty, 0), ramBwGbs: host.ramBwGbs, fp16Tflops: tf, fp8: gpu.every(x => x.d.fp8), backend: gpu[0].d.backend, diskFreeGb: host.diskFreeGb, diskReadGbs: host.diskReadGbs, deviceId, single: { memGb: big.memGb * usableFrac(big), bwGbs: big.bwGbs, fp16Tflops: big.fp16Tflops ?? 0 } };
}
const usableFrac = (d: Device) => d.usableFrac ?? (d.type === 'gpu' ? K.usable.discrete : d.backend === 'metal' ? K.usable.macDefault : K.usable.unified);
export const fastMemoryGb = (s: HardwareSpec) => s.arch === 'cpu' ? 0 : s.arch === 'unified' ? s.ramGb * (s.backend === 'metal' ? s.macGpuCap ?? K.usable.macDefault : K.usable.unified) : s.vramGb * s.gpus * K.usable.discrete;
export const spillMemoryGb = (s: HardwareSpec) => s.arch === 'unified' ? 0 : Math.max(0, s.ramGb * K.spill.frac - K.spill.osGb);
const kvBytes = (m: ModelRow) => m.kvBytesPerToken ?? Math.min(K.kvFallbackMax, K.kvFallbackBytesPerActiveB * (m.activeParamsB ?? 10));
export const physicalCeilingTps = (m: ModelRow, f: FileRow, bw: number) => bw / ((m.activeParamsB ?? 1) * f.bitsPerWeight / 8);

export function fitFile(m: ModelRow, f: FileRow, s: HardwareSpec, ctxK: number, ctx: { runStats: RunStat[]; eta: EtaCalibration[] }): FitResult {
  const need = f.sizeGb * K.fileOverhead + kvBytes(m) * ctxK * 1000 / 2 ** 30 + K.runtimeGb;
  const fast = fastMemoryGb(s), spill = spillMemoryGb(s);
  const base = { fileId: f.id, needGb: Math.round(need), fitsDisk: f.sizeGb <= s.diskFreeGb, loadS: Math.round(f.sizeGb / Math.max(0.1, s.diskReadGbs)) };
  const no = (why: string): FitResult => ({ ...base, where: 'no', why, soloDevice: false, runtime: null, speed: null, promptTps: null, loadS: null });
  if (f.format !== 'gguf') {
    if (s.arch === 'cpu' || s.backend === 'cpu') return no('Needs a GPU runtime (vLLM / MLX)');
    if (f.format === 'fp8' && !s.fp8) return no('Needs FP8 support');
    if (f.format === 'int4' && s.backend === 'metal') return no('Format not supported on Mac');
    if (f.format === 'mlx' && s.backend !== 'metal') return no('MLX files run on Mac only');
  }
  let where: FitResult['where'];
  if (s.arch !== 'cpu' && need <= fast) where = 'gpu';
  else if (f.format === 'gguf' && need <= fast + spill) where = s.arch === 'cpu' ? 'cpu' : 'offload';
  else return no(f.format !== 'gguf' && need <= fast + spill ? `Needs ${Math.round(need)} GB of GPU memory; this format can't spill into RAM` : `Needs ${Math.round(need)} GB, has ${Math.round(fast + spill)} GB`);
  const one = s.single ?? { memGb: fast / Math.max(1, s.gpus), bwGbs: s.gpuBwGbs, fp16Tflops: s.fp16Tflops / Math.max(1, s.gpus) };
  const solo = where === 'gpu' && s.gpus > 1 && need <= one.memGb;
  const runtime = f.format === 'gguf' ? 'llama.cpp' : s.backend === 'metal' ? 'MLX' : 'vLLM';
  const moe = (m.activeParamsB ?? 0) < (m.totalParamsB ?? 0);
  const stat = s.deviceId ? ctx.runStats.find(r => r.deviceId === s.deviceId && r.fileId === f.id && r.nRuns >= K.minRunsMeasured) : undefined;
  const B = (m.activeParamsB ?? 1) * f.bitsPerWeight / 8, frac = where === 'gpu' ? 0 : where === 'cpu' ? 1 : (need - fast) / need;
  const cal = ctx.eta.find(e => e.deviceType === (s.arch === 'discrete' ? 'gpu' : s.arch === 'unified' ? 'unified' : 'cpu') && e.runtime === runtime && e.moe === moe);
  const eta = cal?.eta ?? (s.gpus > 1 && !solo ? K.eta[s.link === 'none' ? 'pcie' : s.link] : K.eta.single);
  const bw = solo ? one.bwGbs : s.gpuBwGbs;
  const t = (B * (1 - frac)) / (Math.max(1, bw) * eta) + (B * frac) / (Math.max(1, s.ramBwGbs) * K.ramEta);
  const mid = (1 / t) * (cal ? 1 : (moe ? K.moePenalty : 1) * (s.backend === 'metal' ? K.metalPenalty : 1));
  const tf = where === 'cpu' ? K.cpuTflops : solo ? one.fp16Tflops : s.fp16Tflops;
  return { ...base, where, why: null, soloDevice: solo, runtime: stat?.runtime ?? runtime,
    speed: stat ? { kind: 'measured', p50: stat.genP50, p25: stat.genP25, p75: stat.genP75, nRuns: stat.nRuns } : { kind: 'estimate', mid: round1(mid), lo: round1(mid * K.range[0]), hi: round1(mid * K.range[1]) },
    promptTps: stat?.promptP50 ?? Math.round(tf * 1e12 * K.prefillEff / (2 * (m.activeParamsB ?? 1) * 1e9)) };
}
const round1 = (x: number) => Math.max(0.1, Math.round(x * 10) / 10);
// smallest near-lossless file in fast memory, else lowest-loss in fast memory, else lowest-loss that runs, else smallest
export function fitModel(m: ModelRow, files: FileRow[], s: HardwareSpec, ctxK: number, ctx: { runStats: RunStat[]; eta: EtaCalibration[] }): ModelFit {
  const kld = (f: FileRow) => f.kind === 'official' ? 0 : f.quality[0]?.kld ?? null;
  const all = files.filter(f => f.modelId === m.id).map(f => ({ f, r: fitFile(m, f, s, ctxK, ctx) }));
  const rated = all.filter(x => kld(x.f) != null), g = rated.filter(x => x.r.where === 'gpu');
  const pick = g.filter(x => kld(x.f)! <= K.kld.nearLossless).sort((a, b) => a.f.sizeGb - b.f.sizeGb)[0]
    ?? g.sort((a, b) => kld(a.f)! - kld(b.f)!)[0]
    ?? rated.filter(x => x.r.where !== 'no').sort((a, b) => kld(a.f)! - kld(b.f)!)[0]
    ?? [...all].sort((a, b) => a.f.sizeGb - b.f.sizeGb)[0];
  return { modelId: m.id, best: pick.r, all: all.map(x => x.r) };
}
```

```ts
// lib/engine/quants.ts
export function quantView(files: FileRow[], evalSet: string, budgetGb: number): QuantView {
  const k = (f: FileRow) => f.quality.find(q => q.evalSet === evalSet)?.kld ?? null;
  const pts = files.filter(f => f.kind === 'quant' && (k(f) ?? 0) > 0);
  const frontier = [...pts].sort((a, b) => a.sizeGb - b.sizeGb || k(a)! - k(b)!).reduce<FileRow[]>((acc, f) => (!acc.length || k(f)! < k(acc[acc.length - 1])! ? [...acc, f] : acc), []).map(f => f.id);
  const best = pts.filter(f => f.sizeGb <= budgetGb).sort((a, b) => k(a)! - k(b)! || a.sizeGb - b.sizeGb)[0] ?? null;
  const groups = new Map<number, FileRow[]>(); pts.forEach(f => groups.set(Math.round(f.sizeGb), [...(groups.get(Math.round(f.sizeGb)) ?? []), f]));
  const gap = [...groups.values()].filter(g => new Set(g.map(f => f.uploader)).size > 1).map(g => { const s = [...g].sort((a, b) => k(a)! - k(b)!); return { a: s[0], b: s[s.length - 1], ratio: k(s[s.length - 1])! / k(s[0])! }; }).sort((x, y) => y.ratio - x.ratio)[0] ?? null;
  return { points: pts, frontier, bestUnder: best?.id ?? null, uploaderGap: gap };
}
```

`METRICS` and `val(m, source, metric)` are two-line helpers in `scores.ts`. `fitEta` groups runs by device type × runtime × MoE, keeps groups with 20+ runs, and returns the median of measured ÷ estimate × the current η.

## Ingestion jobs

Eight jobs keep the data fresh: six light ones run as Vercel cron routes once a day, and two heavy ones run in GitHub Actions. Every job writes an `ingest_log` row, uses `insertIfChanged`, and exits cleanly on error so one broken source never stops the rest.

| Job | Runs in | Schedule (UTC) | Reads | Writes |
| --- | --- | --- | --- | --- |
| `openrouter` | Vercel cron `/api/cron/openrouter` | daily 17:00 | `GET https://openrouter.ai/api/v1/models?output_modalities=all`, then `/api/v1/models/{author}/{slug}/endpoints` for tracked models (10 in parallel) | models (create), aliases, api\_offers, modalities, context, `reasoning` from `supported_parameters`, `hf_repo` from `hugging_face_id` |
| `aa` | Vercel cron `/api/cron/aa` | daily 18:00 | `GET https://artificialanalysis.ai/api/v2/language/models/free` with header `x-api-key` (1 call) | scores (aa), api\_offers (provider = 'AA median'), task\_profile when token or cost fields exist |
| `arena` | Vercel cron | daily 19:00 | Arena's published leaderboard data | scores (arena, elo) |
| `livebench` | Vercel cron | daily 20:00 | LiveBench published results | scores (livebench, pct) |
| `epoch` | Vercel cron | daily 21:00 | Epoch AI published dataset | scores (epoch, index) |
| `calibrate` | Vercel cron | daily 22:00 | `v_models`, runs + estimates | calibrations, eta\_calibrations |
| `hf-sync` | GitHub Actions `hf-sync.yml` | daily 16:00 | Hugging Face Hub API | files, models params + KV, downloads |
| `dbgpu-import` | GitHub Actions `dbgpu.yml` | Sundays 15:00 | `pip install dbgpu` | devices (source = dbgpu; never overwrites curated) |

Arena, LiveBench and Epoch are best-effort: W4 finds each source's official published data file, checks its terms, stores the URL in `lib/ingest/sources.ts`, and if access isn't allowed or fails, the job logs "skipped" and the app works on the other sources.

**Shared helpers (`lib/ingest/`)**

- `normalizeName(s)`: lowercase; strip creator prefix (`anthropic/`, `openai:`); drop date stamps (`-2026-05-14`, `-0514`), `-instruct`, `-chat`, `(preview)`, `latest`; collapse spaces and dashes. Keep effort tags like `(max)` and turn them into a `-max` suffix.
- `matchModel(source, externalId, name, creator)`: alias hit → return; else exact normalized match → insert alias `exact`, confirmed; else trigram similarity ≥ 0.92 within the same creator → alias `fuzzy`, unconfirmed (used, but listed in `/admin/match`); else create the model when the source is OpenRouter or AA (alias `new`), otherwise store the alias with `model_id = null` for review.
- `insertIfChanged(table, key, row, tolerance)`: read newest row for the key; insert only when a value differs by more than the tolerance (scores 0.1, prices 0.001, speeds 1%).
- `logRun(source, fn)`: wraps a job with `ingest_log` start and finish.
- Cron auth: every `/api/cron/*` route returns 401 unless `Authorization: Bearer ${CRON_SECRET}`.

**Artificial Analysis mapping.** The free list endpoint returns headline indices, median performance and input/output prices. Map `artificial_analysis_intelligence_index` → metric `intelligence`. For domain metrics, read the first real response, list which evaluation fields are present, and fill `metric_sources` with the fields per metric (a domain score is the mean of its listed fields that are present). Note the API docs say the AA coding and agentic indices are no longer published, so those come from individual evaluations. Log any unexpected shape instead of crashing.

**Hugging Face sync (`scripts/hf-sync.ts`)**, for each model with `hf_repo`:

1. `GET https://huggingface.co/api/models/{repo}?expand[]=safetensors` → total parameters; `GET https://huggingface.co/{repo}/resolve/main/config.json` → layers, KV heads, head dim, MoE experts → `active_params_b`, `kv_bytes_per_token` (2 × layers × kv\_heads × head\_dim × 2 bytes; MLA models: `kv_lora_rank + qk_rope_head_dim` per layer × 2 bytes).
2. Official file: one `files` row, format from dtype (bf16 / fp8), kind `official`.
3. Derivatives: `GET https://huggingface.co/api/models?filter=base_model:quantized:{repo}&sort=downloads&limit=100` and `…base_model:finetune:{repo}&limit=30`. Keep the top 8 uploaders by downloads.
4. For each derivative: `GET https://huggingface.co/api/models/{repo}/tree/main?recursive=true`; group `.gguf` files by quant name parsed from the file name (`UD-Q4_K_XL`, `IQ3_M`, `Q8_0`, `TQ1_0`, `BF16`…), summing split parts (`-00001-of-00003`). MLX, AWQ, GPTQ repos become one row each. `bits_per_weight = size_bytes × 8 ÷ total_params`.
5. Kind: names or tags containing `abliterated` or `uncensored` → `abliterated`; other fine-tunes → `finetune`.
6. Throttle to 5 requests/second with the token; stop at 9 minutes and resume next day from a cursor stored in `ingest_log.error` as JSON.

**KLD data.** `data/kld/*.csv` (repo, quant, kld, eval\_set, source, source\_ref) is curated by hand from uploader model cards and published comparisons; `scripts/import-kld.ts` upserts it into `file_quality`. `scripts/measure-kld.sh` is the manual DGX Spark recipe: download BF16 + quant, run llama.cpp's perplexity tool in KL-divergence mode on `data/kld/eval-set.txt`, append a CSV row.

## API routes

Five route groups; pages read data through Server Components and `lib/data`, not through these routes. Every route validates input with Zod and returns `{ error: string }` with a 4xx status on bad input.

| Route | Method | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/cron/[source]` | GET | `Bearer CRON_SECRET` | `source` ∈ openrouter, aa, arena, livebench, epoch, calibrate | `{ ok, inserted, unchanged, skipped?, error? }` |
| `/api/ask-hardware` | POST | none; 10 req/min per IP (in-memory map) | `{ messages: {role, content}[] (≤ 12, each ≤ 2,000 chars), currentSpec: HardwareSpec \| null }` | `{ reply: string, spec: HardwareSpec, picks: SetupPick[] }` |
| `/api/runs` | POST | none; 20 runs/day per fingerprint | Probe profile JSON (see atlas-probe CLI) | `{ accepted: number, rejected: { file, reason }[] }` |
| `/api/setups` | POST / GET `?id=` | none | `{ spec }` / id | `{ id }` / `{ spec }` (short share links) |
| `/admin/match` (page) + server actions | — | `ADMIN_PASSWORD` cookie | confirm / remap / create | revalidates the page |

**`/api/ask-hardware` flow**

1. Pick candidate devices: trigram search of `devices.name` and `aliases` for each word group in the last user message; take the top 50.
2. Call the AI with `temperature: 0` and a JSON-only instruction. System prompt (store in `lib/ai-prompts.ts`):

```text
You turn a person's description of their computer(s) into specs for an LLM hardware-fit calculator.
Return JSON only: {"reply": string, "spec": HardwareSpec, "picks": [{"deviceId": string, "qty": number}]}.
reply: 2-3 plain sentences: what you understood, what you assumed, and one question only if something important is missing.
picks: catalog devices you are confident the person owns, using ids from the list below; [] if none.
spec fields: arch ("discrete" PC with graphics cards | "unified" shared-memory system like Mac or DGX Spark | "cpu"),
gpus, vramGb (per GPU, 0 for unified), gpuBwGbs (slowest device), link ("none"|"pcie"|"nvlink"|"network"),
ramGb (unified: total across devices), ramBwGbs (DDR5 dual channel ~90, DDR4 ~50; unified = gpuBwGbs),
fp16Tflops (total), fp8, backend ("cuda"|"rocm"|"metal"|"vulkan"|"cpu"), diskFreeGb (default 1000), diskReadGbs (NVMe 5, SATA SSD 0.5, HDD 0.15).
Fill unknowns with typical values and say which you assumed.
Catalog devices: {{DEVICE_LINES}}
Current spec: {{CURRENT_SPEC}}
```

3. Parse; on invalid JSON retry once with "Return valid JSON only". Validate with Zod, clamp numbers (VRAM 1–512 GB, bandwidth 10–10,000 GB/s, RAM 1–4,096 GB, disk speed 0.05–20 GB/s).
4. If `picks` is non-empty, rebuild the spec with `specFromPicks` from catalog rows, keeping the AI's RAM and disk values as the host PC. Return reply + spec + picks.

**`/api/runs` checks** (in order; a failing run is stored with `rejected_reason`, never dropped silently):

1. Zod shape; `probe_version` ≥ 1.0.0.
2. Resolve `device` to a `devices.id` (exact id, then alias, then trigram ≥ 0.8); unknown → insert device with `source = 'probe'`, unverified.
3. Resolve `file` (`repo:quant`) to `files.id`; unknown → store `file_id = null` (kept for later matching).
4. Reject `gen_tps` > 1.3 × `physicalCeilingTps` for that device's bandwidth; reject a run outside 3× IQR of its group once the group has 5+ runs.
5. `fingerprint` = SHA-256 of client fingerprint + `RUNS_SALT`; enforce 20/day.

## Pages and UI

Every screen copies the prototype (`design/prototype.html`): same layout, copy, colours, type and motion; open it in a browser beside your work. Below is what the prototype can't show: data wiring, states and the exact tokens.

**Design tokens (`app/globals.css`, owned by W2)**

```css
:root { color-scheme: light dark;
  --bg: light-dark(#eef2f6, #0a101b);   --card: light-dark(#ffffff, #111a28); --soft: light-dark(#f5f7fa, #0e1624);
  --ink: light-dark(#0f1726, #eef2f8);  --mute: light-dark(#566275, #9fadc0); --line: light-dark(#e1e6ee, #223047);
  --acc: #F47321; --butter: #FFEEB3; --mint: #B4D7CD; --steel: #8EA8C3; --night: #0b1220; --onacc: #0f1726;
  --warn: light-dark(#b2470a, #ffa36b); --fade: light-dark(#8EA8C3, #1a2b48); }
```

Type: Inter 400–800 for UI; Instrument Serif italic for big numbers, step numbers and section names (`.serif`). Radius: cards 22 px, inner panels 16 px, pills full. Buttons: uppercase 12 px, tracking 0.06em, round ↗ icon at the right that nudges up-right on hover. Scrollbars: thin steel thumb, orange on hover; hidden on the nav and metric tabs with faded edges.

**Motion (Motion library, all off under `prefers-reduced-motion`)**

| Element | Motion |
| --- | --- |
| Hero stars | 90 dots from a seeded random, a third twinkle (3.2 s ease) |
| Reticle logo | On hover the tick ring rotates 30° and the orange star scales 1.25 (spring) |
| Nav | Active item gets an orange dot that pops in |
| Page change | Content fades up 10 px over 0.4 s |
| Explorer bars | Grow from 0 with 40 ms stagger |
| Priority slider | Fill width springs; the number badge pops on change |
| Wizard steps | Slide in from the right 26 px |
| Drawer | Slides in from the right; backdrop fades |
| Numbers in stat tiles | Pop when the value changes |

**Shell (W2).** Dark starry hero band fading into steel, then the page background. Header inside the hero: Reticle logo + "ATLAS" wordmark (light weight, wide tracking), centred uppercase nav (Explorer, Recommender, Hardware, Quants, Device test), "Ask AI ↗" pill that opens Hardware in Ask AI mode. Hero title per page (copy in the prototype); on Explorer also the four crystal-icon links. Content cards overlap the hero by 112–128 px. Dark footer with four columns, including each source's last sync from `v_source_status`. Favicon = Reticle on a navy rounded square.

**Explorer (`/`, W6).** Loads `v_models` + calibrations, runs `scoreModels` on load.

- Four stat tiles: models tracked, open-weight files, measured speed runs, benchmark sources averaged.
- Card 1: title "{leader} leads on {metric}"; 10 metric tabs (Intelligence, Coding, Agentic, Cybersecurity, Math, Long context, Cost per task, Time per task, Output speed, Price per 1M); filters: search, weights, reasoning, minimum context, Providers dropdown (search, All / None / Default, checkboxes with model counts, 12 selected by default = `creators.default_selected`), input chips. Horizontal bar chart: leader orange, open models mint, closed steel; "Higher / Lower is better".
- Card 2: table; on Intelligence the columns are each source's raw value + Average; flags shown as small tags (one source, sources disagree, stale).
- Empty state: "No models match these filters" + Reset filters button.

**Model drawer (W6).** Three stat tiles; per-source table (raw, calibrated, synced) with Average and spread; details grid; provider select that re-computes cost/time; monthly cost input (tasks per day); for open models the file list (official + one per uploader nearest 4.8 bits) with fit tags against the saved hardware, KLD tag, measured or estimated speed, and "Compare N quants" pill to `/quants?model=`.

**Recommender (`/recommend`, W6).** Five steps with segmented progress (clickable). Step 1: three cards (Intelligence orange, Speed mint, Cost steel) with 1–10 pill sliders (drag, click, arrows, Home/End), importance label, and a stacked weight bar with percentages. Steps 2–4: option tiles; Step 4 includes the Providers dropdown. Step 5: results table (Rank, Model, Match %, focus score, Cost / task, Time / task, Speed, Context, Weights), top row butter. Footer: Back, Next / See matches, live "N of M models match so far". Answers persist in the URL.

**Hardware (`/hardware`, W7).** Left card with three tabs.

- Pick devices: search over all devices (verified first, then database), category chips, list with Add / − n +; when any GPU card is picked, a "PC the GPU sits in" block (RAM, RAM bandwidth, disk, disk speed); "Fine-tune these specs by hand" link.
- Enter specs: two-column form grouped Memory / Speed / Compute & software / Storage; long selects full width; each field has an ⓘ that reveals a one-line explanation (copy in the prototype); fields hide when not relevant.
- Ask AI: chat with three example prompts, typing dots, error bubble, and the result line under the last reply.

Right card: title "{n} of {m} open models run here, {k} at full speed"; four tiles (fast memory, spill-over RAM, bandwidth, measured rows); context slider 4–256K; table (Model, Best file + "compare quants", Runs tag + runtime, Memory, Speed measured or range, Prompt read, Load). Setup persists in the URL and `localStorage`; "Share setup" saves to `/api/setups`.

**Quants (`/quants?model=`, W7).** Model chips (models with 4+ rated quants), memory budget slider + "Use my hardware (N GB)", headline "Best under N GB: {uploader} {quant}" + uploader-gap sentence, scatter (x size GB, y KLD log scale, shape + colour per uploader, dashed best trade-off line, orange budget line with shaded over-budget area, ring on best), legend, table (Uploader, Quant + "best trade-off" tag, Bits, Size, KLD, Quality tag, On your hardware).

**Device test (`/probe`, W8).** Three step cards: share toggle with run count, the command (`npx atlas-probe --bench --share` or without `--share`) with Copy, paste box + "See what runs" which validates and sends the user to Hardware → Enter specs with the measured values filled in.

**Admin match (`/admin/match`, W4).** Password prompt; table of unconfirmed or unmatched aliases (source, external name, suggested model, score) with Confirm, Remap (searchable model select) and Create new model.

## atlas-probe CLI

`cli/` is a standalone Node 18+ TypeScript package published to npm as `atlas-probe`, so `npx atlas-probe` works anywhere with no install. It detects hardware, optionally benchmarks with the user's own llama.cpp, prints a profile, and optionally shares runs. It never uploads files, paths, hostnames or usernames.

**Commands**

| Command | Does |
| --- | --- |
| `npx atlas-probe` | Detect hardware only; print summary + profile JSON |
| `npx atlas-probe --bench` | Also download 2 small reference GGUFs once (cached in `~/.cache/atlas-probe`) and run `llama-bench` on each |
| `--model <repo>:<quant>` | Also benchmark that file (downloads it if not cached; asks before downloads over 5 GB) |
| `--share` | POST the profile to `${ATLAS_URL:-https://<your app>}/api/runs` |
| `--json` | Print only the JSON (for piping) |

**Detection** (`cli/src/detect/*.ts`, one file per OS)

- NVIDIA: `nvidia-smi --query-gpu=name,memory.total,pci.link.gen.current --format=csv,noheader`. AMD: `rocm-smi --showproductname --showmeminfo vram --json`.
- Mac: `sysctl -n hw.memsize machdep.cpu.brand_string`, `system_profiler SPDisplaysDataType -json` for the chip; arch = unified, backend = metal.
- Linux unified boxes (DGX Spark GB10, Ryzen AI Max, Jetson): GPU name match → arch = unified, memory from `/proc/meminfo`.
- RAM from `os.totalmem()`; free disk via `fs.statfs` on the cache folder; disk read speed = cached reference file size ÷ read time (approximate).
- No GPU found → arch = cpu.

**Benchmark.** Requires `llama-bench` on PATH; if missing, print the install hint (`brew install llama.cpp` on Mac, release download link elsewhere) and produce a detect-only profile. Per file: `llama-bench -m <file> -p 512 -n 128 -r 3 -o json` → prompt tok/s and generation tok/s. Effective bandwidth = generation tok/s × (active params × bits ÷ 8) using the reference model's known numbers (hard-coded in `cli/src/reference.ts`); effective FP16 TFLOPS = prompt tok/s × 2 × active params ÷ 0.3 ÷ 10^12.

**Profile JSON** (exact field names; the web page and `/api/runs` both parse this):

```json
{
  "probe_version": "1.0.0",
  "device_name_raw": "NVIDIA GB10",
  "arch": "unified", "devices": 1,
  "vram_gb": 0, "memory_gb": 128,
  "measured_bw_gbs": 251, "ram_bw_gbs": 251, "fp16_tflops": 118, "fp8": true,
  "backend": "cuda", "disk_free_gb": 2800, "disk_read_gbs": 6.1,
  "fingerprint": "<random uuid stored in ~/.config/atlas-probe/id>",
  "runs": [ { "file": "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL", "runtime": "llama.cpp", "runtime_version": "b6123", "ctx": 4096, "gen_tps": 9.6, "prompt_tps": 640, "load_s": 3.1 } ]
}
```

The web Device test page maps `device_name_raw` to a catalog device client-side (same alias + fuzzy rule as `/api/runs`) and fills the Enter specs form from the other fields.

## Agent plan

One Lead agent (W1) builds the skeleton and frozen contracts, then runs seven agents in parallel, one per workstream, and finishes with an integration pass. No two agents own the same file, so they never wait on or overwrite each other.

```text
Wave 0            Wave 1 (7 agents in parallel)                         Wave 2
W1 Lead   ──►   W2 Design system + shell  (primitives first)      ──►   W1 + any agent:
scaffold,       W3 Database + seed  (migration, views, seed, dbgpu)     wire real data,
contracts,      W4 Ingestion + admin  (cron, HF sync, matching)         first sync,
sample data,    W5 Engine  (lib/engine from reference code)             visual check,
clients, env    W6 Explorer, drawer, recommender  (uses W2 + W5)        deploy
                W7 Hardware, quants, Ask AI  (uses W2 + W5)
                W8 Probe CLI + device test  (cli/, /probe, /api/runs)
```

W6 and W7 start at once alongside W2 and W5: they import primitives and engine functions by the names fixed in this spec and use `lib/sample-data.ts` until the real loaders land. W2 ships `components/ui` before the shell; W5 ships `lib/engine` first because it is mostly pasted from the Engine section.

| Agent | Owns | Starts after | Hands over |
| --- | --- | --- | --- |
| W1 Lead | `lib/contracts.ts`, `lib/sample-data.ts`, `lib/supabase/*`, `lib/data/*`, `.env.example`, `package.json`, configs, `NOTES.md` structure | — | Running empty app, contracts, sample data typed as contracts |
| W2 Design system | `app/layout.tsx`, `app/globals.css`, `components/ui/*`, `components/shell/*`, favicon | W1 | Card, Pill, Chip, Tag, Where tag, Speed cell, ProviderSelect, Icons, Gem, Reticle, Stars, Header, Hero, Footer |
| W3 Database | `supabase/*`, `scripts/import-dbgpu.ts`, `.github/workflows/dbgpu.yml`, `data/devices-curated.json` | W1 | Applied migration, seed, \~200 curated devices, dbgpu import |
| W4 Ingestion | `lib/ingest/*`, `app/api/cron/*`, `vercel.json`, `scripts/hf-sync.ts`, `scripts/import-kld.ts`, `scripts/measure-kld.sh`, `data/kld/*`, `.github/workflows/hf-sync.yml`, `app/admin/*` | W1 (+ W3 schema) | Real data in all tables, admin page |
| W5 Engine | `lib/engine/*` | W1 | All functions in Shared contracts |
| W6 Explorer | `app/page.tsx`, `app/recommend/*`, `components/explorer/*`, `components/recommender/*`, `components/detail/*` | W1 | Explorer, drawer, recommender |
| W7 Hardware | `app/hardware/*`, `app/quants/*`, `app/api/ask-hardware/*`, `app/api/setups/*`, `lib/ai.ts`, `lib/ai-prompts.ts`, `components/hardware/*`, `components/quants/*` | W1 | Hardware planner, quants view, Ask AI |
| W8 Probe | `cli/*`, `app/probe/*`, `app/api/runs/*`, `components/probe/*` | W1 | npm-ready CLI, device test page, runs API |

**Kick-off prompt for Claude Code** (paste into the Lead session with this spec saved as `SPEC.md` and the prototype as `design/prototype.html`):

```text
You are W1, the Lead agent for Atlas. Read SPEC.md fully and open design/prototype.html.
Wave 0: do every W1 task in the Agent plan, then commit.
Wave 1: start seven sub-agents, W2 to W8, in parallel. Give each one: its row of the ownership table,
the SPEC.md sections it needs, and the rules in "Read me first" (own your files only, no tests,
free tiers only, log decisions in NOTES.md). When an agent finishes, review its files against the spec;
if it needs more work, start a fresh agent for the remainder.
Wave 2: wire lib/data loaders to the real views, run the first sync, compare every page with the
prototype at 400 px, 720 px and desktop, fix differences, then deploy to Vercel.
Never write tests. Keep at most 8 agents running at once.
```

## Definition of done

Atlas v1 is done when the deployed app on Vercel shows real data on all five screens, matches the prototype side by side, and the scheduled jobs have run once without errors. Checks are manual: open the page and look.

**Each workstream is done when**

- `pnpm build` passes with no type errors and no ESLint errors in its files.
- Its screens or jobs work against the seeded database and, after the first sync, against real data.
- It has added any decisions it made to `NOTES.md`.

**Launch checklist**

- [ ] Migration and seed applied to the Supabase project; views return rows with the publishable key.
- [ ] All env vars set in Vercel; GitHub Actions secrets set.
- [ ] Each cron route called once by hand returns `ok: true`; `hf-sync` and `dbgpu-import` workflows ran once.
- [ ] Explorer: 10 tabs switch, Providers dropdown filters, drawer shows per-source values with sync times.
- [ ] Recommender: all 5 steps work by mouse and keyboard; results change when sliders change.
- [ ] Hardware: a 1× DGX Spark setup lists open models with fit tags; Enter specs and Ask AI produce results; Share setup link reopens the same setup.
- [ ] Quants: one model shows 15+ quants from 3+ uploaders; budget slider moves the ring.
- [ ] `npx atlas-probe --bench --share` on your DGX Spark succeeds; after 3 runs the planner shows "measured".
- [ ] `/admin/match` lists and confirms an unmatched alias.
- [ ] Light and dark themes both readable; no horizontal scroll at 400 px; reduced motion turns animations off.
- [ ] Footer credits Artificial Analysis and OpenRouter data sources.
