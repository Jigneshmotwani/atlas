// lib/ingest/util.ts — small fetch / CSV / concurrency helpers shared by the source clients (W4).

export const UA = 'atlas-ingest/1.0 (+private single-owner tool)';

/** fetch with a timeout; throws on non-2xx with the status in the message. */
export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
  const { timeoutMs = 20_000, headers, ...rest } = init;
  const res = await fetch(url, { ...rest, headers: { 'user-agent': UA, ...(headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  if (!res.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname} → HTTP ${res.status}`);
  return res.text();
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  return JSON.parse(await fetchText(url, init)) as T;
}

/** Map with at most `n` promises in flight; results keep input order. Rejections become `{ error }`. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<({ ok: true; value: R } | { ok: false; error: string })[]> {
  const out = new Array<{ ok: true; value: R } | { ok: false; error: string }>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      try { out[i] = { ok: true, value: await fn(items[i], i) }; } catch (e) { out[i] = { ok: false, error: errMsg(e) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Finite number or null (accepts numeric strings). */
export const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
export const round = (v: number | null, digits: number) => (v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

/** RFC-4180-ish CSV parser (quoted fields, doubled quotes, CRLF). Returns rows of objects keyed by the header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map(h => h.trim());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** Context window in K tokens the way the UI prints it (131072 → 128, 1048576 → 1000, 400000 → 400). */
export function contextK(tokens: unknown): number | null {
  const t = num(tokens);
  if (!t || t <= 0) return null;
  if (t % 1024 === 0) { const k = t / 1024; return k >= 1024 ? Math.round((k / 1024) * 1000) : k; }
  return Math.round(t / 1000);
}

/** Per-key difference of two counters (match-method counts of one job on a shared context). */
export const diff = (a: Record<string, number>, b: Record<string, number>) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v - (b[k] ?? 0)]).filter(([, v]) => v));
