-- 0002_security.sql — tighten what the publishable key (anon) and `authenticated` may do. Owned by W3.
-- 0001 is applied verbatim; this file only changes privileges and policies (no table or view shapes). Safe to re-run.
--
-- Why: Supabase's default privileges give anon/authenticated ALL on every new relation in public. RLS blocks
-- their writes on the tables, but the six read views run with their owner's rights (postgres, BYPASSRLS), and
-- v_files is a single-table view that Postgres treats as auto-updatable, so anon could insert/update/delete
-- `files` through it. Fix: anon and authenticated get SELECT only, on exactly what lib/data reads; writes stay
-- with service_role (the secret key), which bypasses RLS.
-- Views keep owner rights on purpose (no security_invoker): anon has no policy on scores/files/runs/ingest_log,
-- so invoker views would return nothing and the loaders would silently fall back to sample data.

-- 1. strip everything from the public-facing roles, then grant back read access only
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- catalog tables read directly by the loaders (RLS policies below allow every row)
grant select on creators, models, devices, calibrations, metric_sources, eta_calibrations to anon, authenticated;
-- the six read views (owner rights; they expose aggregates of the RLS-protected tables)
grant select on v_latest_scores, v_latest_offers, v_models, v_files, v_run_stats, v_source_status to anon, authenticated;

-- 2. `authenticated` (a signed-in JWT, unused today) behaves exactly like anon: 0001's policies name anon only
alter policy read_all on creators         to anon, authenticated;
alter policy read_all on models           to anon, authenticated;
alter policy read_all on devices          to anon, authenticated;
alter policy read_all on calibrations     to anon, authenticated;
alter policy read_all on metric_sources   to anon, authenticated;
alter policy read_all on eta_calibrations to anon, authenticated;

-- 3. the writer role: explicit rather than relying on Supabase defaults
grant all on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

-- 4. future tables created by postgres in later migrations: no automatic anon/authenticated access
--    (each new table must also `enable row level security`; grant what anon needs explicitly).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to service_role;
