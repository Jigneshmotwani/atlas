// lib/data/hardware.ts — devices, run stats, η calibrations. Owned by W1.
import 'server-only';
import { cache } from 'react';
import type { Backend, Device, DeviceType, EtaCalibration, RunStat } from '@/lib/contracts';
import { SAMPLE_DEVICES, SAMPLE_ETA, SAMPLE_RUN_STATS } from '@/lib/sample-data';
import { num, selectAll, withFallback, type Row } from './_db';

export function toDevice(r: Row): Device {
  return {
    id: String(r.id), name: String(r.name), category: String(r.category), type: r.type as DeviceType, memGb: Number(r.mem_gb), bwGbs: Number(r.bw_gbs),
    fp16Tflops: num(r.fp16_tflops), fp8: !!r.fp8, fp4: !!r.fp4, backend: r.backend as Backend, usableFrac: num(r.usable_frac),
    source: r.source as Device['source'], verified: !!r.verified,
  };
}

/** Whole device catalog, verified first then by name. */
export const loadDevices = cache((): Promise<Device[]> =>
  withFallback('devices', async () => (await selectAll('devices', 'id,name,category,type,mem_gb,bw_gbs,fp16_tflops,fp8,fp4,backend,usable_frac,source,verified',
    q => q.order('verified', { ascending: false }).order('name'))).map(toDevice), () => SAMPLE_DEVICES, true));

/** v_run_stats: median / IQR of shared runs per device × file × runtime (rows without a device or file are skipped). */
export const loadRunStats = cache((): Promise<RunStat[]> =>
  withFallback('v_run_stats', async () => (await selectAll('v_run_stats')).filter(r => r.device_id != null && r.file_id != null).map((r): RunStat => ({
    deviceId: String(r.device_id), fileId: Number(r.file_id), runtime: String(r.runtime), nRuns: Number(r.n_runs), genP50: Number(r.gen_p50), genP25: Number(r.gen_p25),
    genP75: Number(r.gen_p75), promptP50: num(r.prompt_p50), anyVerified: !!r.any_verified, lastRun: String(r.last_run),
  })), () => SAMPLE_RUN_STATS, true));

/** Fitted efficiency factors (empty until 20+ runs exist per group). */
export const loadEta = cache((): Promise<EtaCalibration[]> =>
  withFallback('eta_calibrations', async () => (await selectAll('eta_calibrations')).map((r): EtaCalibration => ({
    deviceType: r.device_type as DeviceType, runtime: String(r.runtime), moe: !!r.moe, eta: Number(r.eta), nRuns: Number(r.n_runs),
  })), () => SAMPLE_ETA));
