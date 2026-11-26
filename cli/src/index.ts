#!/usr/bin/env node
// atlas-probe: detect hardware, optionally benchmark with llama.cpp, print an Atlas profile, optionally share runs.
import { ensureModel, ensureReference, findLlamaBench, installHint, runLlamaBench, toRun } from './bench.js';
import { CACHE_LABEL, ID_LABEL, PROBE_VERSION, isPlaceholderUrl } from './config.js';
import type { Valued } from './detect/common.js';
import { detectHardware, remeasureDiskRead } from './detect/index.js';
import { fingerprint, round, type Profile, type ProfileRun } from './profile.js';
import { REFERENCE_MODELS, effectiveBandwidth, effectiveTflops } from './reference.js';
import { share, shareBase } from './share.js';

interface Args { bench: boolean; model?: string; share: boolean; json: boolean; url?: string; help: boolean; version: boolean }

const HELP = `atlas-probe ${PROBE_VERSION}: measure your machine for Atlas

Usage: npx atlas-probe [options]

  (no options)             Detect hardware; print a summary and the profile JSON
  --bench                  Also download 2 small reference GGUFs once (cached in ${CACHE_LABEL})
                           and time them with your llama-bench
  --model <repo>:<quant>   Also benchmark that Hugging Face GGUF (asks before downloads over 5 GB)
  --share                  POST the profile to \${ATLAS_URL or --url}/api/runs
  --url <https://...>      Atlas site to share with (ATLAS_URL takes precedence)
  --json                   Print only the JSON (for piping)
  -h, --help               Show this help
  -v, --version            Print the version

Paste the JSON into Atlas's Device test page to see what runs on this machine.
Sharing sends only the device model, file names and speeds plus a random id from ${ID_LABEL};
never files, paths, hostnames or user names.`;

function parseArgs(argv: string[]): Args {
  const a: Args = { bench: false, share: false, json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') && argv[i].includes('=') ? [argv[i].slice(0, argv[i].indexOf('=')), argv[i].slice(argv[i].indexOf('=') + 1)] : [argv[i], undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--bench': a.bench = true; break;
      case '--share': a.share = true; break;
      case '--json': a.json = true; break;
      case '--model': a.model = value(); break;
      case '--url': a.url = value(); break;
      case '-h': case '--help': a.help = true; break;
      case '-v': case '--version': a.version = true; break;
      default: throw new Error(`Unknown option ${argv[i]}`);
    }
  }
  if (a.model && !/^[^\s:/]+\/[^\s:]+:[^\s:]+$/.test(a.model)) throw new Error('--model must look like <owner>/<repo>:<quant>, e.g. unsloth/Qwen3-8B-GGUF:Q4_K_M');
  return a;
}

const err = (s: string) => process.stderr.write(s + '\n');
const fmt = (v: Valued, unit: string) => `${v.value} ${unit} (${v.basis})`;

function summary(p: Profile, hw: { bw: Valued; ramBw: Valued; tflops: Valued; diskFree: Valued; diskRead: Valued }, benched: boolean): string {
  const backend = { cuda: 'CUDA', rocm: 'ROCm', metal: 'Metal', vulkan: 'Vulkan', cpu: 'CPU' }[p.backend];
  const kind = p.arch === 'discrete' ? 'graphics card' + (p.devices > 1 ? 's' : '') : p.arch === 'unified' ? 'shared-memory system' : 'CPU only';
  const lines = [
    `atlas-probe ${p.probe_version}`,
    '',
    `  Device       ${p.device_name_raw}${p.arch === 'discrete' ? ` x ${p.devices} (${p.vram_gb} GB each)` : ''}`,
    `  Type         ${kind} · ${backend} · FP8 ${p.fp8 ? 'yes' : 'no'}`,
    `  Memory       ${p.memory_gb} GB ${p.arch === 'unified' ? 'shared' : 'system RAM'}${p.arch === 'unified' ? '' : ` · ${fmt(hw.ramBw, 'GB/s')}`}`,
    `  Bandwidth    ${fmt(hw.bw, 'GB/s')}`,
    `  Compute      ${fmt(hw.tflops, 'FP16 TFLOPS')}`,
    `  Disk         ${hw.diskFree.value} GB free (${hw.diskFree.basis}) · ${fmt(hw.diskRead, 'GB/s read')}`,
  ];
  if (!p.runs.length) lines.push(`  Runs         none${benched ? '' : ' (add --bench to time two small models)'}`);
  else {
    lines.push('  Runs');
    for (const r of p.runs) lines.push(`    ${r.file}  ${r.gen_tps} tok/s generate${r.prompt_tps != null ? ` · ${r.prompt_tps} tok/s prompt` : ''}${r.runtime_version ? ` · llama.cpp ${r.runtime_version}` : ''}`);
  }
  if (hw.bw.basis !== 'measured' && p.arch !== 'cpu') lines.push('', '  Bandwidth and compute are not measured yet; run with --bench for real numbers.');
  return lines.join('\n');
}

