# atlas-probe

Measure your machine for Atlas, the personal map of AI models and the hardware they run on.
`atlas-probe` detects your GPU, memory and disk, can time two small models with **your own** llama.cpp,
and prints a profile you paste into Atlas's **Device test** page to see which open models run on your machine and how fast.

Requires Node.js 18 or newer. No install needed:

```sh
npx atlas-probe                 # detect hardware, print a summary and the profile JSON
npx atlas-probe --bench         # also time 2 small reference models with llama-bench
npx atlas-probe --bench --share # ...and share the measured speeds with Atlas
```

## Options

| Option | Does |
| --- | --- |
| *(none)* | Detect hardware; print a summary and the profile JSON |
| `--bench` | Download 2 small reference GGUFs once (cached in `~/.cache/atlas-probe`) and run `llama-bench` on each |
| `--model <repo>:<quant>` | Also benchmark that Hugging Face GGUF, e.g. `unsloth/Qwen3-8B-GGUF:Q4_K_M` (asks before downloads over 5 GB) |
| `--share` | POST the profile to `${ATLAS_URL}/api/runs` (or `--url`) |
| `--url <https://…>` | Atlas site to share with; the `ATLAS_URL` environment variable takes precedence |
| `--json` | Print only the JSON (for piping) |
| `-h`, `--help` / `-v`, `--version` | Help / version |

Reference models (about 3.1 GB in total, downloaded once):

- `Qwen/Qwen2.5-1.5B-Instruct-GGUF` Q4_K_M (1.1 GB)
- `bartowski/Llama-3.2-3B-Instruct-GGUF` Q4_K_M (2.0 GB)

## Benchmarking needs llama.cpp

`--bench` uses the `llama-bench` tool from llama.cpp, so the speeds are what *your* build gets.

- macOS: `brew install llama.cpp`
- Linux / Windows: download a release for your GPU from <https://github.com/ggml-org/llama.cpp/releases> and put `llama-bench` on your `PATH`
  (or set `LLAMA_BENCH` to its full path).

Without it, `--bench` prints this hint and you still get a detect-only profile.

Each file runs `llama-bench -m <file> -p 512 -n 128 -r 3 -o json`. From the reference models' known sizes:

- effective bandwidth (GB/s) = generation tok/s × active parameters (billions) × bits per weight ÷ 8
- effective FP16 TFLOPS = prompt tok/s × 2 × active parameters ÷ 0.3 ÷ 10¹²

Without `--bench`, bandwidth and compute come from a small table of known devices, or a typical value; the summary labels every number
as *measured*, *spec sheet*, *reported* or *assumed*.

## Detection

| Platform | How |
| --- | --- |
| NVIDIA (Linux, Windows) | `nvidia-smi --query-gpu=name,memory.total,pci.link.gen.current` |
| AMD (Linux) | `rocm-smi --showproductname --showmeminfo vram --json` |
| Apple Silicon | `sysctl`, `system_profiler` (machine name, chip, memory only); unified memory, Metal |
| DGX Spark, Ryzen AI Max, Jetson | GPU or chip name → unified memory from `/proc/meminfo` |
| Anything else | CPU only |

System RAM bandwidth is measured with a short multi-threaded memory copy. Free disk is read from the volume holding
`~/.cache/atlas-probe`; disk read speed is timed on a cached reference file (approximate).

## Privacy

The profile holds the device model, memory and speed numbers, file names of the models timed, and a random id stored in
`~/.config/atlas-probe/id` (used only to rate-limit shares). It never contains files, paths, hostnames or user names, and nothing
leaves your machine unless you pass `--share`.

## Profile JSON

```json
{
  "probe_version": "1.0.0",
  "device_name_raw": "NVIDIA GB10",
  "arch": "unified", "devices": 1,
  "vram_gb": 0, "memory_gb": 128,
  "measured_bw_gbs": 251, "ram_bw_gbs": 251, "fp16_tflops": 118, "fp8": true,
  "backend": "cuda", "disk_free_gb": 2800, "disk_read_gbs": 6.1,
  "fingerprint": "<random uuid>",
  "runs": [ { "file": "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL", "runtime": "llama.cpp", "runtime_version": "b6123", "ctx": 4096, "gen_tps": 9.6, "prompt_tps": 640, "load_s": 3.1 } ]
}
```

## License

MIT
