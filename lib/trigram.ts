// lib/trigram.ts — pg_trgm-compatible similarity in plain TS (owned by W1).
// Used for model-name matching (W4), device search in Ask AI (W7), device resolution in /api/runs and /probe (W8),
// so no Postgres RPC is needed. Pure, no imports: safe on server and client.

/** pg_trgm trigram set: lowercase, split into alphanumeric words, pad each word with "  " before and " " after. */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** Same result as Postgres `similarity(a, b)`: |A ∩ B| / |A ∪ B| over trigram sets (0..1). */
export function similarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  return both / (A.size + B.size - both);
}

/** Best similarity of `q` against any of `names`. */
export const bestSimilarity = (q: string, names: string[]) => names.reduce((m, n) => Math.max(m, similarity(q, n)), 0);

/** Rank items by best similarity of their names to `q`; keeps those ≥ `min`, highest first, at most `limit`. */
export function rankBySimilarity<T>(q: string, items: T[], names: (t: T) => string[], { min = 0, limit = 50 } = {}): { item: T; score: number }[] {
  return items.map(item => ({ item, score: bestSimilarity(q, names(item)) }))
    .filter(x => x.score >= min).sort((a, b) => b.score - a.score).slice(0, limit);
}
