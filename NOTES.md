# Atlas — build notes

Structure owned by W1 (Lead). Every agent **appends** one-line decisions under "Decision log",
prefixed with its id, e.g. `- W6: Explorer metric tab is kept in ?metric= so links reopen the same tab.`
Never rewrite other lines.

## Lead contracts (Wave 0) — binding for every workstream

These fill the seams SPEC.md leaves open. Code against them exactly; ask the Lead to change one.

### Stack facts
- Next.js **16.4.6** (App Router), React 19.3, Tailwind CSS v4 (via `@tailwindcss/turbopack`), TypeScript 5.9 strict, pnpm.
  This Next version has breaking changes from older ones: read `node_modules/next/dist/docs/` before writing routes
  (`params` / `searchParams` are Promises in pages and route handlers; check the docs for anything you are unsure of).
- `cacheComponents` is **off** (see Decision log). Pages are plain async Server Components; use `export const revalidate = 3600` on pages that read data.
- Installed: `@supabase/supabase-js`, `zod` (v4), `openai`, `@anthropic-ai/sdk`, `motion` (`motion/react`), `radix-ui` (unified package: `import { Dialog, Popover, Slider, Switch, Tabs } from 'radix-ui'`), `server-only`, `tsx`, `dotenv`.
- Path alias `@/*` → repo root. `cli/` is excluded from the root tsconfig and ESLint (own package).

### Data: `lib/data` (W1)
Server Components / route handlers only (`import 'server-only'`). Each loader returns contract types and falls back to
`lib/sample-data.ts` when Supabase is unreachable, `ATLAS_SAMPLE=1`, or the view is empty. **Pages import loaders, never `lib/sample-data` directly.**

| Loader | Returns | Source |
| --- | --- | --- |
| `loadModels()` | `ModelRow[]` | `v_models` |
| `loadCreators()` | `Creator[]` = `{ id, name, defaultSelected }` | `creators` |
| `loadCalibrations()` | `Calibration[]` | `calibrations` |
| `loadFiles(modelId?)` | `FileRow[]` | `v_files` |
| `loadDevices()` | `Device[]` (verified first) | `devices` |
| `loadRunStats()` | `RunStat[]` | `v_run_stats` |
| `loadEta()` | `EtaCalibration[]` | `eta_calibrations` |
| `loadSourceStatus()` | `SourceStatus[]` | `v_source_status` |

Also `loadDeviceAliases()` → `{ id, aliases }[]` (aliases are not in the Device contract) and `toModelRow`, `toFileRow`, `toDevice` row mappers.
`loadSourceStatus()` returns `[]` when nothing has synced yet (UI shows "not synced yet").

### Trigram matching: `lib/trigram.ts` (W1)
`similarity(a, b)` (same result as Postgres `pg_trgm` `similarity`), `bestSimilarity(q, names)`, `rankBySimilarity(q, items, namesOf, { min, limit })`.
Use it for every "trigram ≥ x" rule in SPEC (model matching 0.92, device resolution 0.8, Ask AI candidate devices) instead of Postgres RPCs. Supabase clients: `supabaseServer()` (publishable key, reads),
`supabaseAdmin()` (secret key, writes; reads `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`), `hasSupabase()` in `lib/supabase/server.ts`;
`supabaseBrowser()` in `lib/supabase/browser.ts`. `lib/supabase/server.ts` has no `server-only` import so tsx scripts can use it; never import it from a client file.

### Formatters: `lib/format.ts` (W1)
`fmtUsd(n)` ($0.0042 / $0.123 / $12.30), `fmtTime(s)` (42s / 3m 05s), `fmtCtx(k)` (128K / 1M), `fmt1(n)`, `fmtAgo(iso)` ("3h ago"). All return `'–'` for null.

### Shared client state: `lib/state.ts` (W1)
- `SavedHardware` in localStorage key `atlas.hardware.v1`: `{ mode, picks, host, manual, ai, spec, label? }`. **The Hardware page (W7) writes it on every change** with `writeSavedHardware`; the drawer (W6) and Quants (W7) read the spec with `readSavedSpec()` (null = never set up).
- Defaults: `DEFAULT_PICKS` = 1× `spark`, `DEFAULT_HOST` = 64 GB / 90 GB/s / 2000 GB / 5 GB/s, `BLANK_SPEC` = prototype BLANK.
- Probe → Hardware handoff: `/probe` calls `writeProbeHandoff({ spec, label, deviceId })` then navigates to `/hardware?mode=manual&from=probe`; Hardware calls `takeProbeHandoff()` once (it clears) and shows "Specs from your device test: {label}".
- Providers selection (Explorer + Recommender) may persist with `readProviders()` / `writeProviders()` (key `atlas.providers.v1`); URL first.
- URL helpers: `encodePicks/decodePicks` (`spark:1,r4090:2`), `encodeHost/decodeHost` (`64,90,2000,5`).

