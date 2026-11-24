// lib/supabase/server.ts — server-side clients. Owned by W1.
// Not marked 'server-only' because tsx scripts (GitHub Actions) import it too; never import it
// from a 'use client' file. The secret key has no NEXT_PUBLIC_ prefix, so it never reaches the browser bundle.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = () => process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;

/** true when the publishable-key read client can be built */
export const hasSupabase = () => !!(url() && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

let reader: SupabaseClient | null = null;
/** Read-only client (publishable key → anon role, views only). */
export function supabaseServer(): SupabaseClient {
  const u = url(), k = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!u || !k) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set');
  return (reader ??= createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }));
}

let admin: SupabaseClient | null = null;
/** Writer client (secret key). Cron routes, scripts, /api/runs, /api/setups, /admin only. */
export function supabaseAdmin(): SupabaseClient {
  const u = url(), k = process.env.SUPABASE_SECRET_KEY;
  if (!u || !k) throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SECRET_KEY not set');
  return (admin ??= createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }));
}
