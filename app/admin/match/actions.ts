'use server';
// app/admin/match/actions.ts — server actions for /admin/match (W4). Every action re-checks the admin cookie.
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { cleanDisplayName, normalizeName } from '@/lib/ingest/normalize';
import { supabaseAdmin } from '@/lib/supabase/server';
import { ADMIN_COOKIE, adminToken, isAdmin, sameToken } from './auth';

const PATH = '/admin/match';
const Key = z.object({ source: z.string().min(1).max(40), externalId: z.string().min(1).max(300) });
const field = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' ? v.trim() : ''; };

async function guard() {
  if (!(await isAdmin())) redirect(PATH);
}
function key(fd: FormData) {
  const p = Key.safeParse({ source: field(fd, 'source'), externalId: field(fd, 'externalId') });
  if (!p.success) throw new Error('bad alias key');
  return p.data;
}
async function setAlias(source: string, externalId: string, modelId: string, method: 'manual' | 'exact' | 'fuzzy' | 'new') {
  const db = supabaseAdmin();
  const { data: m } = await db.from('models').select('id').eq('id', modelId).maybeSingle();
  if (!m) throw new Error(`unknown model ${modelId}`);
  const { error } = await db.from('model_aliases').update({ model_id: modelId, match_method: method, confirmed: true }).eq('source', source).eq('external_id', externalId);
  if (error) throw new Error(error.message);
}

export async function login(fd: FormData): Promise<void> {
  const want = adminToken();
  if (!want || !sameToken(adminToken(field(fd, 'password')), want)) redirect(`${PATH}?err=1`);
  (await cookies()).set(ADMIN_COOKIE, want, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/admin', maxAge: 60 * 60 * 24 * 30 });
  redirect(PATH);
}

export async function logout(): Promise<void> {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: '/admin' });
  redirect(PATH);
}

/** Accept the suggested model (stored match, or the page's trigram suggestion for unmatched names). */
export async function confirmAlias(fd: FormData): Promise<void> {
  await guard();
  const { source, externalId } = key(fd);
  const modelId = field(fd, 'modelId'), stored = field(fd, 'stored') === '1';
  if (!modelId) throw new Error('nothing to confirm');
  const db = supabaseAdmin();
  if (stored) {
    const { error } = await db.from('model_aliases').update({ confirmed: true }).eq('source', source).eq('external_id', externalId).eq('model_id', modelId);
    if (error) throw new Error(error.message);
  } else await setAlias(source, externalId, modelId, 'manual');
  revalidatePath(PATH);
}

export async function remapAlias(fd: FormData): Promise<void> {
  await guard();
  const { source, externalId } = key(fd);
  const modelId = field(fd, 'modelId');
  if (!modelId) throw new Error('pick a model');
  await setAlias(source, externalId, modelId, 'manual');
  revalidatePath(PATH);
}

export async function createModel(fd: FormData): Promise<void> {
  await guard();
  const { source, externalId } = key(fd);
  const name = cleanDisplayName(field(fd, 'name')).slice(0, 200);
  const creatorId = field(fd, 'creatorId') || null;
  const base = normalizeName(name);
  if (!base) throw new Error('name required');
  const db = supabaseAdmin();
  const { data: taken } = await db.from('models').select('id').like('id', `${base}%`);
  const ids = new Set(((taken ?? []) as { id: string }[]).map(r => r.id));
  let id = base;
  for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
  const { error } = await db.from('models').insert({ id, name, creator_id: creatorId });
  if (error) throw new Error(error.message);
  await setAlias(source, externalId, id, 'manual');
  revalidatePath(PATH);
}
