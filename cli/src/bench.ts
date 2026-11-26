// --bench / --model: download GGUFs into ~/.cache/atlas-probe and time them with the user's own llama-bench.
import { execFile } from 'node:child_process';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ASK_ABOVE_GB, BENCH, CACHE_DIR, CACHE_LABEL, PROBE_VERSION } from './config.js';
import type { ProfileRun } from './profile.js';
import { round } from './profile.js';
import type { ReferenceModel } from './reference.js';

const log = (s: string) => process.stderr.write(s + '\n');
const UA = { 'user-agent': `atlas-probe/${PROBE_VERSION}` };

// ---- llama-bench -----------------------------------------------------------------------------

/** The llama-bench command to use (LLAMA_BENCH env overrides PATH), or null when it is not installed. */
export function findLlamaBench(): Promise<string | null> {
  const cmd = process.env.LLAMA_BENCH || 'llama-bench';
  return new Promise(resolve => {
    try {
      execFile(cmd, ['--help'], { timeout: 15_000, windowsHide: true }, err => {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        resolve(code === 'ENOENT' || code === 'EACCES' ? null : cmd);
      });
    } catch {
      resolve(null);
    }
  });
}

export function installHint(): string {
  const release = 'https://github.com/ggml-org/llama.cpp/releases';
  return platform() === 'darwin'
    ? 'llama-bench not found. Install llama.cpp with `brew install llama.cpp`, then run again.'
    : `llama-bench not found. Download a llama.cpp release for your GPU from ${release}, put llama-bench on your PATH (or set LLAMA_BENCH to its full path), then run again.`;
}

interface BenchRow { n_prompt?: number; n_gen?: number; avg_ts?: number; samples_ns?: number[]; build_number?: number; build_commit?: string }

export interface BenchResult { genTps: number; promptTps: number | null; runtimeVersion: string | undefined; loadS: number | undefined }

/** `llama-bench -m <file> -p 512 -n 128 -r 3 -o json` → prompt and generation tok/s. */
export async function runLlamaBench(cmd: string, file: string): Promise<BenchResult> {
  const args = ['-m', file, '-p', String(BENCH.prompt), '-n', String(BENCH.gen), '-r', String(BENCH.reps), '-o', 'json'];
  const t0 = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) reject(new Error(`llama-bench failed: ${String(errOut || err.message).trim().split(/\r?\n/).slice(-3).join(' ')}`));
      else resolve(String(out));
    });
  });
  const wallS = (Date.now() - t0) / 1000;
  const a = stdout.indexOf('['), b = stdout.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('llama-bench printed no JSON');
  const rows = JSON.parse(stdout.slice(a, b + 1)) as BenchRow[];
  const gen = rows.find(r => (r.n_gen ?? 0) > 0 && !(r.n_prompt ?? 0));
  const pp = rows.find(r => (r.n_prompt ?? 0) > 0 && !(r.n_gen ?? 0));
  if (!gen?.avg_ts) throw new Error('llama-bench JSON has no generation result');
  const any = gen ?? pp;
  const runtimeVersion = any?.build_number ? `b${any.build_number}` : any?.build_commit ? String(any.build_commit).slice(0, 12) : undefined;
  // load time ≈ wall time minus the timed repetitions and one warm-up per test (approximate)
  const testS = rows.reduce((s, r) => s + (r.samples_ns ?? []).reduce((x, y) => x + y, 0) / 1e9 * (1 + 1 / BENCH.reps), 0);
  const load = wallS - testS;
  return { genTps: gen.avg_ts, promptTps: pp?.avg_ts ?? null, runtimeVersion, loadS: load > 0.05 ? round(load, 1) : undefined };
}

export const toRun = (fileRef: string, r: BenchResult): ProfileRun => ({
  file: fileRef, runtime: 'llama.cpp', ...(r.runtimeVersion ? { runtime_version: r.runtimeVersion } : {}), ctx: BENCH.prompt,
  gen_tps: round(r.genTps, 1), ...(r.promptTps != null ? { prompt_tps: round(r.promptTps, 0) } : {}), ...(r.loadS != null ? { load_s: r.loadS } : {}),
});

// ---- downloads -------------------------------------------------------------------------------

const repoDir = (repo: string) => join(CACHE_DIR, repo.replace(/[\\/]/g, '__'));
const gb = (bytes: number) => (bytes / 1e9).toFixed(1) + ' GB';

async function sizeOnDisk(p: string): Promise<number | null> {
  try { return (await stat(p)).size; } catch { return null; }
}

