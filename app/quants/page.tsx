// /quants?model= — quant comparison (owned by W7). Loads data on the server; the client reads ?model=.
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { loadEta, loadFiles, loadModels, loadRunStats } from '@/lib/data';
import { Card } from '@/components/ui';
import { QuantCompare } from '@/components/quants/QuantCompare';

export const revalidate = 3600;
export const metadata: Metadata = { title: 'Quants · Atlas' };

export default async function QuantsPage() {
  const [models, files, runStats, eta] = await Promise.all([loadModels(), loadFiles(), loadRunStats(), loadEta()]);
  const open = models.filter(m => m.openWeights);
  const openIds = new Set(open.map(m => m.id));
  return (
    <Suspense fallback={<div className="space-y-5" aria-busy="true"><Card className="p-4 sm:p-6 min-h-[34rem]" /><Card className="p-2 sm:p-3 min-h-[12rem]" /></div>}>
      <QuantCompare models={open} files={files.filter(f => openIds.has(f.modelId))} runStats={runStats} eta={eta} />
    </Suspense>
  );
}
