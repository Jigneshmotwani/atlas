'use client';
// components/detail/providers.ts — Providers selection shared by the Explorer and the Recommender (W6).
// URL `p=` (comma-separated creator ids) first, then localStorage (`readProviders`), then `creators.defaultSelected`.
import { useMemo, useState } from 'react';
import type { ModelRow } from '@/lib/contracts';
import { PROVIDERS_KEY, readProviders, writeProviders } from '@/lib/state';
import { useStoredRaw, type Query } from './hooks';

export interface CreatorLite { id: string; name: string; defaultSelected: boolean }

/** every creator (catalog first, then any model creator missing from it) with its model count */
export function providerList(creators: CreatorLite[], models: ModelRow[]) {
  const all: { id: string; name: string }[] = creators.map(c => ({ id: c.id, name: c.name }));
  for (const m of models) if (!all.some(c => c.name === m.creatorName)) all.push({ id: m.creatorId, name: m.creatorName });
  return all.map(c => ({ ...c, count: models.filter(m => m.creatorName === c.name).length }));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

export function useProviders(query: Query, creators: CreatorLite[], models: ModelRow[]) {
  const list = useMemo(() => providerList(creators, models), [creators, models]);
  const defaults = useMemo(() => creators.filter(c => c.defaultSelected).map(c => c.name), [creators]);
  const [chosen, setChosen] = useState<string[] | null>(() => {
    const p = query?.get('p');
    if (p == null) return null;
    const ids = p.split(',').filter(Boolean);
    return list.filter(c => ids.includes(c.id)).map(c => c.name);
  });
  const raw = useStoredRaw(PROVIDERS_KEY);
  const stored = useMemo(() => {
    if (!raw) return null;
    const v = readProviders();
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  }, [raw]);
  const value = chosen ?? stored ?? defaults;
  const set = (v: string[]) => { setChosen(v); writeProviders(v); };
  /** value for the `p` query param (from the effective selection, so stored picks reach the link); null = defaults */
  const param = sameSet(value, defaults) ? null : list.filter(c => value.includes(c.name)).map(c => c.id).join(',');
  const options = useMemo(() => list.map(c => ({ name: c.name, count: c.count })), [list]);
  return { value, set, defaults, options, param };
}
