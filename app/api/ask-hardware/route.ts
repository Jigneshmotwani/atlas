// /api/ask-hardware — turn a hardware description into a HardwareSpec (owned by W7). Flow: SPEC "API routes".
import { z } from 'zod';
import type { Device, HardwareSpec, SetupPick } from '@/lib/contracts';
import { loadDeviceAliases, loadDevices } from '@/lib/data';
import { specFromPicks } from '@/lib/engine';
import { AiError, chatJson } from '@/lib/ai';
import { askHardwareSystem } from '@/lib/ai-prompts';
import { rankBySimilarity } from '@/lib/trigram';
import { ARCHS, BACKENDS, HardwareSpecSchema, LINKS } from '@/components/hardware/spec';
import { BLANK_SPEC } from '@/lib/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const err = (error: string, status: number) => Response.json({ error }, { status });

// ---- request ---------------------------------------------------------------
const Body = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) })).min(1).max(12),
  currentSpec: HardwareSpecSchema.nullable(),
});

// ---- 10 requests / minute / IP (in-memory; per server instance) ------------
const WINDOW_MS = 60_000, LIMIT = 10;
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (list.length >= LIMIT) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  return false;
}
const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';

// ---- AI answer (lenient: coerce, default, then clamp) -----------------------
const Num = z.preprocess(v => (v == null || v === '' ? undefined : typeof v === 'string' ? parseFloat(v) : v), z.number().finite().optional()).catch(undefined);
const AiAnswer = z.object({
  reply: z.coerce.string().catch(''),
  spec: z.object({
    arch: z.enum(ARCHS).optional().catch(undefined), gpus: Num, vramGb: Num, gpuBwGbs: Num, link: z.enum(LINKS).optional().catch(undefined),
    ramGb: Num, ramBwGbs: Num, fp16Tflops: Num, fp8: z.boolean().optional().catch(undefined), backend: z.enum(BACKENDS).optional().catch(undefined),
    diskFreeGb: Num, diskReadGbs: Num,
  }).catch({}),
  picks: z.array(z.object({ deviceId: z.coerce.string(), qty: z.coerce.number().catch(1) })).catch([]),
});
type AiAnswer = z.infer<typeof AiAnswer>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function cleanSpec(a: AiAnswer['spec'], base: HardwareSpec): HardwareSpec {
  const arch = a.arch ?? base.arch;
  const gpus = Math.round(clamp(a.gpus ?? base.gpus, 1, 64));
  const gpuBwGbs = clamp(a.gpuBwGbs ?? base.gpuBwGbs, 10, 10_000);
  return {
    arch, gpus,
    // the prompt asks for vramGb 0 on unified machines, so the 1–512 clamp only applies to discrete cards
    vramGb: arch === 'discrete' ? clamp(a.vramGb ?? base.vramGb, 1, 512) : clamp(a.vramGb ?? 0, 0, 512),
    gpuBwGbs, link: gpus < 2 ? 'none' : a.link && a.link !== 'none' ? a.link : arch === 'unified' ? 'network' : 'pcie',
    ramGb: clamp(a.ramGb ?? base.ramGb, 1, 4096),
    ramBwGbs: clamp(a.ramBwGbs ?? (arch === 'unified' ? gpuBwGbs : base.ramBwGbs), 10, 10_000),
    fp16Tflops: clamp(a.fp16Tflops ?? base.fp16Tflops, 0, 100_000),
    fp8: a.fp8 ?? base.fp8,
    backend: a.backend ?? (arch === 'cpu' ? 'cpu' : base.backend),
    diskFreeGb: clamp(a.diskFreeGb ?? 1000, 1, 1_000_000),
    diskReadGbs: clamp(a.diskReadGbs ?? base.diskReadGbs, 0.05, 20),
  };
}

