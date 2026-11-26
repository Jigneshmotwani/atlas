// app/recommend/page.tsx — Recommender (W6). Loads data on the server; the wizard runs the engine and keeps its answers in the URL.
import { Suspense } from 'react';
import { loadCalibrations, loadCreators, loadEta, loadFileCount, loadModels, loadRunStats } from '@/lib/data';
import { Recommender, RecommenderFromUrl, type RecommenderData } from '@/components/recommender/Recommender';

export const revalidate = 3600;

export default async function Page() {
  const [models, calibrations, creators, fileCount, runStats, eta] = await Promise.all([
    loadModels(), loadCalibrations(), loadCreators(), loadFileCount(), loadRunStats(), loadEta(),
  ]);
  // files are not shipped with the page: the drawer fetches /api/files?model= on open
  const data: RecommenderData = { models, calibrations, creators, fileCount, runStats, eta };
  return (
    <Suspense fallback={<Recommender {...data} query={null} />}>
      <RecommenderFromUrl {...data} />
    </Suspense>
  );
}