### URLs
- `/` Explorer, `/recommend`, `/hardware`, `/quants`, `/probe`, `/admin/match`.
- `/hardware?mode=pick|manual|ai&picks=…&host=…&ctx=32`; share link `/hardware?setup=<id>` (from `POST /api/setups`). Header "Ask AI ↗" links to `/hardware?mode=ai`.
- `/quants?model=<modelId>` (drawer "Compare N quants" and Hardware "compare quants" link here).
- Each page owns its other query params (W6: explorer/recommender answers; W7: hardware fields).

### Ids (sample data = seed)
Model ids are slugs (`claude-opus-5-5`, `qwen3-8-27b`, …), creator ids are `slug(name)`, device ids are the prototype ids (`spark`, `r4090`, …),
file ids are 1..N in the order of `SAMPLE_FILES`. W3 generates `supabase/seed.sql` from `lib/sample-data.ts` so ids match exactly.
`kvBytesPerToken = prototype kv_kb × 1024`.

### Scoring decision (W5, W6)
Follow the spec engine, not the prototype's 50–100 rescale: every source is calibrated onto the **Artificial Analysis scale** (AA = identity,
others Theil–Sen, `minOverlap` 8 in the nightly job). The sample data ships pre-fitted `SAMPLE_CALIBRATIONS` (all four sources, fitted on the 10 sample models)
so the sample Explorer averages all four sources. Explorer footnote copy becomes:
"Average = each source mapped onto the Artificial Analysis scale, then averaged. Sources that haven't tested a model are skipped."
Drawer per-source columns: Source · Raw · Calibrated · Synced, then an Average row with spread. Domain metrics (coding, agentic, …) come from AA (`scores` rows with source `aa`).

### UI primitives: `@/components/ui` (W2) — barrel `components/ui/index.ts`
Props are fixed; look and behaviour copy the prototype component of the same name.

```ts
Card(props: React.HTMLAttributes<HTMLDivElement>)                          // rounded-[22px] bg-card border-line
Pill(props: { children; onClick?; href?: string; dark?; small?; acc?; disabled?; type?: 'button'|'submit'; className?; 'aria-label'?: string })
                                                                           // uppercase pill + round ↗; renders next/link when href
Chip(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean })
Tag(props: { children; tone?: 'butter' | 'mint' | 'acc' | 'warn' })
WhereTag(props: { where: Where })                                          // All in fast memory / Spills into RAM / CPU only / Won't run
SpeedCell(props: { fit: FitResult | null })                                // measured: "{p50} tok/s" + mint "measured · {nRuns} runs"; estimate: "{lo}–{hi} tok/s" + "estimate"; else "–"
ProviderSelect(props: { value: string[]; onChange(v: string[]): void; providers: { name: string; count: number }[]; defaults: string[] })
                                                                           // "Providers {value.length} of {providers.length}", search, All / None / Default, checkboxes with counts (count 0 hidden)
Select(props: React.SelectHTMLAttributes<HTMLSelectElement>)               // the prototype's pill-shaped native select (h-10 rounded-full …)
Switch(props: { checked: boolean; onChange(v: boolean): void; id?; 'aria-label'?; 'aria-labelledby'? })   // prototype h-8 w-14 toggle
Icon(props: { name: 'check'|'x'|'back'|'info'|'search'|'arrow'|'spark'|'chev'|'send'|'term'; on?: boolean; size?: number })
Gem(props: { kind: 'explorer'|'recommend'|'hardware'|'quants'|'probe'; size?: number })
Reticle(props: { size?: number }); Wordmark(props: { size?: number })
Head(props: { title: React.ReactNode; right?: React.ReactNode })           // section h2
Th(props: { children?; r?: boolean }); TableBox(props: { children })       // table header cell; rounded scroll box with <table>
PopNumber(props: { value: React.ReactNode; className?: string })          // serif number that pops when value changes
```

`app/globals.css` (W2) defines the SPEC tokens, Tailwind v4 colour utilities (`bg-bg bg-card bg-soft text-ink text-mute border-line bg-acc text-acc text-onacc bg-butter bg-mint bg-steel bg-night text-warn`),
`font-sans` (Inter) / `font-serif` (Instrument Serif), and every prototype utility class with the same name and keyframes:
`.num .serif .scroll .nobar .edge .hero .after .tw .fade .slide .pop .bar .trk .gem .lift .arr .ico/.on .pick .dot .spin .ticks .star .logo`, the scrollbar rules,
the 600 px table rule, and the `prefers-reduced-motion` overrides. Feature code may use those classes directly (that is how the prototype animates).
`data-theme="light|dark"` on `<html>` forces a theme; default follows the OS.

### Shell contract (W2)
`app/layout.tsx` renders, in order: the hero band (`.hero`, `<Stars/>`, header with Wordmark → `/`, centred nav with orange active dot, "Ask AI ↗" pill → `/hardware?mode=ai`,
then the page title/subtitle chosen from `usePathname()` with the prototype copy; on `/` also the four Gem links), then
`<div className="after"><main className="fade relative max-w-[1240px] mx-auto px-3 sm:px-6 -mt-28 sm:-mt-32 pb-16">{children}</main></div>` (re-keyed per path so content fades up),
then the footer (async Server Component reading `loadSourceStatus()`).
**Pages render only what sits inside the prototype's `<main>`** (their cards), nothing else.

