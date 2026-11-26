// lib/ai.ts — JSON chat against the configured AI provider (owned by W7). Server only.
// AI_PROVIDER=openai (default): any OpenAI-compatible Chat Completions endpoint via the `openai` package.
// AI_PROVIDER=anthropic: @anthropic-ai/sdk with the same AI_BASE_URL / AI_API_KEY / AI_MODEL.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { z } from 'zod';
import { RETRY_JSON } from './ai-prompts';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

/** Thrown for every provider / parse failure; `code` lets routes pick a status without leaking provider text. */
export class AiError extends Error {
  constructor(public code: 'not_configured' | 'provider' | 'bad_json', message: string) { super(message); }
}

const env = () => ({
  provider: (process.env.AI_PROVIDER ?? 'openai').toLowerCase(),
  baseURL: process.env.AI_BASE_URL || undefined,
  apiKey: process.env.AI_API_KEY,
  model: process.env.AI_MODEL,
});

export const aiConfigured = () => { const e = env(); return !!(e.apiKey && e.model); };

let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;

/** some OpenAI-compatible hosts reject response_format or the system role; remember what worked */
let noJsonMode = false;
let noSystemRole = false;

async function callOnce(system: string, messages: ChatMessage[]): Promise<string> {
  const e = env();
  if (!e.apiKey || !e.model) throw new AiError('not_configured', 'AI_API_KEY / AI_MODEL not set');
  if (e.provider === 'anthropic') {
    anthropic ??= new Anthropic({ apiKey: e.apiKey, baseURL: e.baseURL, maxRetries: 1, timeout: 30_000 });
    // this SDK version has no `temperature` param; the JSON-only instruction lives in the system prompt
    const r = await anthropic.messages.create({ model: e.model, max_tokens: 1500, system, messages });
    return r.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  }
  openai ??= new OpenAI({ apiKey: e.apiKey, baseURL: e.baseURL, maxRetries: 1, timeout: 30_000 });
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = noSystemRole
    ? messages.map((m, i) => (i === 0 ? { role: m.role, content: `${system}\n\n---\n\n${m.content}` } : m))
    : [{ role: 'system', content: system }, ...messages];
  try {
    const r = await openai.chat.completions.create({
      model: e.model, temperature: 0, max_tokens: 1500, messages: msgs,
      ...(noJsonMode ? {} : { response_format: { type: 'json_object' as const } }),
    });
    return r.choices[0]?.message?.content ?? '';
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 422) {
      // fall back once per capability, in this order: JSON mode, then the system role
      if (!noJsonMode) { noJsonMode = true; return callOnce(system, messages); }
      if (!noSystemRole) { noSystemRole = true; return callOnce(system, messages); }
    }
    throw new AiError('provider', `AI provider error${status ? ` (${status})` : ''}`);
  }
}

/** Tolerant JSON parse: strips code fences and takes the outermost {...}. */
export function parseJsonLoose(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  return undefined;
}

/**
 * Ask the model for a JSON object. Retries once with "Return valid JSON only" when the answer
 * isn't JSON (or doesn't pass `schema`, when given). Returns the parsed (and validated) value.
 */
export async function chatJson(system: string, messages: ChatMessage[]): Promise<unknown>;
export async function chatJson<T>(system: string, messages: ChatMessage[], schema: z.ZodType<T>): Promise<T>;
export async function chatJson<T>(system: string, messages: ChatMessage[], schema?: z.ZodType<T>): Promise<T | unknown> {
  const check = (text: string) => {
    const j = parseJsonLoose(text);
    if (j === undefined || typeof j !== 'object' || j === null) return { ok: false as const };
    if (!schema) return { ok: true as const, value: j };
    const r = schema.safeParse(j);
    return r.success ? { ok: true as const, value: r.data } : { ok: false as const };
  };
  const first = await callOnce(system, messages);
  const a = check(first);
  if (a.ok) return a.value;
  const second = await callOnce(system, [...messages, { role: 'assistant', content: first.slice(0, 4000) || '(empty)' }, { role: 'user', content: RETRY_JSON }]);
  const b = check(second);
  if (b.ok) return b.value;
  throw new AiError('bad_json', 'AI reply was not valid JSON');
}
