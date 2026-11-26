// /hardware — Hardware planner (owned by W7). Loads data on the server; the client reads the URL.
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { loadCalibrations, loadDeviceAliases, loadDevices, loadEta, loadFiles, loadModels, loadRunStats } from '@/lib/data';
import { HardwarePlanner, PlannerSkeleton } from '@/components/hardware/Planner';

export const revalidate = 3600;
export const metadata: Metadata = { title: 'Hardware · Atlas' };

export default async function HardwarePage() {
  const [models, calibrations, files, devices, aliasRows, runStats, eta] = await Promise.all([
    loadModels(), loadCalibrations(), loadFiles(), loadDevices(), loadDeviceAliases(), loadRunStats(), loadEta(),
  ]);
  const open = models.filter(m => m.openWeights);
  const openIds = new Set(open.map(m => m.id));
  const aliases = Object.fromEntries(aliasRows.map(a => [a.id, a.aliases]));
  return (
    <Suspense fallback={<PlannerSkeleton />}>
      <HardwarePlanner models={open} calibrations={calibrations} files={files.filter(f => openIds.has(f.modelId))}
        devices={devices} aliases={aliases} runStats={runStats} eta={eta} />
    </Suspense>
  );
}
