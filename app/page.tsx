// Placeholder from Wave 0 (W1). W6 replaces this with the Explorer.
import { loadModels } from '@/lib/data';

export default async function Page() {
  const models = await loadModels();
  return <p className="p-6">Atlas skeleton: {models.length} models loaded.</p>;
}
