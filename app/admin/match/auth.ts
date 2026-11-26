// app/admin/match/auth.ts — ADMIN_PASSWORD cookie check (W4). The cookie holds a hash, never the password.
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'atlas_admin';

/** sha256 of a versioned label + the password; null when ADMIN_PASSWORD is not set (admin disabled). */
export function adminToken(password = process.env.ADMIN_PASSWORD): string | null {
  if (!password) return null;
  return createHash('sha256').update(`atlas-admin-v1:${password}`).digest('hex');
}

export function sameToken(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function isAdmin(): Promise<boolean> {
  return sameToken((await cookies()).get(ADMIN_COOKIE)?.value, adminToken());
}
