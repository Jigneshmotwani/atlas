// app/page.tsx — Explorer (W6). Loads data on the server; the client component scores it and keeps its view in the URL.
import { Suspense } from 'react';
import { loadCalibrations, loadCreators, loadEta, loadFileCount, loadModels, loadRunStats } from '@/lib/data';
import { Explorer, ExplorerFromUrl, type ExplorerData } from '@/components/explorer/Explorer';

export const revalidate = 3600;

export default async function Page() {
  const [models, calibrations, creators, fileCount, runStats, eta] = await Promise.all([
    loadModels(), loadCalibrations(), loadCreators(), loadFileCount(), loadRunStats(), loadEta(),
  ]);
  // files are not shipped with the page: the drawer fetches /api/files?model= on open
  const data: ExplorerData = { models, calibrations, creators, fileCount, runStats, eta };
  // the fallback is the default view (prerendered HTML); the URL-aware copy replaces it in the browser
  return (
    <Suspense fallback={<Explorer {...data} query={null} />}>
      <ExplorerFromUrl {...data} />
    </Suspense>
  );
}
