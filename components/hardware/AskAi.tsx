'use client';
// components/hardware/AskAi.tsx — "Ask AI" chat tab; POSTs to /api/ask-hardware. Owned by W7.
import { useEffect, useRef, useState } from 'react';
import type { HardwareSpec, SetupPick } from '@/lib/contracts';
import { Gem, Icon } from '@/components/ui';
import { HardwareSpecSchema } from './spec';

export interface ChatMsg { role: 'user' | 'assistant'; content: string; ok?: boolean; err?: boolean }
export interface AskAiResult { reply: string; spec: HardwareSpec; picks: SetupPick[] }

const EXAMPLES = ['Gaming PC with an RTX 4090, 64GB DDR5 and a 2TB NVMe', 'Two DGX Sparks linked together', 'MacBook Pro M4 Max with 128GB'];
const MAX_MSGS = 12, MAX_CHARS = 2000;

export interface AskAiProps {
  msgs: ChatMsg[];
  setMsgs(m: ChatMsg[]): void;
  spec: HardwareSpec | null;
  onResult(r: AskAiResult): void;
  /** result line under the last reply */
  summary: { run: number; total: number; fast: string[] };
}

/** Only real turns go to the API: no error bubbles, at most 12, each ≤ 2,000 chars, starting with the person. */
function payload(hist: ChatMsg[]) {
  const turns = hist.filter(m => !m.err).map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) })).slice(-MAX_MSGS);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

export function AskAi({ msgs, setMsgs, spec, onResult, summary }: AskAiProps) {
  const [t, setT] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (msgs.length || busy) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (raw: string) => {
    const text = raw.trim().slice(0, MAX_CHARS);
    if (!text || busy) return;
    const hist: ChatMsg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(hist); setT(''); setBusy(true);
    try {
      const res = await fetch('/api/ask-hardware', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // a hand-typed spec outside the schema limits would 400 the whole request; send null instead
        body: JSON.stringify({ messages: payload(hist), currentSpec: spec && HardwareSpecSchema.safeParse(spec).success ? spec : null }),
      });
      const data = await res.json().catch(() => null) as (AskAiResult & { error?: string }) | null;
      if (!res.ok || !data || !data.spec) {
        const content = res.status === 429 ? 'Too many requests right now. Wait a moment, then send again.'
          : res.status === 503 ? 'Ask AI isn’t set up on this server yet. Use Pick devices or Enter specs instead.'
          : 'I couldn’t read that. Try naming the GPU or computer model and its memory.';
        setMsgs([...hist, { role: 'assistant', err: true, content }]);
      } else {
        onResult(data);
        setMsgs([...hist, { role: 'assistant', ok: true, content: String(data.reply || 'Specs updated.') }]);
      }
    } catch {
      setMsgs([...hist, { role: 'assistant', err: true, content: 'I couldn’t reach Atlas AI. Check your connection, then send again.' }]);
    }
    setBusy(false);
  };

  const lastAi = msgs.map(m => !!m.ok).lastIndexOf(true);
  return (
    <div className="rounded-2xl bg-soft border border-line p-3 flex flex-col">
      <div className="max-h-[26rem] min-h-[13rem] overflow-y-auto space-y-3 p-1" aria-live="polite">
        {!msgs.length && (
          <div className="p-2">
            <div className="flex items-center gap-2"><Gem kind="probe" size={28} /><p className="font-semibold">Describe your hardware in your own words.</p></div>
            <p className="text-sm text-mute mt-2">Model names are enough. Atlas AI fills in the specs; Atlas works out what runs.</p>
            <div className="flex flex-col gap-2 mt-4">
              {EXAMPLES.map(x => (
                <button key={x} type="button" onClick={() => send(x)} disabled={busy} className="text-left text-sm rounded-2xl border border-line bg-card px-4 py-3 hover:border-ink disabled:opacity-50">{x}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, j) => (
          <div key={j} className={`fade flex ${m.role === 'user' ? 'justify-end' : ''}`}>
            <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-ink text-bg' : m.err ? 'border border-current text-warn bg-card' : 'bg-card border border-line'}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {j === lastAi && (
                <p className="mt-2 pt-2 border-t border-line text-xs">
                  <span className="font-bold">{summary.run} of {summary.total} open models run.</span>
                  {summary.fast.length ? ` Full speed: ${summary.fast.join(', ')}.` : ' None fit fully in fast memory.'}
                </p>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex gap-1.5 p-2" role="status" aria-label="Atlas AI is thinking">
            {[0, 1, 2].map(k => <span key={k} className="h-2 w-2 rounded-full bg-acc dot" style={{ animationDelay: k * 150 + 'ms' }} />)}
          </div>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={e => { e.preventDefault(); send(t); }} className="flex gap-2 mt-2 items-end">
        <label htmlFor="ask" className="sr-only">Describe your hardware</label>
        <textarea id="ask" rows={2} value={t} maxLength={MAX_CHARS} onChange={e => setT(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(t); } }}
          placeholder="e.g. Ryzen 9 with two RTX 3090s and 128GB RAM" className="flex-1 resize-none rounded-2xl border border-line bg-card px-4 py-3 text-base" />
        <button type="submit" disabled={!t.trim() || busy} aria-label="Send" className="h-12 w-12 grid place-items-center rounded-full bg-acc text-onacc disabled:opacity-40">
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  );
}
