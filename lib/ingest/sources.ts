// lib/ingest/sources.ts — every external data source: URL, how we use it, and its terms (W4).
// Checked 24–26 Nov 2026. Atlas is a private, single-owner tool: data is shown to its owner only, with attribution
// (footer credits each source). If a source's terms change to forbid this, set `enabled: false` and the job skips.

export interface SourceInfo {
  id: string; name: string; enabled: boolean;
  urls: Record<string, string>;
  attribution: string;
  terms: string;
  termsUrl: string;
}

export const SOURCES = {
  openrouter: {
    id: 'openrouter', name: 'OpenRouter', enabled: true,
    urls: {
      models: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      endpointsBase: 'https://openrouter.ai', // + model.links.details (= /api/v1/models/{author}/{slug}/endpoints)
    },
    attribution: 'Prices, providers and context: OpenRouter (openrouter.ai)',
    terms: 'Public model-listing API, no key needed. Credit OpenRouter as the source; no redistribution of bulk data.',
    termsUrl: 'https://openrouter.ai/terms',
  },
  aa: {
    id: 'aa', name: 'Artificial Analysis', enabled: true,
    urls: { models: 'https://artificialanalysis.ai/api/v2/language/models/free', openapi: 'https://artificialanalysis.ai/api/v2/openapi' },
    attribution: 'Benchmarks, speed and prices: Artificial Analysis (https://artificialanalysis.ai/)',
    terms: 'Free tier: 100 requests / 24 h window per key (x-api-key header), paginated 200 models per page (~4 calls/day). '
      + 'Attribution required on every display ("a visible byline or footer link is sufficient"); use subject to the AA Terms of Use '
      + 'and Data Platform Terms; redistribution needs a separate agreement → Atlas stays private (SPEC "no public sharing of AA numbers").',
    termsUrl: 'https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf',
  },
  arena: {
    id: 'arena', name: 'Arena (LMArena)', enabled: true,
    urls: {
      dataset: 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset',
      rows: 'https://datasets-server.huggingface.co/filter?dataset=lmarena-ai/leaderboard-dataset&config=text_style_control&split=latest',
    },
    attribution: 'Arena text leaderboard (style control): LMArena, lmarena-ai/leaderboard-dataset, CC BY 4.0',
    terms: 'Official leaderboard snapshots published by LMArena on Hugging Face under CC BY 4.0 (attribution). Read through the public '
      + 'HF datasets-server API (no token), category "overall" of the latest split.',
    termsUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  livebench: {
    id: 'livebench', name: 'LiveBench', enabled: true,
    urls: {
      site: 'https://livebench.ai/',
      table: 'https://livebench.ai/data/{release}/table.csv',            // {release} = newest 8-digit id listed in the site bundle
      categories: 'https://livebench.ai/data/{release}/categories.json',
    },
    attribution: 'LiveBench (livebench.ai), White et al. 2024',
    terms: 'The leaderboard CSV the public site itself loads; no explicit data licence is published (code repo: no SPDX licence asserted), '
      + 'robots.txt allows all. Used privately with credit, one request set per day. Skipped if the site layout changes.',
    termsUrl: 'https://github.com/LiveBench/LiveBench',
  },
  epoch: {
    id: 'epoch', name: 'Epoch AI', enabled: true,
    urls: { eci: 'https://epoch.ai/data/eci_scores.csv', hub: 'https://epoch.ai/benchmarks/use-this-data', zip: 'https://epoch.ai/data/benchmark_data.zip' },
    attribution: "Epoch AI, 'Capabilities & benchmarking' (Epoch Capabilities Index), CC BY 4.0",
    terms: 'Epoch AI data is free to use, distribute and reproduce with credit under CC BY 4.0. eci_scores.csv is the same file as '
      + 'epoch_capabilities_index/eci_scores.csv inside the published benchmark_data.zip.',
    termsUrl: 'https://epoch.ai/benchmarks/use-this-data',
  },
  huggingface: {
    id: 'huggingface', name: 'Hugging Face Hub', enabled: true,
    urls: { api: 'https://huggingface.co/api/models', resolve: 'https://huggingface.co/{repo}/resolve/main/config.json' },
    attribution: 'Model files and sizes: Hugging Face Hub',
    terms: 'Public Hub API with a read-only token; fixed 5-min windows (seen 26 Nov 2026: "api" 1,000 and "resolvers" 5,000 per 5 min with a token, 500 api without). hf-sync caps at 5 req/s and waits for the window reset when the RateLimit header shows ≤ 5 left.',
    termsUrl: 'https://huggingface.co/terms-of-service',
  },
} satisfies Record<string, SourceInfo>;
