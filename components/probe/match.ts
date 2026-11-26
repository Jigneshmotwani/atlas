// components/probe/match.ts — resolve a probe's `device_name_raw` to a catalog device (W8).
// Pure and isomorphic: imported by the /probe client component and by POST /api/runs so both apply
// the same rule (SPEC "/api/runs checks" step 2): exact id, then alias, then trigram similarity >= 0.8.
import { similarity } from '@/lib/trigram';

export interface DeviceName { id: string; name: string; aliases: string[] }
export interface DeviceMatch { id: string; method: 'id' | 'alias' | 'trigram'; score: number }

export const DEVICE_MATCH_MIN = 0.8;

const VENDOR = /^(nvidia|amd|apple|intel|ati)\s+/;
/** Lowercase, drop the vendor prefix and filler words tools add ("NVIDIA GeForce RTX 4090 Laptop GPU" → "geforce rtx 4090 laptop"). */
export const normalizeDeviceName = (s: string) =>
  s.toLowerCase().replace(/\(r\)|\(tm\)/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(VENDOR, '').replace(/\b(gpu|graphics|generation|series)\b/g, ' ').replace(/\s+/g, ' ').trim();

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Best catalog device for a raw name, or null when nothing reaches the threshold. */
export function resolveDevice(raw: string, devices: DeviceName[]): DeviceMatch | null {
  const q = raw.trim();
  if (!q) return null;
  const byId = devices.find(d => same(d.id, q) || same(d.name, q));
  if (byId) return { id: byId.id, method: 'id', score: 1 };
  const byAlias = devices.find(d => d.aliases.some(a => same(a, q)));
  if (byAlias) return { id: byAlias.id, method: 'alias', score: 1 };
  const nq = normalizeDeviceName(q);
  let best: DeviceMatch | null = null;
  for (const d of devices) {
    for (const n of [d.name, ...d.aliases]) {
      const s = Math.max(similarity(q, n), similarity(nq, normalizeDeviceName(n)));
      if (s >= DEVICE_MATCH_MIN && (!best || s > best.score)) best = { id: d.id, method: 'trigram', score: s };
    }
  }
  return best;
}
