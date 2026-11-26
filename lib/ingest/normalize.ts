// lib/ingest/normalize.ts — model-name normalisation and creator resolution (W4). Pure, no I/O.

/** Effort / mode tags that distinguish model variants; kept (as a suffix) by normalizeName. */
export const EFFORT_TAGS = new Set(['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none', 'reasoning', 'non-reasoning', 'thinking', 'non-thinking']);

/** Parenthesised parts that never distinguish a model: release notes, dates, "based on …", tiers. */
const DROP_PAREN = /^(default fallback|preview|beta|alpha|free|batch|exp(erimental)?|latest|older.*|based on .*|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s*'?\s*\d{2,4}|\d{4}-\d{2}(-\d{2})?|\d{2}-\d{4}|\d{4,8})$/i;
const DROP_TOKENS = new Set(['instruct', 'chat', 'latest']);

const slugTokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const isMonth = (t: string) => /^\d{2}$/.test(t) && +t >= 1 && +t <= 12;
const isDay = (t: string) => /^\d{2}$/.test(t) && +t >= 1 && +t <= 31;

/** Generic slug: lowercase alphanumerics joined by '-'. Matches `slug()` in lib/sample-data. */
export const slugify = (s: string) => slugTokens(s).join('-');

/**
 * SPEC "normalizeName": lowercase; strip creator prefix (`anthropic/`, `openai:`, `OpenAI: `); drop date stamps
 * (`-2026-05-14`, `-20261120`, `-0514`), `instruct`, `chat`, `latest`, `(preview)`; collapse spaces, dots and dashes;
 * effort tags in parentheses like `(Max)` become a `-max` suffix. Result is slug-shaped: `claude-opus-5-5-max`.
 */
export function normalizeName(input: string): string {
  let s = input.trim();
  s = s.replace(/^~/, '');
  if (/^[\w.~-]+\/[\w.~:-]+$/.test(s)) s = s.slice(s.indexOf('/') + 1);   // author/slug
  s = s.replace(/^[^:/()]{1,40}:\s+/, '');                                  // "OpenAI: GPT-6"
  s = s.replace(/^([a-z0-9-]{2,30}):(?=[a-z0-9])/i, (m, p: string) => (creatorIdFor(p) ? '' : m)); // "openai:gpt-6"
  s = s.replace(/:(free|batch|beta|extended|thinking|online|nitro|floor|exacto)$/i, '');
  const effort: string[] = [], keep: string[] = [];
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    for (const part of inner.split(',').map(p => p.trim()).filter(Boolean)) {
      const p = part.toLowerCase();
      if (EFFORT_TAGS.has(p)) effort.push(p);
      else if (!DROP_PAREN.test(p)) keep.push(p);
    }
    return ' ';
  });
  let t = slugTokens(s);
  // trailing ISO date 2026-05-14 → drop
  if (t.length > 3 && /^(19|20)\d{2}$/.test(t[t.length - 3]) && isMonth(t[t.length - 2]) && isDay(t[t.length - 1])) t = t.slice(0, -3);
  t = t.filter((x, i) => !DROP_TOKENS.has(x) && !(i > 0 && /^20\d{6}$/.test(x)));
  // trailing mmdd stamp (-0514); keeps yymm versions like -2507
  const last = t[t.length - 1];
  if (t.length > 1 && last && /^\d{4}$/.test(last) && isMonth(last.slice(0, 2)) && isDay(last.slice(2))) t = t.slice(0, -1);
  if (t.length > 2 && t[t.length - 1] === 'it') t = t.slice(0, -1);   // gemma-…-it (instruction-tuned)
  const out = [...t, ...keep.flatMap(slugTokens), ...effort.flatMap(slugTokens)];
  return out.join('-');
}

/** Drop trailing effort tags: `gemini-4-carbon-high` → `gemini-4-carbon`. */
export function stripEffort(norm: string): string {
  const t = norm.split('-');
  while (t.length > 1) {
    const two = t.slice(-2).join('-');
    if (EFFORT_TAGS.has(two)) t.splice(-2);
    else if (EFFORT_TAGS.has(t[t.length - 1])) t.pop();
    else break;
  }
  return t.join('-');
}