/** Stream a URL into `dest` (via a .part file), printing progress to stderr. */
async function download(url: string, dest: string, expected: number | null, label: string): Promise<void> {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download of ${label} failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || expected || 0;
  const part = dest + '.part';
  const h = await open(part, 'w');
  let got = 0, shown = -1;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await h.write(value);
      got += value.byteLength;
      const pct = total ? Math.floor((got / total) * 100) : -1;
      if (process.stderr.isTTY && pct !== shown && pct % 5 === 0) { shown = pct; process.stderr.write(`\r  ${label}: ${pct}% of ${gb(total)}   `); }
    }
  } catch (e) {
    await h.close(); await rm(part, { force: true });
    throw e;
  }
  await h.close();
  if (process.stderr.isTTY) process.stderr.write('\n');
  if (expected && got !== expected) { await rm(part, { force: true }); throw new Error(`download of ${label} was incomplete`); }
  await rename(part, dest);
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return /^y(es)?$/i.test((await rl.question(question)).trim()); } finally { rl.close(); }
}

/** Download one reference model if not cached; returns its local path. */
export async function ensureReference(r: ReferenceModel): Promise<string> {
  const dir = repoDir(r.repo), dest = join(dir, r.file);
  if ((await sizeOnDisk(dest)) === r.sizeBytes) return dest;
  await mkdir(dir, { recursive: true });
  log(`Downloading ${r.repo}:${r.quant} (${gb(r.sizeBytes)}) into ${CACHE_LABEL}`);
  await download(r.url, dest, r.sizeBytes, `${r.repo}:${r.quant}`);
  return dest;
}

interface TreeEntry { type: string; path: string; size?: number; lfs?: { size?: number } }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Pick the .gguf file(s) for `quant` from a repo listing (split parts summed). */
function pickQuantFiles(entries: TreeEntry[], quant: string): TreeEntry[] {
  const q = quant.toLowerCase();
  const ggufs = entries.filter(e => e.type === 'file' && e.path.toLowerCase().endsWith('.gguf') && !/mmproj/i.test(e.path));
  const stem = (p: string) => basename(p).toLowerCase().replace(/\.gguf$/, '').replace(/-\d{5}-of-\d{5}$/, '');
  const hit = (e: TreeEntry) => {
    if (e.path.toLowerCase().split('/').slice(0, -1).includes(q)) return true;                  // UD-Q4_K_XL/model-00001-of-00002.gguf
    const s = stem(e.path), m = new RegExp(`(^|[-_.])${escapeRe(q)}$`).exec(s);
    if (!m) return false;
    const before = s.slice(0, m.index + m[1].length);
    return !/(^|[-_.])(ud|i1)[-_.]$/.test(before);                                                // Q4_K_M must not pick UD-Q4_K_M
  };
  const matches = ggufs.filter(hit);
  if (!matches.length) return [];
  const groups = new Map<string, TreeEntry[]>();
  for (const e of matches) { const k = e.path.replace(/-\d{5}-of-\d{5}\.gguf$/i, ''); groups.set(k, [...(groups.get(k) ?? []), e]); }
  return [...groups.values()].sort((a, b) => a[0].path.localeCompare(b[0].path))[0].sort((a, b) => a.path.localeCompare(b.path));
}

/** `--model <repo>:<quant>`: find, confirm (> 5 GB), download; returns the first part's local path, or null when skipped. */
export async function ensureModel(repo: string, quant: string): Promise<string | null> {
  const res = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`, { headers: UA });
  if (!res.ok) throw new Error(`Hugging Face has no public repo ${repo} (HTTP ${res.status})`);
  const parts = pickQuantFiles((await res.json()) as TreeEntry[], quant);
  if (!parts.length) throw new Error(`No .gguf file for quant ${quant} in ${repo}`);
  const size = (e: TreeEntry) => e.lfs?.size ?? e.size ?? 0;
  const total = parts.reduce((s, e) => s + size(e), 0);
  const dir = repoDir(repo);
  const local = parts.map(e => ({ e, dest: join(dir, basename(e.path)) }));
  const missing: typeof local = [];
  for (const x of local) if ((await sizeOnDisk(x.dest)) !== size(x.e)) missing.push(x);
  if (missing.length) {
    const need = missing.reduce((s, x) => s + size(x.e), 0);
    if (need / 1e9 > ASK_ABOVE_GB && !(await confirm(`${repo}:${quant} is ${gb(need)}. Download it into ${CACHE_LABEL}? [y/N] `))) {
      log(`Skipped ${repo}:${quant}${process.stdin.isTTY ? '' : ' (over 5 GB; run in a terminal to confirm the download)'}.`);
      return null;
    }
    await mkdir(dir, { recursive: true });
    log(`Downloading ${repo}:${quant} (${gb(total)}) into ${CACHE_LABEL}`);
    for (const x of missing) {
      const url = `https://huggingface.co/${repo}/resolve/main/${x.e.path.split('/').map(encodeURIComponent).join('/')}`;
      await download(url, x.dest, size(x.e) || null, basename(x.e.path));
    }
  }
  return local[0].dest;
}
