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

Also `toModelRow`, `toFileRow`, `toDevice` row mappers. Supabase clients: `supabaseServer()` (publishable key, reads),
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
