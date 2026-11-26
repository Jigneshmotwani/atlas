// /admin/match (W4): confirm, remap or create models for source names the matcher was unsure about.
// Server Component; password prompt until the httpOnly admin cookie is set. Renders only its cards (shell is in the layout).
import Link from 'next/link';
import { Card, Head, Pill, TableBox, Tag, Th } from '@/components/ui';
import { normalizeName } from '@/lib/ingest/normalize';
import { supabaseAdmin } from '@/lib/supabase/server';
import { rankBySimilarity } from '@/lib/trigram';
import { confirmAlias, createModel, login, logout, remapAlias } from './actions';
import { isAdmin } from './auth';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = { openrouter: 'OpenRouter', aa: 'Artificial Analysis', arena: 'Arena', livebench: 'LiveBench', epoch: 'Epoch AI' };
const MAX_ROWS = 60;   // server-action forms per row are heavy; page through sources with ?source=
const input = 'h-10 rounded-full border border-line bg-card px-4 text-sm';

interface AliasRow { source: string; external_id: string; external_name: string | null; model_id: string | null; match_method: string | null; match_score: number | null; confirmed: boolean }
interface ModelLite { id: string; name: string; creator_id: string | null }

function Login({ failed }: { failed: boolean }) {
  return (
    <Card className="p-5 sm:p-8 max-w-md mx-auto">
      <Head title="Admin" />
      <p className="mt-2 text-sm text-mute">Enter the admin password to review model-name matches.</p>
      <form action={login} className="mt-5 flex flex-col sm:flex-row gap-3">
        <label htmlFor="admin-pw" className="sr-only">Admin password</label>
        <input id="admin-pw" name="password" type="password" required autoComplete="current-password" placeholder="Password" className={`${input} flex-1`} />
        <Pill type="submit" acc small>Unlock</Pill>
      </form>
      {failed && <p role="alert" className="mt-3 text-sm text-warn">Wrong password.</p>}
    </Card>
  );
}

async function load(source: string | null) {
  const db = supabaseAdmin();
  let q = db.from('model_aliases').select('source,external_id,external_name,model_id,match_method,match_score,confirmed').or('confirmed.eq.false,model_id.is.null');
  if (source) q = q.eq('source', source);
  const [a, m, c, all] = await Promise.all([
    q.order('source').order('match_score', { ascending: false, nullsFirst: false }).limit(MAX_ROWS),
    db.from('models').select('id,name,creator_id').order('name').limit(5000),
    db.from('creators').select('id,name').order('name'),
    db.from('model_aliases').select('source').or('confirmed.eq.false,model_id.is.null').limit(10000),
  ]);
  const err = a.error ?? m.error ?? c.error ?? all.error;
  if (err) throw new Error(err.message);
  const perSource: Record<string, number> = {};
  for (const r of (all.data ?? []) as { source: string }[]) perSource[r.source] = (perSource[r.source] ?? 0) + 1;
  return { aliases: (a.data ?? []) as AliasRow[], models: (m.data ?? []) as ModelLite[], creators: (c.data ?? []) as { id: string; name: string }[], perSource };
}

