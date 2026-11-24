// lib/engine/quants.ts — quant comparison: points, size/KLD frontier, best under a budget, uploader gap (SPEC "Engine").
// Pass one model's files; points are that model's 'quant' files with a KLD > 0 on `evalSet`.
import type { FileRow, QuantView } from '../contracts';

export function quantView(files: FileRow[], evalSet: string, budgetGb: number): QuantView {
  const kv = new Map<number, number>();
  for (const f of files) { const k = f.quality.find(q => q.evalSet === evalSet)?.kld; if (f.kind === 'quant' && k != null && k > 0) kv.set(f.id, k); }
  const k = (f: FileRow) => kv.get(f.id) ?? 0;
  const pts = files.filter(f => kv.has(f.id));
  const frontier = [...pts].sort((a, b) => a.sizeGb - b.sizeGb || k(a) - k(b))
    .reduce<FileRow[]>((acc, f) => (!acc.length || k(f) < k(acc[acc.length - 1]) ? [...acc, f] : acc), []).map(f => f.id);
  const best = pts.filter(f => f.sizeGb <= budgetGb).sort((a, b) => k(a) - k(b) || a.sizeGb - b.sizeGb)[0] ?? null;
  const groups = new Map<number, FileRow[]>();
  for (const f of pts) { const g = Math.round(f.sizeGb); groups.set(g, [...(groups.get(g) ?? []), f]); }
  const gap = [...groups.values()].filter(g => new Set(g.map(f => f.uploader)).size > 1)
    // a = lowest-loss file; b = highest-loss file from a *different* uploader (the group has 2+ uploaders, so one exists)
    .map(g => { const s = [...g].sort((a, b) => k(a) - k(b)), a = s[0], b = [...s].reverse().find(f => f.uploader !== a.uploader) ?? s[s.length - 1]; return { a, b, ratio: k(b) / k(a) }; })
    .sort((x, y) => y.ratio - x.ratio)[0] ?? null;
  return { points: pts, frontier, bestUnder: best?.id ?? null, uploaderGap: gap };
}
