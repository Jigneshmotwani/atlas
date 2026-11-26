// Static configuration for atlas-probe. No secrets live here: the package is public.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Kept in step with package.json "version" (hard-coded so the bin needs no JSON import). */
export const PROBE_VERSION = '1.0.0';

/** Where `--share` posts when neither ATLAS_URL nor --url is given.
 *  Placeholder until the production URL is known; set it before `npm publish`. */
export const DEFAULT_URL = 'https://atlas-beta-jig.vercel.app';
export const isPlaceholderUrl = (u: string) => /\.invalid(?::\d+)?\/?$/i.test(u.replace(/\/+$/, ''));

/** Ask before any single download larger than this. */
export const ASK_ABOVE_GB = 5;

/** llama-bench settings from the spec. */
export const BENCH = { prompt: 512, gen: 128, reps: 3 } as const;

export const CACHE_DIR = join(homedir(), '.cache', 'atlas-probe');
export const CONFIG_DIR = join(homedir(), '.config', 'atlas-probe');
/** How folders are shown to the user: never print the absolute home path (it contains the username). */
export const CACHE_LABEL = '~/.cache/atlas-probe';
export const ID_LABEL = '~/.config/atlas-probe/id';
