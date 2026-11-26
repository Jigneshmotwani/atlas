'use client';
// components/detail/hooks.ts — small client hooks shared by W6 screens.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/** Raw localStorage string for `key`; null on the server and during hydration, so SSR and client agree. */
export function useStoredRaw(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => { try { return window.localStorage.getItem(key); } catch { return null; } },
    () => null,
  );
}

/** Normalised form of a query string, so our compact `a=1,2` and URLSearchParams' `a=1%2C2` compare equal. */
const norm = (qs: string) => new URLSearchParams(qs).toString();
/** The query this tab last wrote with `useUrlSync` (client only; null until the first write). */
let lastWritten: string | null = null;

/**
 * Keeps the page's query string equal to `qs` (debounced 250 ms, `window.history.replaceState`, which
 * Next syncs into `useSearchParams` without refetching the RSC payload).
 * `enabled = false` for the Suspense fallback copy, which must never rewrite the URL.
 */
export function useUrlSync(qs: string, enabled = true) {
  const pathname = usePathname();
  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => {
      if (norm(window.location.search) === norm(qs)) return;
      lastWritten = norm(qs);
      window.history.replaceState(null, '', (qs ? `${pathname}?${qs}` : pathname) + window.location.hash);
    }, 250);
    return () => window.clearTimeout(t);
  }, [qs, enabled, pathname]);
}

/**
 * A counter that goes up whenever the URL query changes for a reason other than our own `useUrlSync`
 * write (header link to bare `/`, back / forward). Use it as the screen's `key` so its state is
 * re-derived from the URL.
 */
export function useUrlEpoch(search: { toString(): string }): number {
  const cur = norm(search.toString());
  const [seen, setSeen] = useState(cur);
  const [epoch, setEpoch] = useState(0);
  if (cur !== seen) {
    setSeen(cur);
    if (cur !== lastWritten) setEpoch(e => e + 1);
  }
  return epoch;
}

/** Minimal read-only view of URLSearchParams (null = no URL state, e.g. the prerendered fallback). */
export type Query = { get(name: string): string | null } | null;

/** Compact query string: skips null/'' (except keys in `keepEmpty`), leaves commas unescaped. */
export function toQs(entries: [string, string | number | null | undefined][], keepEmpty: string[] = []) {
  return entries
    .filter(([k, v]) => v != null && (v !== '' || keepEmpty.includes(k)))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2C/gi, ',')}`)
    .join('&');
}

/** `value` when it is one of `allowed`, else `fallback` */
export const oneOf = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** comma list from the URL, keeping only allowed values */
export const listOf = <T extends string>(value: string | null | undefined, allowed: readonly T[]): T[] =>
  (value ?? '').split(',').filter((x): x is T => allowed.includes(x as T));
