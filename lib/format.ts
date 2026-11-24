// lib/format.ts — shared number formatters copied from the prototype. Owned by W1.
/** $0.0042 · $0.123 · $12.30 */
export const fmtUsd = (n: number | null | undefined) => n == null || !isFinite(n) ? '–' : n < 0.01 ? '$' + n.toFixed(4) : n < 1 ? '$' + n.toFixed(3) : '$' + n.toFixed(2);
/** 42s · 3m 05s */
export const fmtTime = (s: number | null | undefined) => s == null || !isFinite(s) ? '–' : s < 60 ? s.toFixed(0) + 's' : Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's';
/** 128K · 1M · 2M */
export const fmtCtx = (k: number | null | undefined) => k == null ? '–' : k >= 1000 ? k / 1000 + 'M' : k + 'K';
/** one decimal, trailing .0 dropped */
export const fmt1 = (n: number | null | undefined) => n == null || !isFinite(n) ? '–' : String(Math.round(n * 10) / 10);
/** "3h ago" · "2d ago" · "just now" from an ISO timestamp */
export function fmtAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'never';
  const m = Math.max(0, (now - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + 'm ago';
  if (m < 60 * 24) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
