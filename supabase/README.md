# supabase/

| File | What it is |
| --- | --- |
| `migrations/0001_init.sql` | Schema, views, RLS: the SPEC "Database" SQL, verbatim. |
| `migrations/0002_security.sql` | Privileges: anon/authenticated may only SELECT the six catalog tables and the six views. Also closes a write path through the auto-updatable `v_files` view, and makes `authenticated` behave like anon. Re-runnable. |
| `seed.sql` | Generated sample data: 48 creators, 10 models, scores, offers, task profiles, 47 files plus KLDs, 219 curated devices, 127 runs, metric_sources, calibrations. Idempotent. |
| `generate-seed.ts` | Regenerates `seed.sql` from `lib/sample-data.ts` and `data/devices-curated.json`. |

## Apply (fresh project)

Apply in this order, once each. Re-running 0002 or the seed later is safe.

1. `migrations/0001_init.sql`
2. `migrations/0002_security.sql`
3. `seed.sql`

**SQL editor.** Paste each file into Supabase → SQL Editor → Run, in the order above.

**psql.** Use the connection string from Settings → Database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_security.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

**Check** (anon reads work, writes are refused):

```sh
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/v_run_stats?select=*&limit=1" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"   # 1 row
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/v_files" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" -d '{}'                                                                     # 42501 permission denied
```

## Regenerate the seed

```sh
pnpm exec tsx supabase/generate-seed.ts   # from the repo root; prints row counts per table
```

The script throws in these cases:
- the first 20 rows of `data/devices-curated.json` drift from `SAMPLE_DEVICES`;
- a device id or category is invalid;
- the generated runs would not reproduce the sample p25/p50/p75.

## Notes

- **Seed markers.** Seed rows are marked as follows, so they can be found or deleted later:
  - `scores.source_ref` and `file_quality.source_ref` = `'seed'`
  - `runs.fingerprint` = `'seed'`
- **Real data wins.** Ingested rows have newer `fetched_at`, so the `v_latest_*` views prefer them. Re-running the seed only fills in keys that have no rows yet.
- **Curated devices.** Every run of the seed upserts the curated devices back to `source = 'curated'`, `verified = true`. `scripts/import-dbgpu.ts` never overwrites them.
- **No `ingest_log` rows.** The footer shows "not synced yet" until a real job runs.
- **New tables.** After 0002, new tables created by `postgres` give anon nothing by default. Every new table needs `enable row level security`, plus explicit grants or policies for anything anon should read.