/** Display name without "Default Fallback"-style notes: "Claude Opus 5.5 (Max, Default Fallback)" → "Claude Opus 5.5 (Max)". */
export function cleanDisplayName(name: string): string {
  return name.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const parts = inner.split(',').map(p => p.trim()).filter(p => p && !/^default fallback$/i.test(p));
    return parts.length ? `(${parts.join(', ')})` : '';
  }).replace(/^[^:/()]{1,40}:\s+/, '').replace(/\s{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------- creators
/** External creator spellings (OpenRouter author, AA / Arena / Epoch organisation) → seed creator id (slug of the name). */
const CREATOR_ALIASES: Record<string, string> = {
  openai: 'openai', anthropic: 'anthropic', google: 'google', googledeepmind: 'google', deepmind: 'google', googleai: 'google',
  meta: 'meta', metallama: 'meta', facebook: 'meta', metaai: 'meta',
  mistral: 'mistral', mistralai: 'mistral', deepseek: 'deepseek', deepseekai: 'deepseek',
  qwen: 'alibaba', alibaba: 'alibaba', alibabacloud: 'alibaba', alibabaqwen: 'alibaba',
  moonshotai: 'moonshot-ai', moonshot: 'moonshot-ai', kimi: 'moonshot-ai',
  xai: 'xai', spacexai: 'xai', microsoft: 'microsoft', nvidia: 'nvidia', amazon: 'amazon', aws: 'amazon', amazonnova: 'amazon',
  cohere: 'cohere', cohereforai: 'cohere', coherelabs: 'cohere', ai21: 'ai21-labs', ai21labs: 'ai21-labs', ibm: 'ibm', ibmgranite: 'ibm',
  zai: 'zhipu-ai', zhipu: 'zhipu-ai', zhipuai: 'zhipu-ai', thudm: 'zhipu-ai', zaiorg: 'zhipu-ai',
  minimax: 'minimax', minimaxai: 'minimax', baidu: 'baidu', tencent: 'tencent', bytedance: 'bytedance', bytedanceseed: 'bytedance',
  stepfun: 'stepfun', stepfunai: 'stepfun', '01ai': '01-ai', yi: '01-ai', lgai: 'lg-ai-research', lgairesearch: 'lg-ai-research', lgaiexaone: 'lg-ai-research',
  upstage: 'upstage', reka: 'reka', rekaai: 'reka', liquid: 'liquid-ai', liquidai: 'liquid-ai',
  ai2: 'ai2', allenai: 'ai2', alleninstituteforai: 'ai2', nousresearch: 'nous-research', perplexity: 'perplexity',
  snowflake: 'snowflake', databricks: 'databricks', servicenow: 'servicenow', salesforce: 'salesforce', apple: 'apple',
  xiaomi: 'xiaomi', xiaomimimo: 'xiaomi', meituan: 'meituan', kuaishou: 'kuaishou', kwaipilot: 'kuaishou', sarvam: 'sarvam-ai', sarvamai: 'sarvam-ai',
  tii: 'tii', tiiuae: 'tii', stabilityai: 'stability-ai', inception: 'inception', inceptionlabs: 'inception',
  arcee: 'arcee-ai', arceeai: 'arcee-ai', deepcogito: 'deep-cogito', swissai: 'swiss-ai', kakao: 'kakao', naver: 'naver',
  primeintellect: 'prime-intellect', essentialai: 'essential-ai',
  zaizhipuai: 'zhipu-ai', microsoftresearch: 'microsoft', technologyinnovationinstitute: 'tii', mistralaisas: 'mistral', moonshotaikimi: 'moonshot-ai',
};
const creatorKey = (s: string) => s.toLowerCase().replace(/^~/, '').split(',')[0].replace(/[^a-z0-9]/g, '');

/** Seed creator id for an external creator spelling, or null when unknown. */
export function creatorIdFor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return CREATOR_ALIASES[creatorKey(raw)] ?? null;
}
