-- 0003_vendor_benchmarks.sql — speeds published by NVIDIA / OEM vendors (W1, after launch).
-- Kept apart from `runs` on purpose: vendor numbers come from tuned vendor setups and are shown with their
-- own label; they never count as "measured" and never feed eta calibration.
create table if not exists vendor_benchmarks (
  id bigserial primary key,
  device_id text not null references devices(id) on delete cascade,
  devices int not null default 1,                 -- e.g. 2 = two linked DGX Sparks
  model_id text references models(id) on delete set null,   -- null until the model is in Atlas
  model_name text not null,                       -- as the vendor wrote it
  precision text not null,                        -- NVFP4 | MXFP4 | FP8 | BF16 ...
  runtime text not null,                          -- llama.cpp | TRT-LLM | vLLM | SGLang ...
  batch int not null default 1,
  isl int, osl int,                               -- input / output tokens per request
  prompt_tps numeric, gen_tps numeric,            -- tokens per second
  source text not null check (source in ('nvidia','oem')),
  source_name text not null,                      -- e.g. 'NVIDIA Technical Blog'
  source_url text not null,
  published_on date,
  note text,
  unique (device_id, devices, model_name, precision, runtime, batch, source)
);
create index if not exists vendor_benchmarks_model on vendor_benchmarks (model_id);

alter table vendor_benchmarks enable row level security;
drop policy if exists read_all on vendor_benchmarks;
create policy read_all on vendor_benchmarks for select to anon, authenticated using (true);
grant select on vendor_benchmarks to anon, authenticated;
grant all on vendor_benchmarks to service_role;
grant usage, select on sequence vendor_benchmarks_id_seq to service_role;