async function main(): Promise<number> {
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { err(`${(e as Error).message}\n\nRun atlas-probe --help for usage.`); return 2; }
  if (args.help) { process.stdout.write(HELP + '\n'); return 0; }
  if (args.version) { process.stdout.write(PROBE_VERSION + '\n'); return 0; }

  if (!args.json) err('Reading GPU, memory and disk...');
  const hw = await detectHardware();
  const runs: ProfileRun[] = [];
  let benched = false, code = 0;

  if (args.bench || args.model) {
    const lb = await findLlamaBench(); // check before any download
    if (!lb) {
      err(installHint());
      err('Continuing with a detect-only profile.');
    } else {
      benched = true;
      const bws: number[] = [], tfs: number[] = [];
      if (args.bench) {
        for (const r of REFERENCE_MODELS) {
          try {
            const path = await ensureReference(r);
            err(`Timing ${r.repo}:${r.quant} with llama-bench (${3} runs)...`);
            const res = await runLlamaBench(lb, path);
            runs.push(toRun(`${r.repo}:${r.quant}`, res));
            bws.push(effectiveBandwidth(res.genTps, r));
            if (res.promptTps != null) tfs.push(effectiveTflops(res.promptTps, r));
          } catch (e) { err(`  ${(e as Error).message}`); code = 1; }
        }
      }
      if (args.model) {
        const i = args.model.lastIndexOf(':'), repo = args.model.slice(0, i), quant = args.model.slice(i + 1);
        try {
          const path = await ensureModel(repo, quant);
          if (path) {
            err(`Timing ${repo}:${quant} with llama-bench...`);
            runs.push(toRun(`${repo}:${quant}`, await runLlamaBench(lb, path)));
          }
        } catch (e) { err(`  ${(e as Error).message}`); code = 1; }
      }
      if (bws.length) {
        hw.bw = { value: Math.round(Math.max(...bws)), basis: 'measured' };
        if (hw.arch !== 'discrete') hw.ramBw = hw.bw;
      }
      if (tfs.length) hw.tflops = { value: round(Math.max(...tfs), 1), basis: 'measured' };
      const read = await remeasureDiskRead();
      if (read) hw.diskRead = read;
    }
  }

  const profile: Profile = {
    probe_version: PROBE_VERSION,
    device_name_raw: hw.name,
    arch: hw.arch,
    devices: hw.devices,
    vram_gb: hw.vramGb,
    memory_gb: hw.memoryGb,
    measured_bw_gbs: hw.bw.value,
    ram_bw_gbs: hw.ramBw.value,
    fp16_tflops: hw.tflops.value,
    fp8: hw.fp8,
    backend: hw.backend,
    disk_free_gb: hw.diskFree.value,
    disk_read_gbs: hw.diskRead.value,
    fingerprint: await fingerprint(),
    runs,
  };

  const json = JSON.stringify(profile, null, 2);
  if (args.json) process.stdout.write(json + '\n');
  else process.stdout.write(`${summary(profile, hw, benched)}\n\nProfile (paste into Atlas > Device test):\n${json}\n`);

  if (args.share) {
    const base = shareBase(args.url);
    if (isPlaceholderUrl(base)) {
      err('Not shared: no Atlas site is configured in this build. Set ATLAS_URL=https://<your atlas site> or pass --url https://<your atlas site>.');
      code = 1;
    } else if (!runs.length) {
      err('Nothing to share yet: no runs were timed. Run with --bench (needs llama-bench) to share speeds.');
    } else {
      try {
        const r = await share(profile, base);
        err(`Shared: ${r.accepted} run${r.accepted === 1 ? '' : 's'} accepted${r.rejected.length ? `, ${r.rejected.length} rejected` : ''}.`);
        for (const x of r.rejected) err(`  ${x.file}: ${x.reason}`);
      } catch (e) { err(`Share failed. ${(e as Error).message}`); code = 1; }
    }
  }
  return code;
}

main().then(c => { process.exitCode = c; }, e => { err(`atlas-probe: ${(e as Error).message ?? e}`); process.exitCode = 1; });
