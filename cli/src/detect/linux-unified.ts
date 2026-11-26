// Linux shared-memory boxes: DGX Spark (GB10), Ryzen AI Max, Jetson. GPU name match → arch unified,
// memory from /proc/meminfo.
import { readFile } from 'node:fs/promises';
import { cpus, platform, totalmem } from 'node:os';
import { gib, type Detected } from './common.js';

const UNIFIED = /\bgb10\b|dgx spark|jetson|\borin\b|\bthor\b|ryzen ai max|radeon 8060s|radeon 8050s|strix halo/i;
export const isUnifiedName = (name: string) => UNIFIED.test(name);

/** Total memory in GB: /proc/meminfo MemTotal on Linux, os.totalmem() elsewhere. */
export async function unifiedMemoryGb(): Promise<number> {
  if (platform() === 'linux') {
    try {
      const m = /^MemTotal:\s+(\d+)\s*kB/m.exec(await readFile('/proc/meminfo', 'utf8'));
      if (m) return Math.round(Number(m[1]) / 2 ** 20);
    } catch { /* fall through */ }
  }
  return Math.round(gib(totalmem()));
}

/** Boxes without nvidia-smi / rocm-smi: Jetson (device-tree model) and Ryzen AI Max (CPU brand). */
export async function detectLinuxUnified(): Promise<Detected | null> {
  if (platform() !== 'linux') return null;
  try {
    const model = (await readFile('/proc/device-tree/model', 'utf8')).replace(/\0/g, '').trim();
    if (/jetson/i.test(model)) {
      return { name: model.replace(/\s+developer kit$/i, ''), arch: 'unified', devices: 1, vramGb: 0, memoryGb: await unifiedMemoryGb(), backend: 'cuda' };
    }
  } catch { /* not a device-tree board */ }
  const cpu = cpus()[0]?.model ?? '';
  if (/ryzen ai max/i.test(cpu)) {
    const mem = await unifiedMemoryGb();
    return { name: `${cpu.replace(/\s+w\/.*$/i, '').trim()} (${mem}GB)`, arch: 'unified', devices: 1, vramGb: 0, memoryGb: mem, backend: 'rocm' };
  }
  return null;
}
