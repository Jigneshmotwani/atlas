// lib/state.ts — client-side shared state between pages (Lead-owned contract, see NOTES.md).
// URL query first, then localStorage. Safe to import from client components only (uses window lazily).
import type { HardwareSpec, HostPc, SetupPick } from './contracts';

export type HardwareMode = 'pick' | 'manual' | 'ai';
/** What the Hardware page saves on every change; the drawer and Quants read `spec`. */
export interface SavedHardware {
  mode: HardwareMode;
  picks: SetupPick[];
  host: HostPc;
  manual: HardwareSpec;
  ai: HardwareSpec | null;
  /** the spec currently in effect (already computed by the Hardware page) */
  spec: HardwareSpec | null;
  /** short label of where the spec came from, e.g. "1× NVIDIA DGX Spark" */
  label?: string;
}

export const HARDWARE_KEY = 'atlas.hardware.v1';
export const PROBE_HANDOFF_KEY = 'atlas.probe-handoff.v1';
export const PROVIDERS_KEY = 'atlas.providers.v1';

export const DEFAULT_PICKS: SetupPick[] = [{ deviceId: 'spark', qty: 1 }];
export const DEFAULT_HOST: HostPc = { ramGb: 64, ramBwGbs: 90, diskFreeGb: 2000, diskReadGbs: 5 };
/** prototype BLANK: the Enter specs form starts here */
export const BLANK_SPEC: HardwareSpec = {
  arch: 'discrete', gpus: 1, vramGb: 24, gpuBwGbs: 1000, link: 'pcie', ramGb: 64, ramBwGbs: 90,
  fp16Tflops: 100, fp8: true, backend: 'cuda', diskFreeGb: 1000, diskReadGbs: 5,
};

const read = <T,>(k: string): T | null => {
  if (typeof window === 'undefined') return null;
  try { const v = window.localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
};
const write = (k: string, v: unknown) => {
  if (typeof window === 'undefined') return;
  try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / private mode */ }
};

export const readSavedHardware = () => read<SavedHardware>(HARDWARE_KEY);
export const writeSavedHardware = (h: SavedHardware) => write(HARDWARE_KEY, h);
/** the saved spec in effect, or null when the user never set up hardware */
export const readSavedSpec = (): HardwareSpec | null => readSavedHardware()?.spec ?? null;

/** Device test → Hardware handoff: Probe writes, then navigates to `/hardware?mode=manual&from=probe`. */
export interface ProbeHandoff { spec: HardwareSpec; label: string; deviceId: string | null }
export const writeProbeHandoff = (h: ProbeHandoff) => write(PROBE_HANDOFF_KEY, h);
/** Hardware reads once and clears it. */
export const takeProbeHandoff = (): ProbeHandoff | null => { const h = read<ProbeHandoff>(PROBE_HANDOFF_KEY); write(PROBE_HANDOFF_KEY, null); return h; };

export const readProviders = () => read<string[]>(PROVIDERS_KEY);
export const writeProviders = (p: string[]) => write(PROVIDERS_KEY, p);

// ---- URL encoding of a pick setup: ?picks=spark:1,r4090:2&host=64,90,2000,5
export const encodePicks = (p: SetupPick[]) => p.filter(x => x.qty > 0).map(x => `${x.deviceId}:${x.qty}`).join(',');
export const decodePicks = (s: string | null | undefined): SetupPick[] | null => {
  if (!s) return null;
  const out = s.split(',').map(t => { const [deviceId, q] = t.split(':'); return { deviceId, qty: Math.max(0, Math.round(Number(q) || 0)) }; }).filter(x => x.deviceId && x.qty > 0);
  return out.length ? out : null;
};
export const encodeHost = (h: HostPc) => [h.ramGb, h.ramBwGbs, h.diskFreeGb, h.diskReadGbs].join(',');
export const decodeHost = (s: string | null | undefined): HostPc | null => {
  if (!s) return null;
  const [ramGb, ramBwGbs, diskFreeGb, diskReadGbs] = s.split(',').map(Number);
  return [ramGb, ramBwGbs, diskFreeGb, diskReadGbs].every(n => isFinite(n) && n >= 0) ? { ramGb, ramBwGbs, diskFreeGb, diskReadGbs } : null;
};
