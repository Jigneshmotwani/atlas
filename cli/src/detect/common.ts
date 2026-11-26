// Shared detection helpers: run a tool, known spec sheets, RAM bandwidth test, disk.
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Arch, Backend } from '../profile.js';

/** Where a number came from, shown in the summary. */
export type Basis = 'measured' | 'spec sheet' | 'assumed' | 'reported';
export interface Valued { value: number; basis: Basis }

/** One OS detector's answer. */
export interface Detected {
  name: string;          // device_name_raw (GPU / chip model only)
  arch: Arch;
  devices: number;
  vramGb: number;        // per GPU, 0 for unified / cpu
  memoryGb: number;      // system RAM (unified: the shared pool)
  backend: Backend;
  linkGen?: number;      // PCIe generation (NVIDIA)
}

/** Run a command without a shell; resolves stdout, or null when the tool is missing or fails. */
export function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<string | null> {
  return new Promise(resolve => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? null : String(stdout));
      });
    } catch {
      resolve(null);
    }
  });
}

export const gib = (bytes: number) => bytes / 2 ** 30;

/** Spec-sheet numbers for the catalog's sample devices (prototype DEVICES table): bandwidth GB/s, FP16 TFLOPS, FP8.
 *  Used only when `--bench` did not measure. Order matters: more specific names first. */
const SPEC_SHEETS: { match: RegExp; bw: number; tf: number; fp8: boolean }[] = [
  { match: /gb10|dgx spark/i, bw: 273, tf: 125, fp8: true },
  { match: /ryzen ai max|8060s/i, bw: 256, tf: 59, fp8: false },
  { match: /jetson agx orin|orin 64/i, bw: 205, tf: 21, fp8: false },
  { match: /m4 pro/i, bw: 273, tf: 17, fp8: false },
  { match: /m4 max/i, bw: 546, tf: 34, fp8: false },
  { match: /m3 ultra/i, bw: 819, tf: 57, fp8: false },
  { match: /4090 laptop/i, bw: 576, tf: 80, fp8: true },
  { match: /rtx 3090(?! ti)/i, bw: 936, tf: 71, fp8: false },
  { match: /rtx 4060 ti/i, bw: 288, tf: 44, fp8: true },
  { match: /rtx 4090/i, bw: 1008, tf: 165, fp8: true },
  { match: /rtx 5080/i, bw: 960, tf: 113, fp8: true },
  { match: /rtx 5090/i, bw: 1792, tf: 209, fp8: true },
  { match: /7900 xtx/i, bw: 960, tf: 123, fp8: false },
  { match: /rtx 6000 ada/i, bw: 960, tf: 364, fp8: true },
  { match: /rtx pro 6000/i, bw: 1792, tf: 500, fp8: true },
  { match: /l40s/i, bw: 864, tf: 362, fp8: true },
  { match: /a100.*80|a100-sxm4-80/i, bw: 2039, tf: 312, fp8: false },
  { match: /h100/i, bw: 3350, tf: 989, fp8: true },
];
export const specSheet = (name: string) => SPEC_SHEETS.find(s => s.match.test(name)) ?? null;

/** Fallbacks when nothing is known (labelled "assumed"). */
export const ASSUMED = {
  bw: { discrete: 500, unified: 200, cpu: 50 } as Record<Arch, number>,
  tf: { discrete: 50, unified: 20, cpu: 2 } as Record<Arch, number>,
  diskReadGbs: 2,
};

/** Approximate RAM bandwidth: a few worker threads copy 64 MB buffers for ~0.4 s (read + write bytes counted). */
export async function measureRamBandwidth(): Promise<number | null> {
  const workers = Math.max(1, Math.min(8, cpus().length));
  const code = `
    const { parentPort } = require('node:worker_threads');
    const size = 64 * 1024 * 1024, a = Buffer.alloc(size, 1), b = Buffer.alloc(size);
    a.copy(b); // warm up / fault in pages
    let bytes = 0; const t0 = process.hrtime.bigint(), end = t0 + 400000000n;
    while (process.hrtime.bigint() < end) { a.copy(b); bytes += 2 * size; }
    parentPort.postMessage({ bytes, ns: Number(process.hrtime.bigint() - t0) });`;
  try {
    const results = await Promise.all(Array.from({ length: workers }, () => new Promise<{ bytes: number; ns: number }>((resolve, reject) => {
      const w = new Worker(code, { eval: true });
      w.once('message', m => { resolve(m as { bytes: number; ns: number }); void w.terminate(); });
      w.once('error', reject);
    })));
    const ns = Math.max(...results.map(r => r.ns));
    const bytes = results.reduce((a, r) => a + r.bytes, 0);
    return ns > 0 ? bytes / (ns / 1e9) / 1e9 : null;
  } catch {
    return null;
  }
}

/** Free space (GB) on the volume that holds `dir`; null on Node versions without fs.statfs. */
export async function diskFreeGb(dir: string): Promise<number | null> {
  const statfs = (fs.promises as unknown as { statfs?: (p: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }> }).statfs;
  if (!statfs) return null;
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize) / 1e9;
  } catch {
    return null;
  }
}

/** Disk read speed (GB/s): read the largest cached .gguf (up to 1 GB) and time it. Approximate: the OS cache may help. */
export async function diskReadGbs(dir: string): Promise<number | null> {
  const files: { path: string; size: number }[] = [];
  const walk = async (d: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.gguf')) { try { files.push({ path: p, size: (await stat(p)).size }); } catch { /* gone */ } }
    }
  };
  await walk(dir, 0);
  const f = files.sort((a, b) => b.size - a.size)[0];
  if (!f || f.size < 256 * 2 ** 20) return null;
  const limit = Math.min(f.size, 2 ** 30), chunk = Buffer.allocUnsafe(16 * 2 ** 20);
  const h = await open(f.path, 'r');
  try {
    let read = 0;
    const t0 = process.hrtime.bigint();
    while (read < limit) {
      const { bytesRead } = await h.read(chunk, 0, chunk.length, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    return s > 0 ? read / s / 1e9 : null;
  } finally {
    await h.close();
  }
}
