// Runs the per-OS detectors in order and fills in bandwidth / compute / disk with their source.
import { mkdir } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { CACHE_DIR } from '../config.js';
import { round } from '../profile.js';
import { detectAmd } from './amd.js';
import { ASSUMED, diskFreeGb, diskReadGbs, gib, measureRamBandwidth, specSheet, type Detected, type Valued } from './common.js';
import { detectLinuxUnified } from './linux-unified.js';
import { detectMac } from './mac.js';
import { detectNvidia } from './nvidia.js';

export interface Hardware extends Detected {
  bw: Valued;          // fast-memory bandwidth (GPU VRAM, unified pool, or RAM for cpu)
  ramBw: Valued;
  tflops: Valued;
  fp8: boolean;
  diskFree: Valued;
  diskRead: Valued;
}

export async function detectHardware(): Promise<Hardware> {
  const found: Detected = (await detectMac()) ?? (await detectNvidia()) ?? (await detectAmd()) ?? (await detectLinuxUnified()) ?? {
    name: (cpus()[0]?.model ?? 'Unknown CPU').replace(/\s+/g, ' ').trim(),
    arch: 'cpu', devices: 1, vramGb: 0, memoryGb: Math.round(gib(totalmem())), backend: 'cpu',
  };

  const sheet = found.arch === 'cpu' ? null : specSheet(found.name);
  const ramMeasured = found.arch === 'unified' ? null : await measureRamBandwidth();
  const ramBw: Valued = ramMeasured != null ? { value: round(ramMeasured), basis: 'measured' } : { value: ASSUMED.bw.cpu, basis: 'assumed' };

  let bw: Valued;
  if (found.arch === 'cpu') bw = ramBw;
  else if (sheet) bw = { value: sheet.bw, basis: 'spec sheet' };
  else bw = { value: ASSUMED.bw[found.arch], basis: 'assumed' };

  const tflops: Valued = sheet ? { value: sheet.tf, basis: 'spec sheet' } : { value: ASSUMED.tf[found.arch], basis: 'assumed' };

  await mkdir(CACHE_DIR, { recursive: true }).catch(() => undefined);
  const free = await diskFreeGb(CACHE_DIR);
  const read = await diskReadGbs(CACHE_DIR).catch(() => null);

  return {
    ...found,
    bw,
    ramBw: found.arch === 'unified' ? bw : ramBw,
    tflops,
    fp8: sheet?.fp8 ?? false,
    diskFree: free != null ? { value: Math.round(free), basis: 'reported' } : { value: 1000, basis: 'assumed' },
    diskRead: read != null ? { value: round(read), basis: 'measured' } : { value: ASSUMED.diskReadGbs, basis: 'assumed' },
  };
}

/** Re-measure disk read after `--bench` downloaded the reference files. */
export async function remeasureDiskRead(): Promise<Valued | null> {
  const read = await diskReadGbs(CACHE_DIR).catch(() => null);
  return read != null ? { value: round(read), basis: 'measured' } : null;
}
