// NVIDIA GPUs via nvidia-smi (Linux and Windows). Unified NVIDIA boxes (GB10 / Jetson) are handed to linux-unified.
import { totalmem } from 'node:os';
import { gib, run, type Detected } from './common.js';
import { isUnifiedName, unifiedMemoryGb } from './linux-unified.js';

interface Gpu { name: string; memMiB: number | null; linkGen: number | null }

export async function detectNvidia(): Promise<Detected | null> {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.total,pci.link.gen.current', '--format=csv,noheader,nounits']);
  if (!out) return null;
  const gpus: Gpu[] = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [name, mem, gen] = l.split(',').map(s => s.trim());
    const m = Number(mem), g = Number(gen);
    return { name, memMiB: isFinite(m) && m > 0 ? m : null, linkGen: isFinite(g) && g > 0 ? g : null };
  }).filter(g => g.name);
  if (!gpus.length) return null;

  // the biggest card names the setup; count only cards of that model
  const main = [...gpus].sort((a, b) => (b.memMiB ?? 0) - (a.memMiB ?? 0))[0];
  if (isUnifiedName(main.name) || main.memMiB == null) {
    return { name: main.name, arch: 'unified', devices: 1, vramGb: 0, memoryGb: await unifiedMemoryGb(), backend: 'cuda' };
  }
  const same = gpus.filter(g => g.name === main.name);
  return {
    name: main.name, arch: 'discrete', devices: same.length, vramGb: Math.round(main.memMiB / 1024),
    memoryGb: Math.round(gib(totalmem())), backend: 'cuda', linkGen: main.linkGen ?? undefined,
  };
}
