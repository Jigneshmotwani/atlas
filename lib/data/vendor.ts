// lib/data/vendor.ts — speeds published by NVIDIA / OEMs (vendor_benchmarks, migration 0003). Owned by W1.
// Not part of the frozen contracts: vendor numbers are shown with their own label and never count as "measured".
import 'server-only';
import { cache } from 'react';
import { num, selectAll, str, withFallback, type Row } from './_db';

export interface VendorBenchmark {
  deviceId: string; deviceName: string; devices: number; modelId: string | null; modelName: string;
  precision: string; runtime: string; batch: number; isl: number | null; osl: number | null;
  promptTps: number | null; genTps: number | null;
  source: 'nvidia' | 'oem'; sourceName: string; sourceUrl: string; publishedOn: string | null; note: string | null;
}

const toVendor = (r: Row): VendorBenchmark => ({
  deviceId: String(r.device_id), deviceName: str((r.devices_ref as Row | null)?.name) ?? String(r.device_id), devices: Number(r.devices ?? 1),
  modelId: str(r.model_id), modelName: String(r.model_name), precision: String(r.precision), runtime: String(r.runtime), batch: Number(r.batch ?? 1),
  isl: num(r.isl), osl: num(r.osl), promptTps: num(r.prompt_tps), genTps: num(r.gen_tps),
  source: r.source === 'oem' ? 'oem' : 'nvidia', sourceName: String(r.source_name), sourceUrl: String(r.source_url), publishedOn: str(r.published_on), note: str(r.note),
});

const COLS = 'device_id,devices,model_id,model_name,precision,runtime,batch,isl,osl,prompt_tps,gen_tps,source,source_name,source_url,published_on,note,devices_ref:devices(name)';

/** Every vendor-reported speed, or one model's. No sample fallback: none is better than made-up vendor numbers. */
export const loadVendorBenchmarks = cache((modelId?: string): Promise<VendorBenchmark[]> =>
  withFallback('vendor_benchmarks', async () => (await selectAll('vendor_benchmarks', COLS, modelId ? q => q.eq('model_id', modelId) : undefined)).map(toVendor), () => []));
