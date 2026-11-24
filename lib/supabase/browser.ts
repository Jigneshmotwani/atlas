// lib/supabase/browser.ts — browser client (publishable key, read-only views). Owned by W1.
'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient | null {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL, k = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!u || !k) return null;
  return (client ??= createClient(u, k, { auth: { persistSession: false } }));
}
