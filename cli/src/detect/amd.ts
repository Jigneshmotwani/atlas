// AMD GPUs via rocm-smi (Linux). Ryzen AI Max APUs are unified.
import { cpus, totalmem } from 'node:os';
import { gib, run, type Detected } from './common.js';
import { isUnifiedName, unifiedMemoryGb } from './linux-unified.js';

type Card = Record<string, string>;

export async function detectAmd(): Promise<Detected | null> {
  const out = await run('rocm-smi', ['--showproductname', '--showmeminfo', 'vram', '--json']);
  if (!out) return null;
  let data: Record<string, Card>;
  try { data = JSON.parse(out) as Record<string, Card>; } catch { return null; }
  const cards = Object.entries(data).filter(([k]) => /^card\d+/i.test(k)).map(([, c]) => {
    const name = c['Card Series'] ?? c['Card series'] ?? c['Card Model'] ?? c['Card model'] ?? c['Device Name'] ?? '';
    const vram = Number(c['VRAM Total Memory (B)'] ?? c['vram Total Memory (B)'] ?? NaN);
    return { name: name.trim(), vramGb: isFinite(vram) ? gib(vram) : 0 };
  }).filter(c => c.name);
  if (!cards.length) return null;

  const main = [...cards].sort((a, b) => b.vramGb - a.vramGb)[0];
  const cpu = cpus()[0]?.model ?? '';
  if (isUnifiedName(main.name) || isUnifiedName(cpu)) {
    const mem = await unifiedMemoryGb();
    const name = isUnifiedName(cpu) ? `${cpu.replace(/\s+w\/.*$/i, '').trim()} (${mem}GB)` : main.name;
    return { name, arch: 'unified', devices: 1, vramGb: 0, memoryGb: mem, backend: 'rocm' };
  }
  const same = cards.filter(c => c.name === main.name);
  return { name: main.name, arch: 'discrete', devices: same.length, vramGb: Math.round(main.vramGb), memoryGb: Math.round(gib(totalmem())), backend: 'rocm' };
}
