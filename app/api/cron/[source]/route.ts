// GET /api/cron/[source] — Vercel cron entry for the six light ingestion jobs (W4). Bearer CRON_SECRET only.
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { JOB_SOURCES, JOBS } from '@/lib/ingest/jobs';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const Source = z.enum(JOB_SOURCES);

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? ''), want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request, { params }: { params: Promise<{ source: string }> }) {
  if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Source.safeParse((await params).source);
  if (!parsed.success) return Response.json({ error: `source must be one of ${JOB_SOURCES.join(', ')}` }, { status: 400 });
  const result = await JOBS[parsed.data]({ log: msg => console.info(`[cron] ${msg}`) });
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