### Model drawer (W6 owns, W7 uses)
`components/detail/ModelDrawer.tsx`, client component:
```ts
export function ModelDrawer(props: {
  model: ScoredModel; files: FileRow[]; calibrations: Calibration[]; runStats: RunStat[]; eta: EtaCalibration[];
  onClose(): void;
  spec?: HardwareSpec | null;   // omitted → readSavedSpec()
}): JSX.Element
```
It recomputes cost / time when the provider select changes (via `scoreModels([raw model], calibrations, { provider: { [id]: name } })`) and links "Compare N quants" to `/quants?model=`.

### Engine (W5)
`import { scoreModels, recommend, specFromPicks, fitModel, fitFile, fastMemoryGb, spillMemoryGb, quantView, physicalCeilingTps, fitCalibrations, fitEta, K, METRICS } from '@/lib/engine'`
— exactly the SPEC signatures, plus `K` (constants) and `METRICS: Metric[]` re-exported.

### Working rules in the shared checkout (Wave 1)
- Edit only the files your row owns; append to NOTES.md only.
- Do **not** run `pnpm add` / `pnpm install` at the root (report missing packages to the Lead). `cli/` is W8's own package and may have its own install.
- Do **not** run `pnpm build`, `next dev` or anything that writes `.next/` — seven agents share it. Check types with
  `pnpm exec tsc --noEmit -p .` and lint with `pnpm exec eslint <your paths>`; fix errors in your files only (others are mid-edit).
- No git commands. No tests of any kind. Free tiers only. Never print, log or commit secrets from `.env.local`; never commit fetched API responses.

## Decision log

