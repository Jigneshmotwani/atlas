#!/usr/bin/env bash
# scripts/measure-kld.sh — manual KLD measurement on the DGX Spark (W4). Appends one row to data/kld/atlas.csv.
#
#   scripts/measure-kld.sh <bf16-repo> <bf16-gguf-glob> <quant-repo> <quant>
#   e.g. scripts/measure-kld.sh unsloth/Qwen3.8-27B-GGUF 'BF16/*.gguf' unsloth/Qwen3.8-27B-GGUF UD-Q4_K_XL
#
# Needs: llama.cpp built with CUDA (llama-perplexity on PATH), huggingface-cli (pip install -U "huggingface_hub[cli]"),
# python3 with `datasets` (only to build the eval text once), ~2× the BF16 size of free disk.
# Recipe (see data/kld/eval-set.txt): wikitext-2-raw test, -c 2048, --chunks 60, BF16 logits as the base.
set -euo pipefail

BASE_REPO=${1:?bf16 repo}; BASE_GLOB=${2:?bf16 gguf glob}; Q_REPO=${3:?quant repo}; QUANT=${4:?quant name}
WORK=${ATLAS_KLD_DIR:-$HOME/.cache/atlas-kld}
CTX=2048; CHUNKS=60; EVAL_SET=atlas-v1
ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$WORK"
EVAL="$WORK/eval-wikitext2.txt"

# 1. eval text (built locally, never committed)
if [ ! -s "$EVAL" ]; then
  python3 - "$EVAL" <<'PY'
import sys
from datasets import load_dataset
ds = load_dataset("Salesforce/wikitext", "wikitext-2-raw-v1", split="test")
open(sys.argv[1], "w", encoding="utf-8").write("".join(ds["text"]))
PY
fi

# 2. download BF16 + quant GGUFs
huggingface-cli download "$BASE_REPO" --include "$BASE_GLOB" --local-dir "$WORK/base/$BASE_REPO"
huggingface-cli download "$Q_REPO" --include "*${QUANT}*.gguf" --local-dir "$WORK/q/$Q_REPO"
BASE_GGUF=$(find "$WORK/base/$BASE_REPO" -name '*.gguf' ! -name '*mmproj*' | sort | head -1)       # first split part
Q_GGUF=$(find "$WORK/q/$Q_REPO" -name "*${QUANT}*.gguf" ! -name '*mmproj*' | sort | head -1)
[ -n "$BASE_GGUF" ] && [ -n "$Q_GGUF" ] || { echo "GGUF not found"; exit 1; }

# 3. BF16 logits once per base model (large: ~vocab × tokens × 2 bytes)
LOGITS="$WORK/logits-$(echo "$BASE_REPO" | tr / _).bin"
if [ ! -s "$LOGITS" ]; then
  llama-perplexity -m "$BASE_GGUF" -f "$EVAL" -c "$CTX" --chunks "$CHUNKS" -ngl 99 --kl-divergence-base "$LOGITS"
fi

# 4. quant vs base
OUT="$WORK/kld-$(echo "$Q_REPO" | tr / _)-$QUANT.txt"
llama-perplexity -m "$Q_GGUF" -f "$EVAL" -c "$CTX" --chunks "$CHUNKS" -ngl 99 --kl-divergence --kl-divergence-base "$LOGITS" 2>&1 | tee "$OUT"
KLD=$(grep -E '^Mean +KLD:' "$OUT" | tail -1 | awk '{print $3}')
[ -n "$KLD" ] || { echo "could not parse Mean KLD from $OUT"; exit 1; }
BUILD=$(llama-perplexity --version 2>&1 | grep -oE 'version: [0-9]+ \([0-9a-f]+\)' | head -1 | tr -d '()' | awk '{print "b"$2"-"$3}')

# 5. append the CSV row (repo,quant,kld,eval_set,source,source_ref); then: pnpm exec tsx scripts/import-kld.ts
echo "$Q_REPO,$QUANT,$KLD,$EVAL_SET,atlas,llama.cpp ${BUILD:-unknown} $(date -u +%F) DGX Spark c$CTX x$CHUNKS" >> "$ROOT/data/kld/atlas.csv"
echo "KLD $KLD appended to data/kld/atlas.csv"
