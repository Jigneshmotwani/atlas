// --share: POST the profile to `${base}/api/runs`. Only the Profile JSON is sent (device model, file, speeds,
// a random install id); never files, paths, hostnames or user names.
import { DEFAULT_URL, PROBE_VERSION, isPlaceholderUrl } from './config.js';
import type { Profile } from './profile.js';

/** Base URL: ATLAS_URL, then --url, then the built-in default. */
export const shareBase = (flagUrl: string | undefined) => (flagUrl || process.env.ATLAS_URL || DEFAULT_URL).replace(/\/+$/, '');

export interface ShareResult { accepted: number; rejected: { file: string; reason: string }[] }

export async function share(profile: Profile, base: string): Promise<ShareResult> {
  if (isPlaceholderUrl(base)) {
    throw new Error('No Atlas site is configured yet. Set ATLAS_URL or pass --url https://<your atlas site> to share runs.');
  }
  let url: URL;
  try { url = new URL('/api/runs', base + '/'); } catch { throw new Error(`Not a valid URL: ${base}`); }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) {
    throw new Error('Refusing to share over plain http (except localhost). Use an https:// URL.');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'user-agent': `atlas-probe/${PROBE_VERSION}` },
      body: JSON.stringify(profile),
    });
    const body = (await res.json().catch(() => null)) as (Partial<ShareResult> & { error?: string }) | null;
    if (!res.ok) throw new Error(`Atlas answered HTTP ${res.status}${body?.error ? `: ${body.error}` : ''}`);
    return { accepted: Number(body?.accepted ?? 0), rejected: Array.isArray(body?.rejected) ? body.rejected : [] };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Atlas did not answer within 30 s');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