- W1: Next 16.4.6 scaffold ships with `cacheComponents` + `partialPrefetching`; both turned off so agents can write ordinary async Server Components and `revalidate`.
- W1: Scores use the spec engine's AA-scale calibration, not the prototype's 50–100 rescale; Explorer footnote copy changed to match (see Scoring decision).
- W1: Sample offers per model = maker's own API (picked by default), "AA median", and for open models a "DeepInfra" offer at 0.8× price / 0.85× speed so the drawer's provider switch has something to switch.
- W1: Sample source sync ages: AA 3h, Arena 5h, LiveBench 24h, Epoch 40h (under the 48 h stale limit, so sample rows show no "stale" flag).
- W1: `lib/supabase/server.ts` is not `server-only` because tsx scripts reuse it; the loaders in `lib/data` are.
- W1: `AI_PROVIDER` and `NEXT_PUBLIC_SITE_URL` are absent from `.env.local`; code defaults them to `openai` and `http://localhost:3000`.
- W5: `lib/engine` = SPEC reference code tidied (typed, no `any`); `index.ts` also exports `median`, `val`, `theilSen`, `isMoe` besides the SPEC signatures + `K` + `METRICS`.
- W5: `median([])` is NaN; `theilSen` returns null when no pair has distinct x and `fitCalibrations` skips that source×metric (reference emitted NaN a/b).
- W5: `pickOffer` skips the maker-name match when `creatorName` is empty (reference `includes('')` matched every provider).
- W5: `recommend` returns [] for an empty pool; a cost/time of 0 (free) scores best on that axis and is kept out of the log range (reference `0 && log` read it as log $1 = mid-range); nulls score 0; total weight 0 guarded.
- W5: `specFromPicks` drops unknown device ids with a real type guard; discrete `single` = largest GPU (reference took the largest item, so 2×4090 + Spark made the Spark the "single device": wrong solo flag and bandwidth); unified branch uses unified devices only; CPU-only picks return `arch: 'cpu'` from the largest CPU device (fp16Tflops default `K.cpuTflops`); CPU devices next to GPUs/unified boxes are ignored (host PC covers RAM).
- W5: active params fall back to `totalParamsB` (dense model with null active) in `fitFile`, `physicalCeilingTps` and the KV fallback; MoE = both counts known and active < total (reference flagged every null-active model as MoE and sized it at 1B).
- W5: `fitFile` on `arch: 'cpu'` streams everything from RAM and prefills at `K.cpuTflops`; an η calibration with deviceType `cpu` replaces `K.ramEta` there (the GPU η multiplies a zero share on CPU).
- W5: KV GB = kvBytesPerToken × ctxK × 1000 / 2^30 kept; equals the prototype's kv_kb × ctxK × 1000 / 2^20 (ctxK counted as ×1000 tokens).
- W5: `fitModel` for a model with no files returns `all: []` and a sentinel `best` `{ fileId: 0, where: 'no', why: 'No downloadable files yet', … }`; callers should check `all.length` (file ids start at 1).
- W5: `quantView` uploaderGap pairs the lowest-loss file with the highest-loss file from a *different* uploader (reference could pair two files of one uploader).
- W5: `fitEta` input (W4 calibrate job): `estimate` = uncalibrated `fitFile(m, f, spec, ctxK, { runStats: [], eta: [] }).speed.mid` on the run's single-device spec, only runs fully in fast memory (or CPU-only); η = median(measured / estimate) × η₀ (`K.eta.single`, `K.ramEta` for cpu) × `K.moePenalty` if MoE × `K.metalPenalty` if MLX, because `fitFile` drops those penalties once a calibration exists (round trip checked: calibrated estimate = 0.80× when measured = 0.8× estimate); groups need 20+ runs (`K.minEtaRuns`); non-positive/non-finite runs dropped. Limitation: group key has no backend, so llama.cpp-on-Mac Metal penalty is not folded in.
- W5: on the sample data `fitCalibrations` fits only arena + livebench (epoch has 5 overlaps < minOverlap 8); `SAMPLE_CALIBRATIONS` still ships epoch.
- W6: Explorer URL `?m=coding|agentic|cyber|math|long_ctx|cost|time|speed|price` (omitted = intelligence) `&q=&w=open|closed&r=yes|no&ctx=128|256|1000&in=image,audio,video&p=<creator ids>`; defaults are left out so `/` stays clean.
- W6: Recommender URL `?s=<step 1-5>&pri=<intel.speed.cost>&ow=open|closed&r=yes|no&in=…&out=…&ctx=128|256|400|1000&f=<focus metric>&p=<creator ids>`; written with a debounced (250 ms) `window.history.replaceState` (no RSC refetch), same helper as the Explorer.
- W6: Providers `p=` holds creator ids; absent = localStorage (`readProviders`) then `creators.defaultSelected`; `p=` (empty) = None; `p` is derived from the effective selection (so a stored non-default pick lands in the link), the defaults drop it; every change also calls `writeProviders`.
- W6: Pages don't read `searchParams` (keeps `revalidate = 3600` static); the client reads `useSearchParams` under `<Suspense>` whose fallback is the same screen with default answers (`query={null}`, never writes the URL), so the prerendered HTML is the default view.
- W6: localStorage (providers, saved hardware) is read with `useSyncExternalStore` (server snapshot null) to avoid hydration mismatches; the drawer then calls `readSavedSpec()`.
- W6: Explorer models without a value for the chosen metric get no bar and sort last in the table ("–"); title becomes "No {metric} data for these models" when none has one. Bar width = value / max of the shown values (prototype divided by max(…, 1), which made cost bars tiny).
- W6: Flag tags: "one source" neutral, "sources disagree" and "stale" warn; Intelligence table columns = sources that have an intelligence calibration in the data.
- W6: Drawer provider switch lists distinct priced offers; re-scores only when the pick differs from the default offer (single-model `scoreModels` would lose the population task median for models without a task profile). Tasks per day defaults to 50.
- W6: Drawer per-source notes: absent score = "{source}: not tested, left out of the average"; score present but no calibration = "{source}: not calibrated yet, left out of the average". File list = official files + one file nearest 4.8 bits per derivative repo (finetune/abliterated/merge) + one quant per uploader nearest 4.8 bits; KLD = first non-null `quality[].kld`, official = reference; `Won't run` files also show `why`.
- W6: Recommender "Start over" returns to step 1 keeping answers (prototype behaviour).
- W5: with an η calibration, `fitFile` uses cal.eta × (link η / K.eta.single) on non-solo multi-device setups (reference let a single-device calibration erase the pcie/nvlink/network penalty: 2×4090 split jumped 1.33×).
- W2: globals.css puts the prototype's element rules in `@layer base` and its named classes (.fade .serif .pop …) in `@layer components`, so Tailwind utilities still override them (unlayered CSS would beat every v4 utility). v3-preflight compat added: default border colour `var(--line)`, `cursor: pointer` on buttons.
- W2: `dark:` variant follows `data-theme` when set, else the OS. Theme choice lives in localStorage `atlas.theme.v1` (`light`|`dark`, absent = System); toggle sits in the footer's first column; inline head script applies it before paint.
- W2: Reticle hover and nav dot use the prototype CSS (`.logo:hover .ticks/.star`, `.pop`), not Motion. `components/shell/MotionProvider` wraps the app in `MotionConfig reducedMotion="user"`, and a global reduced-motion rule stops every CSS animation/transition.
- W2: Inter loads only 400–800 like the prototype, so the Wordmark's `font-light` renders at 400 as in the reference.
- W2: Pill/Chip/Switch/ProviderSelect buttons default to `type="button"`; Pill with `href` + `disabled` renders a disabled button; Pill `onClick` gets `MouseEvent<HTMLElement>`. Barrel also exports prop types, `WHERE_LABEL`, `IconName`, `GemKind`, `TagTone`.
- W2: PopNumber re-keys (re-pops) on string/number values; a ReactNode value does not re-pop.
- W2: Hero copy: `/admin/*` → "Match model names"; unknown paths (404) → "Page not found" / "This page is off the map. Pick a section above."
- W2: Footer Data rows read "{source} · 3h ago", "failed 3h ago" when the latest `v_source_status` row is not ok, "not synced yet" when absent. Root layout exports `revalidate = 3600` so those ages refresh hourly.
- W2: `<main>` is re-keyed on the pathname only (not search params), so query-string state changes don't remount pages. Shell parts are imported from `components/shell/*` directly (no barrel: Footer is server-only).
- W6: Explorer Average column (Intelligence tab) uses toFixed(1); other score cells use `fmt1`.
- W6: Outside URL changes (header link to bare `/`, back/forward) remount the Explorer / Recommender from the URL: `useUrlEpoch` compares the current query with the last one this tab wrote and bumps the screen `key` when they differ (open drawer and step animation reset).
- W1: The DATABASE_URL direct host (db.<ref>.supabase.co) is IPv6-only and unreachable from this network; migrations are applied through the IPv4 session pooler aws-1-ap-southeast-1.pooler.supabase.com:5432 (user postgres.<ref>). 0001 applied 2026-11-24 (15 tables, 6 views).
- W1: Explorer/Recommender get only a file count (loadFileCount); the drawer fetches one model's files from the Lead-owned GET /api/files?model= on open.
- W6: Explorer / Recommender pages pass `fileCount` (`loadFileCount()`) instead of all files; the drawer fetches `/api/files?model=` on open when its `files` prop has none for that model ("Loading files…", then a retry hint on error). W7 can keep passing `files`.
- W7: Hardware URL = `?mode=pick|manual|ai&picks=spark:1&host=64,90,2000,5&ctx=32` plus `spec=` (Enter specs, only in manual mode) and `ai=` (last AI spec), both as 12 comma fields `arch,gpus,vram,gbw,link,ram,rbw,tf,fp8(0/1),backend,disk,dspd` (components/hardware/spec.ts `encodeSpec/decodeSpec`); `setup=` / `from=probe` are consumed then dropped. URL wins over probe handoff, then SavedHardware, then defaults.
- W7: Hardware and Quants pages never read server `searchParams` (they would go dynamic and lose `revalidate`); the client reads `useSearchParams` under `<Suspense>` and writes back with debounced `history.replaceState`.
- W7: Any hand edit in Enter specs drops `deviceId` and `single`, because the spec is no longer exactly one catalog device (so measured rows no longer apply).
- W7: "compare quants" shows only for models the Quants page can compare (4+ rated quants in one eval set), not the prototype's "more than 3 files", so the link never lands on a different model.
- W7: Quants footnote names at most 8 models without enough quants, then "and N more", since real data has many open models.
- W7: Ask AI copy says "Atlas AI" (provider is configurable); the chat history is kept across tab switches; only non-error turns (last 12, ≤ 2,000 chars, first one from the person) are sent.
- W7: lib/ai.ts sends `response_format: json_object` and the system role; on a 400/422 it falls back to no JSON mode, then to folding the system prompt into the first user turn. The installed @anthropic-ai/sdk has no `temperature` param, so the Anthropic branch omits it (untested; no Anthropic key).
- W7: Ask AI candidate devices = trigram rank (min 0.15) of each phrase (split on commas/"and"/"with"/…) plus 1–3 word windows of the last user message, best score per device, top 50.
- W8: atlas-probe reference models = Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M (1.12 GB, 1.544B params, 5.79 bpw) and bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M (2.02 GB, 3.213B params, 5.03 bpw); effective bandwidth/TFLOPS = max over the two.
- W8: Without --bench the CLI fills measured_bw_gbs / fp16_tflops / fp8 from the prototype DEVICES spec sheets (else typical values) and the summary labels each number measured / spec sheet / reported / assumed; RAM bandwidth is a multi-threaded memcpy test; disk_read_gbs = timed read of a cached GGUF, else 2 (assumed).
- W8: CLI share URL = ATLAS_URL ?? --url ?? DEFAULT_URL (cli/src/config.ts, placeholder https://atlas.example.invalid; --share refuses with a "set ATLAS_URL or --url" message while it is the placeholder). LLAMA_BENCH env may point at llama-bench.
- W8: Device resolution (exact id/name, alias, trigram >= 0.8) lives in components/probe/match.ts, shared by /probe and /api/runs; it also compares vendor-stripped names ("NVIDIA GeForce RTX 4090" -> r4090).
- W8: /api/runs stores over-quota runs too (rejected_reason "daily limit"), counting all stored runs per hashed fingerprint over a trailing 24 h; max 20 runs per request; empty runs -> {accepted:0} with no writes; missing RUNS_SALT or Supabase -> 503.
- W8: Unknown devices become id probe-<slug>, category "Reported by probe", mem_gb = vram_gb (discrete) else memory_gb, bw_gbs = measured_bw_gbs. Ceiling check uses the catalog device bw_gbs, skipped when file/model unknown or bits_per_weight is 0.
- W8: /probe maps the profile to HardwareSpec with link = devices > 1 ? pcie : none, and sets spec.deviceId only for a single matched device.
- W8: /api/runs IQR outlier check floors the spread at 5% of the group median (IQR 0 on identical rounded runs would otherwise reject every new run forever).
- W3: 0001 applied verbatim (no blocker). `0002_security.sql`: Supabase default privileges gave anon ALL on every relation, and `v_files` is auto-updatable with owner rights (postgres, BYPASSRLS), so the publishable key could write `files` through it. 0002 revokes all from anon/authenticated, then grants SELECT only on creators, models, devices, calibrations, metric_sources, eta_calibrations + the six views; the read_all policies now cover `authenticated` too; service_role gets explicit ALL. Views stay owner-rights (no security_invoker). Checked live through PostgREST with the publishable key: reads OK; runs/scores/files/setups/ingest_log → 401; POST v_files, PATCH devices, POST setups → 42501.
- W3: New tables after 0002 get no anon access by default (default privileges revoked): enable RLS and grant explicitly.
- W3: `metric_sources` PK is (metric, source), so several fields of one source go in ONE row, comma-separated: coding ← `livecodebench,scicode,terminalbench_hard`; agentic ← `tau2,terminalbench_hard`; math ← `aime_25,math_500`; long_ctx ← `lcr`; intelligence ← aa `artificial_analysis_intelligence_index`, arena `rating`, livebench `global_average`, epoch `eci`. Domain score = mean of the listed fields present. All field names are best guesses (W4: correct them after a real AA response). cyber has NO row: no AA field covers security, so after the first real sync the cyber tab has no AA data until W4 maps something.
- W3: Seed markers: `scores.source_ref` = `file_quality.source_ref` = 'seed', `runs.fingerprint` = 'seed'. Seed inserts into history tables (scores, api_offers, runs) are guarded with `not exists` per key, so a re-run never duplicates rows or outranks real data. `files` are seeded with explicit ids 1..47, then setval. file_quality/runs join on (id, repo, quant). Curated devices are upserted back to curated/verified on every run. No ingest_log rows.
- W3: Seeded runs: per sample group, nRuns values on a piecewise-linear line through p25/p50/p75, constant prompt_tps = promptP50, created_at = now() − 12 h. `v_run_stats` reproduces SAMPLE_RUN_STATS within 0.015 tok/s (verified live).
- W3: `data/devices-curated.json` has 219 devices; rows 0–19 = SAMPLE_DEVICES verbatim (generate-seed.ts asserts this). FP16 = dense tensor FP16, no sparsity: GeForce = SM × boost GHz × 0.512 (FP32-accumulate half rate; matches the prototype's 4090=165 and 3090=71); NVIDIA workstation = SM × GHz × 1.024; data center = published dense figure; RDNA3 = CU × GHz × 0.512; RDNA4 = CU × GHz × 1.024; RDNA2 = 2× FP32; Pascal/Maxwell = FP32 rate; Apple = GPU cores × GHz × 0.512 (prototype scale); Intel = published XMX. fp16_tflops is null where unknown (M5 Macs, Jetson AGX Thor).
- W3: fp4 = true for the new Blackwell / CDNA4 rows, but the prototype rows (spark, r5080, r5090, p6k) keep fp4 = false to match SAMPLE_DEVICES. Lead: flip those in sample-data.ts if wanted, and I'll update the JSON.
- W3: Device aliases include the dbgpu name of each curated card (so the import's 0.9 trigram rule skips it), the nvidia-smi / amd-smi / Intel full names (e.g. "NVIDIA L40S", "NVIDIA RTX 6000 Ada Generation", "AMD Instinct MI300X", "Intel(R) Arc(TM) A770 Graphics") and short names. Aliases are unique across the catalog (earlier rows win; e.g. the bare "NVIDIA GeForce RTX 4060 Ti" belongs to the 16 GB r4060t). "NVIDIA A100 80GB PCIe" stays on the separate a100p80 (1935 GB/s), not on a100 (SXM, 2039 GB/s).
- W3: dbgpu import: ids `dbgpu-<slug(vendor name)>`. Imports only NVIDIA/AMD/Intel cards released 2016 or later with ≥ 4 GB, and skips IGPs, consoles, mining, embedded and Tegra/Jetson parts. It also skips ids of non-dbgpu rows and any name (trailing die code like "GA104" stripped) with trigram ≥ 0.9 to a curated/probe name or alias. It upserts only new/changed rows, in batches of 500. The current package (dbgpu 2025.12) gives ~360 rows. Dry run: `pnpm exec tsx scripts/import-dbgpu.ts dump.json --dry-run`.
- W1: Wave 2 — with real data (300+ models) the Explorer shows the top 15 bars and top 50 table rows, each with a Show all toggle, so the page keeps the prototype's proportions.
- W1: Wave 2 — Hardware device list uses the prototype category order (AI box, Mac, GPU, Workstation GPU, Data center, Laptop GPU), verified first; Quants without ?model= opens on the model with the most rated quants.
- W4: Ingestion runs on one in-memory `IngestContext` per job (lib/ingest/context.ts): preload creators / models / aliases / newest fact rows once, match + compare in memory, then bulk writes in FK order (creators → models → aliases → scores / api_offers → upserts). `insertIfChanged(table, key, row, tol)` and `matchModel(source, externalId, name, creatorId, opts)` are its methods. Tolerances: scores 0.1, prices $0.001, tps / ttft 1%; a change of exactly one step counts.
- W4: OpenRouter "tracked" = not a `~` router alias or `:variant`, author ≠ openrouter, text in AND text out, and author maps to a known creator OR has hugging_face_id; newest first, cap 300 (~290 endpoint calls, ~3 s). One offer per provider_name (standard tier, then default tag, then cheapest). context_k: power-of-two windows in KiB (131072 → 128, 1048576 → 1000), others /1000. hf_repo comes from hugging_face_id (never overwrites a set one); expiration_date → deprecated_on.
- W4: AA free tier is paginated (200/page, 4 pages now) → the daily `aa` cron costs ~4 of the 100 requests/day, not 1. The free shape carries only the Intelligence Index (+ six capability indices that aren't Atlas metrics); coding/agentic indices are documented always-null; no individual evals, no token counts. Mapping (source of truth `AA_METRIC_FIELDS` in lib/ingest/aa.ts, upserted into metric_sources each run; guessed aa rows for math / long_ctx are deleted): intelligence ← artificial_analysis_intelligence_index; coding ← artificial_analysis_coding_index; agentic ← artificial_analysis_agentic_index (both null on free); cyber ← AA Cyber Index as republished by OpenRouter (`benchmarks.artificial_analysis.cyber_index`, written by the openrouter job as source aa); math, long_ctx: none → those Explorer tabs stay empty on real data.
- W4: AA entries without an Intelligence Index are never created as models (only matched exactly) — keeps ~600 legacy AA rows out. AA's slug is tried as an exact alias: the slug of AA's default effort variant has no effort suffix ("claude-opus-5-5" for "(Max, Default Fallback)"), so it lands on the OpenRouter base model; other effort variants ("… (Xhigh)") become their own models with alias 'new', unconfirmed.
- W4: task_profile from AA: free tier gives cost per task (USD), not tokens → task_out_tokens = (cost×1e6 − 40,000×price_in) / price_out at an assumed 40K input, estimated = true; skipped when outside 500–500K.
- W4: matchModel extras: exact match also on the dash-less form ("qwen-3-8-27b" ≡ "qwen3-8-27b"); trigram fuzzy requires equal version numbers (pg_trgm sets make "gpt-5" ≈ "gpt-5-5" = 1.0); creator-less sources (LiveBench) may fuzzy-match across creators; non-creating sources fall back to the same name without an effort tag (Arena "GPT-5.5 (High)" → gpt-5-5) as fuzzy/unconfirmed. Creator spellings map through CREATOR_ALIASES in lib/ingest/normalize.ts (qwen → alibaba, z-ai / Z.ai → zhipu-ai, SpaceXAI → xai, Kimi → moonshot-ai, Google DeepMind → google …); unknown creators are created with default_selected false.
- W4: Arena = HF dataset lmarena-ai/leaderboard-dataset (CC BY 4.0), config text_style_control, split latest, category overall, via datasets-server /filter; top 200 by rating only. LiveBench = livebench.ai/data/{release}/table.csv + categories.json, release = newest 8-digit id in the site bundle; score = weighted mean of category means with `_overall_weights` (as the site). Epoch = epoch.ai/data/eci_scores.csv (CC BY 4.0), ECI. All three store metric intelligence only (no AA counterpart to calibrate other metrics onto).
- W4: `/api/cron/[source]` returns the job result with HTTP 200, or 500 when ok is false; skips are ok:true and logged in ingest_log as `error = 'skipped: …'`. hf-sync logs source `hf-sync`; when it stops at 9 min it stores `{"cursor":"<last model id>"}` in ingest_log.error with ok = true.
- W4: hf-sync: hybrid-attention configs count only `full_attention` layers for KV; MLA = layers × (kv_lora_rank + qk_rope_head_dim) × 2 B; MoE active ≈ total − moe_layers × (E − k) × 3 × hidden × moe_intermediate_size. Top 8 uploaders, ≤ 3 repos each. GGUF rows = one per file stem (split parts summed); draft / MTP / noMTP / mmproj / imatrix files skipped; when two stems share a quant name the shortest stem wins. NVFP4 / EXL / bnb repos skipped (no files.format value). Quant labels keep `UD-` / `i1-` prefixes only (agentionai "AP-Q4_K_XL" → "Q4_K_XL").
- W4: /admin/match shows 60 rows per view with source filter chips (server-action forms per row are heavy); unmatched names get a live trigram suggestion (≥ 0.3) that Confirm stores as 'manual'. Cookie `atlas_admin` = sha256("atlas-admin-v1:" + ADMIN_PASSWORD), httpOnly, path /admin, 30 days; every action re-checks it.
- W4: KLD: data/kld/qwen3-8-27b.csv (agentionai model-card table, eval_set agentionai-heldout-60x2048) and kimi-k2-5.csv (QuantPasture card) hold real published numbers; unresolved rows wait until hf-sync has those repos. data/kld/atlas.csv is for scripts/measure-kld.sh output (eval_set atlas-v1).
- W1: Long tables (user feedback): Explorer table starts at the top 15 rows (same as the chart) with 'Show 25 more' / 'Show top 15' and a 'Showing x of y' count; no sticky header because the table lives in a horizontal-scroll box.
- W1: Quants table defaults to 'Best trade-offs' (frontier + best under budget) with 'Fits budget' / 'All N' toggles; clicking an uploader in the legend filters the table and the scatter to that uploader.
- W1: AA coverage — the free endpoint returns 766 entries over 4 pages (200/page), but only 155 carry an Intelligence Index v5 score (all released since Aug 2025); the rest are legacy entries AA hasn't re-scored. The first test run used W4's saved page-1 fixture (47 scored); a live run over all pages gives 158 models with AA intelligence (11 AA effort/date variants collapse onto one Atlas model).
- W1: Data cleanup after the first real sync: removed duplicate same-run fact rows, the 85 seed scores, the 25 seed offers and the 10 seed task profiles, and the η rows fitted on seed runs; calibrate now ignores runs with fingerprint 'seed'. Seed models, files, devices and runs stay until real hf-sync files and probe runs replace them.
- W1: loadFileCount reads v_files (anon has no grant on the files table after 0002).
- W1: Metric tabs, Recommender use cases and drawer domain rows only appear when some model has a value (user request). On the free AA tier that hides Coding, Agentic, Math and Long context; they return automatically if a source starts publishing them. Old ?m= / ?f= links to a hidden metric fall back to Intelligence / General.
- W1: hf-sync rejects files outside 1.2–17 bits per weight or under 0.3 GB (tiny-random test repos, partial uploads, pointer-only repos); 103 such rows deleted after the first full sync. Hardware went from a false '61 of 69 at full speed' on one DGX Spark to 45 of 69.
- W1: First full hf-sync: 67 of 145 models in 9 min (cursor saved, resumes daily); gated meta-llama repos give params but no KV size. KLD import matched 5 of 17 curated rows; re-run scripts/import-kld.ts after hf-sync reaches those repos.
- W1: Deployed with the Vercel CLI to https://atlas-beta-jig.vercel.app (project jigneshmotwanis-projects/atlas). vercel.json sets framework nextjs (a CLI-created project has no preset) and regions [sin1] next to Supabase Singapore; .vercelignore keeps .env* and local folders out of uploads. NEXT_PUBLIC_ vars are non-sensitive on Vercel by rule; the rest are sensitive.
- W1: atlas-probe DEFAULT_URL = https://atlas-beta-jig.vercel.app; --url now wins over ATLAS_URL.
- W1: Deleted the prototype sample data from Supabase on request: 127 seed runs, 37 sample-only files, 45 prototype KLD values and the two sample-only models (Gemini 3.5 Pro, Gemma 4 26B). 10 sample file rows that hf-sync had overwritten with real sizes were kept. loadRunStats no longer falls back to sample runs when v_run_stats is empty (measured rows return with real probe runs).
- W1: OEM / platform coverage: added NVIDIA DGX Station GB300 (252 GB HBM3e at 7.1 TB/s; NVIDIA page, Nov 2026) as a 'gpu' device in AI box with its OEM names (ASUS ET900N G3, Dell Pro Max with GB300, HP ZGX Fury, MSI XpertStation WS300, Gigabyte W775-V10-L01, Supermicro Super AI Station, Exxact). Its 496 GB LPDDR5X is spill-over RAM: set it in 'The PC the GPU sits in' (496 GB, 396 GB/s). GB200/GB300/B200/B300 gained DGX/HGX/NVL72 and Dell/HPE/Supermicro system names.
- W1: lib/device-names.ts ignores board-partner brands and marketing words (ASUS ROG Strix, MSI Suprim, Gigabyte AORUS, OC, Founders Edition…) in Pick devices search, Ask AI candidates and probe/runs device resolution; words that change memory or speed (pro, ti, super, max, laptop, sizes) are kept.
- W1: Vendor-reported speeds live in vendor_benchmarks (0003) from hand-curated data/vendor-benchmarks/*.csv (scripts/import-vendor-benchmarks.ts). Shown as a labelled 'NVIDIA: x tok/s' tag on Hardware rows when the setup matches exactly (N× one device) and as a 'Speeds reported by vendors' table in the drawer; never counted as measured and never used for η. First source: NVIDIA Technical Blog DGX Spark table (24 Oct 2025, BS=1, ISL/OSL 2048/128); 3 of 6 rows link to Atlas models.
- W1: hf-sync counts one copy of the weights (root-level .safetensors when present); openai/gpt-oss-* also ship original/ copies, which doubled their official size (gpt-oss-20b 27.5 → 13.8 GB).
- W1: Quants page after the sample-data deletion had 5 real KLD rows (one uploader). hf-sync now also syncs every repo named in `data/kld/<model id>.csv`, even outside the top-8 uploaders, so published KLD rows resolve: Qwen3.8-27B now has 14 rated quants from unsloth, agentionai and ISTA-DASLab. Kimi K2.5's 3 QuantPasture rows stay unimported (KLD vs a Q4_X reference, not BF16, and under MIN_RATED_QUANTS). "Not rated" = no published KLD for that file; never estimated.
- W1: Device search shows "Matches <alias>" under a row when only a partner name matched ("dell pro max" → DGX Spark / DGX Station).
