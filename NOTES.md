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