export default async function AdminMatchPage({ searchParams }: { searchParams: Promise<{ err?: string; source?: string }> }) {
  const sp = await searchParams;
  if (!(await isAdmin())) return <Login failed={sp.err === '1'} />;
  const source = sp.source && /^[a-z]{2,20}$/.test(sp.source) ? sp.source : null;

  let data: Awaited<ReturnType<typeof load>>;
  try { data = await load(source); } catch (e) {
    return <Card className="p-5 sm:p-8"><Head title="Match model names" /><p className="mt-3 text-sm text-warn">Could not read the database: {(e as Error).message}</p></Card>;
  }
  const { aliases, models, creators, perSource } = data;
  const total = Object.values(perSource).reduce((x, y) => x + y, 0), shown = source ? perSource[source] ?? 0 : total;
  const byId = new Map(models.map(m => [m.id, m]));
  const creatorName = new Map(creators.map(c => [c.id, c.name]));
  const normed = models.map(m => ({ m, n: normalizeName(m.name) }));
  const rows = aliases.map(a => {
    const stored = a.model_id ? byId.get(a.model_id) ?? null : null;
    const guess = stored ? null : rankBySimilarity(normalizeName(a.external_name ?? a.external_id), normed, x => [x.n], { min: 0.3, limit: 1 })[0] ?? null;
    return { a, suggestion: stored ?? guess?.item.m ?? null, score: stored ? a.match_score : guess ? Math.round(guess.score * 100) / 100 : null, stored: !!stored };
  });

  return (
    <>
      <Card className="p-4 sm:p-6">
        <Head
          title={`${total} name${total === 1 ? '' : 's'} to review`}
          right={<form action={logout}><Pill type="submit" small>Lock</Pill></form>}
        />
        <p className="mt-2 text-sm text-mute max-w-3xl">
          Fuzzy matches are already used but listed until you confirm them; unmatched names are ignored until you map them.
          Confirm accepts the suggestion, Remap picks another model, Create adds a new model for this name.
          {shown > rows.length && ` Showing the first ${rows.length} of ${shown}; confirmed rows drop off the list.`}
        </p>
        <nav aria-label="Filter by source" className="mt-4 flex flex-wrap gap-2">
          {[['', 'All', total] as const, ...Object.entries(perSource).map(([k, n]) => [k, SOURCE_LABEL[k] ?? k, n] as const)].map(([k, label, n]) => (
            <Link key={k || 'all'} href={k ? `/admin/match?source=${k}` : '/admin/match'} aria-current={(source ?? '') === k ? 'page' : undefined}
              className={`h-9 px-4 inline-flex items-center gap-2 rounded-full border text-sm font-semibold ${(source ?? '') === k ? 'bg-ink text-bg border-ink' : 'border-line bg-card hover:border-ink'}`}>
              {label}<span className="num text-xs opacity-70">{n}</span>
            </Link>
          ))}
        </nav>
      </Card>
      <Card className="p-2 sm:p-3 mt-4">
        {rows.length === 0 ? <p className="p-6 text-sm text-mute">Nothing to review. Every source name is matched and confirmed.</p> : (
          <TableBox>
            <thead className="bg-soft"><tr><Th>Source</Th><Th>External name</Th><Th>Suggested model</Th><Th r>Score</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {rows.map(({ a, suggestion, score, stored }) => (
                <tr key={`${a.source}:${a.external_id}`} className="border-t border-line hover:bg-soft align-top">
                  <td className="p-3 whitespace-nowrap">{SOURCE_LABEL[a.source] ?? a.source}</td>
                  <td className="p-3"><div className="font-semibold">{a.external_name ?? a.external_id}</div>{a.external_name && a.external_name !== a.external_id && <div className="text-xs text-mute break-all">{a.external_id}</div>}</td>
                  <td className="p-3">
                    {suggestion ? <><div className="font-semibold">{suggestion.name}</div><div className="text-xs text-mute">{creatorName.get(suggestion.creator_id ?? '') ?? 'Unknown'} · {suggestion.id}</div></> : <span className="text-mute">–</span>}
                    <div className="mt-1">{stored ? <Tag tone="butter">{a.match_method ?? 'match'} · unconfirmed</Tag> : <Tag>unmatched</Tag>}</div>
                  </td>
                  <td className="p-3 text-right num">{score ?? '–'}</td>
                  <td className="p-3 min-w-[16rem]">
                    <div className="flex flex-wrap gap-2">
                      {suggestion && (
                        <form action={confirmAlias}>
                          <input type="hidden" name="source" value={a.source} /><input type="hidden" name="externalId" value={a.external_id} />
                          <input type="hidden" name="modelId" value={suggestion.id} /><input type="hidden" name="stored" value={stored ? '1' : '0'} />
                          <Pill type="submit" small acc>Confirm</Pill>
                        </form>
                      )}
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-bold uppercase tracking-[.06em] text-mute">Remap / create</summary>
                      <form action={remapAlias} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="source" value={a.source} /><input type="hidden" name="externalId" value={a.external_id} />
                        <label className="sr-only" htmlFor={`rm-${a.source}-${a.external_id}`}>Model for {a.external_name ?? a.external_id}</label>
                        <input id={`rm-${a.source}-${a.external_id}`} name="modelId" list="atlas-models" required placeholder="Search models" className={`${input} w-56`} />
                        <Pill type="submit" small>Remap</Pill>
                      </form>
                      <form action={createModel} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="source" value={a.source} /><input type="hidden" name="externalId" value={a.external_id} />
                        <label className="sr-only" htmlFor={`cn-${a.source}-${a.external_id}`}>New model name</label>
                        <input id={`cn-${a.source}-${a.external_id}`} name="name" required defaultValue={a.external_name ?? a.external_id} className={`${input} w-56`} />
                        <label className="sr-only" htmlFor={`cc-${a.source}-${a.external_id}`}>Creator</label>
                        <input id={`cc-${a.source}-${a.external_id}`} name="creatorId" list="atlas-creators" defaultValue={suggestion?.creator_id ?? ''} placeholder="Creator id" className={`${input} w-40`} />
                        <Pill type="submit" small>Create new model</Pill>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableBox>
        )}
        <datalist id="atlas-creators">
          {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </datalist>
        <datalist id="atlas-models">
          {models.map(m => <option key={m.id} value={m.id}>{`${m.name} · ${creatorName.get(m.creator_id ?? '') ?? 'Unknown'}`}</option>)}
        </datalist>
      </Card>
      <p className="mt-3 text-xs text-mute">Benchmarks, speed and prices: Artificial Analysis (artificialanalysis.ai). Catalog and prices: OpenRouter.</p>
    </>
  );
}
