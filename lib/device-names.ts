// lib/device-names.ts — see past OEM / board-partner branding when matching device names (W1, after launch).
// An "ASUS ROG Strix GeForce RTX 4090 OC" or "MSI Suprim X 4090" has the same memory and bandwidth as the reference
// RTX 4090, so for LLM speed it is the same catalog device. Pure, no imports: safe on server and client.

/** Chip vendors that tools prefix to names ("NVIDIA GeForce RTX 4090"). */
const CHIP_VENDOR = /^(nvidia|amd|intel|apple|ati)\s+/;
/** Board-partner brands, product lines and marketing words that never change memory size or bandwidth.
 *  Deliberately excludes words that do (e.g. "pro", "ti", "super", "max", "laptop", memory sizes). */
const BRAND_WORDS = [
  'asus', 'rog', 'strix', 'tuf', 'proart', 'prime', 'dual', 'msi', 'suprim', 'ventus', 'gaming', 'trio', 'liquid',
  'gigabyte', 'aorus', 'eagle', 'windforce', 'aero', 'master', 'xtreme', 'zotac', 'amp', 'airo', 'trinity', 'twin', 'edge',
  'pny', 'verto', 'xlr8', 'palit', 'gamerock', 'jetstream', 'gainward', 'phantom', 'phoenix', 'inno3d', 'ichill', 'evga',
  'ftw3', 'xc3', 'sapphire', 'nitro', 'pulse', 'xfx', 'merc', 'speedster', 'qick', 'powercolor', 'red', 'devil', 'hellhound',
  'fighter', 'asrock', 'taichi', 'challenger', 'steel', 'legend', 'founders', 'edition', 'fe', 'oc', 'white', 'black', 'lhr',
  'graphics', 'card', 'video', 'gpu', 'generation', 'series',
];
const BRAND_RE = new RegExp(`\\b(${BRAND_WORDS.join('|')})\\b`, 'g');

/** Lowercase name with chip vendor, board brands and filler removed: "ASUS TUF Gaming GeForce RTX 4090 OC" → "geforce rtx 4090". */
export function canonicalDeviceName(s: string): string {
  return s.toLowerCase().replace(/\(r\)|\(tm\)|®|™/g, ' ').replace(/[+_/]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(CHIP_VENDOR, '').replace(BRAND_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** Every word of the query (brands ignored) appears in one of the names — for type-ahead device search. */
export function deviceMatchesQuery(query: string, names: string[]): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  if (names.some(n => n.toLowerCase().includes(raw))) return true;
  const words = canonicalDeviceName(raw).split(' ').filter(Boolean);
  if (!words.length) return false;
  return names.some(n => { const c = ` ${canonicalDeviceName(n)} ${n.toLowerCase()} `; return words.every(w => c.includes(w)); });
}

/** The alias that made `query` match when the catalog name alone does not (e.g. "dell pro max" → "Dell Pro Max with GB300"). */
export function matchedAlias(query: string, name: string, aliases: string[]): string | null {
  if (!query.trim() || deviceMatchesQuery(query, [name])) return null;
  return aliases.find(a => deviceMatchesQuery(query, [a])) ?? null;
}
