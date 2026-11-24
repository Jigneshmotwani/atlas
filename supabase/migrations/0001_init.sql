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
