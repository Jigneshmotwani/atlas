// Apple Silicon: unified memory, Metal backend. Reads only named fields (machine name, chip, memory);
// serial numbers, hostnames and user names that system_profiler also prints are never touched.
import { platform } from 'node:os';
import { gib, run, type Detected } from './common.js';

export async function detectMac(): Promise<Detected | null> {
  if (platform() !== 'darwin') return null;
  const sys = (await run('sysctl', ['-n', 'hw.memsize', 'machdep.cpu.brand_string'])) ?? '';
  const [memLine, brandLine] = sys.split(/\r?\n/);
  const memoryGb = Math.round(gib(Number(memLine) || 0));

  let chip = (brandLine ?? '').trim();
  const disp = await run('system_profiler', ['SPDisplaysDataType', '-json'], 30_000);
  try {
    const d = disp ? (JSON.parse(disp) as { SPDisplaysDataType?: { sppci_model?: string }[] }).SPDisplaysDataType : undefined;
    const model = d?.find(x => /apple/i.test(x.sppci_model ?? ''))?.sppci_model;
    if (model) chip = model.trim();
  } catch { /* keep brand string */ }

  let machine = '';
  const hw = await run('system_profiler', ['SPHardwareDataType', '-json'], 30_000);
  try {
    const h = hw ? (JSON.parse(hw) as { SPHardwareDataType?: { machine_name?: string }[] }).SPHardwareDataType?.[0] : undefined;
    machine = (h?.machine_name ?? '').trim();
  } catch { /* chip only */ }

  if (!/apple/i.test(chip)) return null; // Intel Mac: let the CPU fallback handle it
  // "MacBook Pro M4 Max 128GB", the catalog's naming
  const name = [machine, chip.replace(/^apple\s+/i, ''), memoryGb ? `${memoryGb}GB` : ''].filter(Boolean).join(' ');
  return { name, arch: 'unified', devices: 1, vramGb: 0, memoryGb, backend: 'metal' };
}
