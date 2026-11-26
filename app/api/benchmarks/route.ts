// GET /api/benchmarks?model=<id> → VendorBenchmark[] for one model (W1). The model drawer fetches this on open.
import { z } from 'zod';
import { loadVendorBenchmarks } from '@/lib/data';

export const revalidate = 3600;

export async function GET(req: Request) {
  const model = z.string().min(1).max(200).safeParse(new URL(req.url).searchParams.get('model'));
  if (!model.success) return Response.json({ error: 'model is required' }, { status: 400 });
  return Response.json(await loadVendorBenchmarks(model.data));
}
