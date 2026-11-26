// components/hardware/spec.ts — HardwareSpec validation + compact URL encoding (owned by W7).
// Pure (no React, no server-only): used by /api/setups, /api/ask-hardware and the Hardware page.
import { z } from 'zod';
import type { Arch, Backend, HardwareSpec, Link } from '@/lib/contracts';

export const ARCHS = ['discrete', 'unified', 'cpu'] as const satisfies readonly Arch[];
export const LINKS = ['none', 'pcie', 'nvlink', 'network'] as const satisfies readonly Link[];
export const BACKENDS = ['cuda', 'rocm', 'metal', 'vulkan', 'cpu'] as const satisfies readonly Backend[];

const n = (max: number) => z.number().finite().min(0).max(max);

/** Strict HardwareSpec (the contract shape), for share links and request bodies. */
export const HardwareSpecSchema = z.object({
  arch: z.enum(ARCHS), gpus: z.number().int().min(1).max(256), vramGb: n(1024), gpuBwGbs: n(100_000), link: z.enum(LINKS),
  ramGb: n(65_536), ramBwGbs: n(100_000), fp16Tflops: n(1_000_000), fp8: z.boolean(), backend: z.enum(BACKENDS),
  diskFreeGb: n(10_000_000), diskReadGbs: n(1000),
  deviceId: z.string().max(200).optional(),
  single: z.object({ memGb: n(65_536), bwGbs: n(100_000), fp16Tflops: n(1_000_000) }).optional(),
  macGpuCap: z.number().min(0.1).max(1).optional(),
});

/** Compact URL form: arch,gpus,vram,gbw,link,ram,rbw,tf,fp8,backend,disk,dspd (deviceId/single are not kept). */
export const encodeSpec = (s: HardwareSpec) =>
  [s.arch, s.gpus, s.vramGb, s.gpuBwGbs, s.link, s.ramGb, s.ramBwGbs, s.fp16Tflops, s.fp8 ? 1 : 0, s.backend, s.diskFreeGb, s.diskReadGbs].join(',');

export function decodeSpec(str: string | null | undefined): HardwareSpec | null {
  if (!str) return null;
  const p = str.split(',');
  if (p.length !== 12) return null;
  const num = (i: number) => Number(p[i]);
  const r = HardwareSpecSchema.safeParse({
    arch: p[0], gpus: num(1), vramGb: num(2), gpuBwGbs: num(3), link: p[4], ramGb: num(5), ramBwGbs: num(6), fp16Tflops: num(7),
    fp8: p[8] === '1', backend: p[9], diskFreeGb: num(10), diskReadGbs: num(11),
  });
  return r.success ? r.data : null;
}
