// The two small reference GGUFs `--bench` times. Their numbers are known, so a generation speed turns
// into an effective memory bandwidth and a prompt speed into effective FP16 compute (SPEC Benchmark).
// Checked against the public Hugging Face API on 2026-11-24 (file sizes and parameter counts below).

export interface ReferenceModel {
  repo: string;
  quant: string;
  file: string;
  url: string;
  sizeBytes: number;
  /** active parameters, billions (dense models: all of them) */
  activeParamsB: number;
  /** file size x 8 / total parameters */
  bitsPerWeight: number;
}

const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

export const REFERENCE_MODELS: ReferenceModel[] = [
  {
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF', quant: 'Q4_K_M', file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: hf('Qwen/Qwen2.5-1.5B-Instruct-GGUF', 'qwen2.5-1.5b-instruct-q4_k_m.gguf'),
    sizeBytes: 1_117_320_736, activeParamsB: 1.5437, bitsPerWeight: 5.79,       // 1,543,714,304 params
  },
  {
    repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', quant: 'Q4_K_M', file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    url: hf('bartowski/Llama-3.2-3B-Instruct-GGUF', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
    sizeBytes: 2_019_377_696, activeParamsB: 3.2127, bitsPerWeight: 5.03,       // 3,212,749,824 params
  },
];

/** GB read per generated token: active params (billions) x bits / 8. */
export const gbPerToken = (r: { activeParamsB: number; bitsPerWeight: number }) => r.activeParamsB * r.bitsPerWeight / 8;
/** Effective bandwidth (GB/s) = generation tok/s x GB per token. */
export const effectiveBandwidth = (genTps: number, r: ReferenceModel) => genTps * gbPerToken(r);
/** Effective FP16 TFLOPS = prompt tok/s x 2 x active params / 0.3 / 1e12 (0.3 = prefill efficiency). */
export const effectiveTflops = (promptTps: number, r: ReferenceModel) => promptTps * 2 * r.activeParamsB * 1e9 / 0.3 / 1e12;
