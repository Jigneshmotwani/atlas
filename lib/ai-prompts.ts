// lib/ai-prompts.ts — prompts for /api/ask-hardware (owned by W7). Copy is verbatim from SPEC "API routes".

export const ASK_HARDWARE_SYSTEM = `You turn a person's description of their computer(s) into specs for an LLM hardware-fit calculator.
Return JSON only: {"reply": string, "spec": HardwareSpec, "picks": [{"deviceId": string, "qty": number}]}.
reply: 2-3 plain sentences: what you understood, what you assumed, and one question only if something important is missing.
picks: catalog devices you are confident the person owns, using ids from the list below; [] if none.
spec fields: arch ("discrete" PC with graphics cards | "unified" shared-memory system like Mac or DGX Spark | "cpu"),
gpus, vramGb (per GPU, 0 for unified), gpuBwGbs (slowest device), link ("none"|"pcie"|"nvlink"|"network"),
ramGb (unified: total across devices), ramBwGbs (DDR5 dual channel ~90, DDR4 ~50; unified = gpuBwGbs),
fp16Tflops (total), fp8, backend ("cuda"|"rocm"|"metal"|"vulkan"|"cpu"), diskFreeGb (default 1000), diskReadGbs (NVMe 5, SATA SSD 0.5, HDD 0.15).
Fill unknowns with typical values and say which you assumed.
Catalog devices: {{DEVICE_LINES}}
Current spec: {{CURRENT_SPEC}}`;

/** Sent as an extra user turn when the first answer was not valid JSON. */
export const RETRY_JSON = 'Return valid JSON only';

export function askHardwareSystem(deviceLines: string[], currentSpec: unknown): string {
  return ASK_HARDWARE_SYSTEM
    .replace('{{DEVICE_LINES}}', deviceLines.length ? '\n' + deviceLines.join('\n') : '(none)')
    .replace('{{CURRENT_SPEC}}', JSON.stringify(currentSpec ?? null));
}