// ---- candidate devices: trigram match of word groups in the last user message ---
const SPLIT = /[,;:\n/()+&]|\s(?:and|with|plus|or|in|on|of|a|an|the|my|two|three|four|x|\d+x)\s/gi;
function wordGroups(text: string): string[] {
  const parts = text.split(SPLIT).map(s => s.trim()).filter(s => s.length >= 2);
  const groups = new Set<string>(parts);
  // also every 1–3 word window, so "rtx 4090 64gb ddr5" still finds "RTX 4090"
  for (const p of parts) {
    const w = p.split(/\s+/);
    for (let size = 1; size <= 3; size++) for (let i = 0; i + size <= w.length; i++) groups.add(w.slice(i, i + size).join(' '));
  }
  return [...groups].filter(g => g.length >= 2).slice(0, 60);
}

function candidates(text: string, devices: Device[], aliases: Map<string, string[]>): Device[] {
  const names = (d: Device) => [d.name, ...(aliases.get(d.id) ?? [])];
  const best = new Map<string, number>();
  for (const g of wordGroups(text)) {
    for (const { item, score } of rankBySimilarity(g, devices, names, { min: 0.15, limit: 50 })) {
      if (score > (best.get(item.id) ?? 0)) best.set(item.id, score);
    }
  }
  const byId = new Map(devices.map(d => [d.id, d]));
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([id]) => byId.get(id)!).filter(Boolean);
}

const deviceLine = (d: Device) =>
  `${d.id}: ${d.name} (${d.type === 'gpu' ? 'GPU card' : d.type === 'unified' ? 'unified-memory system' : 'CPU'}, ${d.memGb} GB, ${d.bwGbs} GB/s, ${d.fp16Tflops ?? '?'} FP16 TFLOPS, FP8 ${d.fp8 ? 'yes' : 'no'}, ${d.backend})`;

export async function POST(req: Request) {
  if (limited(clientIp(req))) return err('Too many requests right now. Wait a moment, then send again.', 429);
  let raw: unknown;
  try { raw = await req.json(); } catch { return err('Body must be JSON', 400); }
  const body = Body.safeParse(raw);
  if (!body.success) return err('Invalid request: up to 12 messages of at most 2,000 characters each.', 400);
  const { messages, currentSpec } = body.data;
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return err('Send a message describing your hardware.', 400);

  const [devices, aliasRows] = await Promise.all([loadDevices(), loadDeviceAliases()]);
  const aliases = new Map(aliasRows.map(a => [a.id, a.aliases]));
  const cands = candidates(lastUser.content, devices, aliases);
  const system = askHardwareSystem(cands.map(deviceLine), currentSpec);

  let answer: AiAnswer;
  try {
    answer = await chatJson(system, messages, AiAnswer);
  } catch (e) {
    const code = e instanceof AiError ? e.code : 'provider';
    console.warn('[api/ask-hardware] AI call failed:', code);
    if (code === 'not_configured') return err('Ask AI is not set up on this server.', 503);
    if (code === 'bad_json') return err('The AI reply could not be read.', 502);
    return err('The AI provider did not answer.', 502);
  }

  let spec = cleanSpec(answer.spec, currentSpec ?? BLANK_SPEC);
  const known = new Set(devices.map(d => d.id));
  const picks: SetupPick[] = [];
  for (const p of answer.picks) {
    const qty = Math.round(clamp(Number.isFinite(p.qty) ? p.qty : 1, 1, 64));
    if (!known.has(p.deviceId)) continue;
    const prev = picks.find(x => x.deviceId === p.deviceId);
    if (prev) prev.qty = qty; else picks.push({ deviceId: p.deviceId, qty });
  }
  if (picks.length) {
    const rebuilt = specFromPicks(picks, devices, { ramGb: spec.ramGb, ramBwGbs: spec.ramBwGbs, diskFreeGb: spec.diskFreeGb, diskReadGbs: spec.diskReadGbs });
    if (rebuilt) spec = rebuilt;
  }
  const reply = answer.reply.trim().slice(0, 1200) || 'Specs updated.';
  return Response.json({ reply, spec, picks });
}
