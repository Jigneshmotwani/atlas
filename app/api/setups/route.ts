// /api/setups — short share links for a hardware spec (owned by W7).
// POST { spec } → { id };  GET ?id= → { spec };  errors → { error } with 4xx/5xx.
import { z } from 'zod';
import { HardwareSpecSchema } from '@/components/hardware/spec';
import { supabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ spec: HardwareSpecSchema });
const Id = z.string().regex(/^[a-z0-9]{4,32}$/);
const err = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return err('Body must be JSON', 400); }
  const p = Body.safeParse(body);
  if (!p.success) return err('Invalid spec', 400);
  try {
    const { data, error } = await supabaseAdmin().from('setups').insert({ spec: p.data.spec }).select('id').single();
    if (error || !data) { console.warn('[api/setups] insert failed:', error?.message); return err('Could not save the setup', 500); }
    return Response.json({ id: String(data.id) });
  } catch (e) {
    console.warn('[api/setups] insert failed:', (e as Error).message);
    return err('Could not save the setup', 503);
  }
}

export async function GET(req: Request) {
  const id = Id.safeParse(new URL(req.url).searchParams.get('id') ?? '');
  if (!id.success) return err('Missing or invalid id', 400);
  try {
    const { data, error } = await supabaseAdmin().from('setups').select('spec').eq('id', id.data).maybeSingle();
    if (error) { console.warn('[api/setups] read failed:', error.message); return err('Could not read the setup', 500); }
    if (!data) return err('Setup not found', 404);
    const spec = HardwareSpecSchema.safeParse(data.spec);
    if (!spec.success) return err('Setup not found', 404);
    return Response.json({ spec: spec.data });
  } catch (e) {
    console.warn('[api/setups] read failed:', (e as Error).message);
    return err('Could not read the setup', 503);
  }
}
