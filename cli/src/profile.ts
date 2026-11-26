// The Profile JSON: exact field names from SPEC "atlas-probe CLI". The web Device test page and
// POST /api/runs both parse this shape. Never add hostnames, usernames, paths or file contents.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_DIR } from './config.js';

export type Arch = 'discrete' | 'unified' | 'cpu';
export type Backend = 'cuda' | 'rocm' | 'metal' | 'vulkan' | 'cpu';

export interface ProfileRun {
  file: string;              // 'repo:quant'
  runtime: string;           // 'llama.cpp'
  runtime_version?: string;  // 'b6123'
  ctx?: number;
  gen_tps: number;
  prompt_tps?: number;
  load_s?: number;
}

export interface Profile {
  probe_version: string;
  device_name_raw: string;
  arch: Arch;
  devices: number;
  vram_gb: number;
  memory_gb: number;
  measured_bw_gbs: number;
  ram_bw_gbs: number;
  fp16_tflops: number;
  fp8: boolean;
  backend: Backend;
  disk_free_gb: number;
  disk_read_gbs: number;
  fingerprint: string;
  runs: ProfileRun[];
}

/** Random install id, created once in ~/.config/atlas-probe/id. It identifies nothing about the machine. */
export async function fingerprint(): Promise<string> {
  const file = join(CONFIG_DIR, 'id');
  try {
    const id = (await readFile(file, 'utf8')).trim();
    if (/^[0-9a-f-]{36}$/i.test(id)) return id;
  } catch { /* first run */ }
  const id = randomUUID();
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(file, id + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch { /* read-only home: use a one-off id */ }
  return id;
}

export const round = (n: number, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f; };
