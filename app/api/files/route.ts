// GET /api/files?model=<id> → FileRow[] for one model (Lead-owned). Lets client components
// (the model drawer) fetch files on demand instead of shipping every file with the page.
import { z } from 'zod';
import { loadFiles } from '@/lib/data';

export const revalidate = 3600;

export async function GET(req: Request) {
  const model = z.string().min(1).max(200).safeParse(new URL(req.url).searchParams.get('model'));
  if (!model.success) return Response.json({ error: 'model is required' }, { status: 400 });
  return Response.json(await loadFiles(model.data));
}
