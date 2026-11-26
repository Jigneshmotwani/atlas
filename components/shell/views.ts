// Section list and hero copy (prototype VIEWS), shared by Header, Hero and Footer.
import type { GemKind } from '@/components/ui';

export interface View { kind: GemKind; href: string; label: string; title: string; subtitle: string }

export const VIEWS: View[] = [
  { kind: 'explorer', href: '/', label: 'Explorer', title: 'Every model, every score', subtitle: 'Compare closed and open models on intelligence, cost, speed and more.' },
  { kind: 'recommend', href: '/recommend', label: 'Recommender', title: 'Find your model in five steps', subtitle: 'Tell Atlas what matters. It ranks every model against your priorities.' },
  { kind: 'hardware', href: '/hardware', label: 'Hardware', title: 'What runs on your machine?', subtitle: 'Pick devices, type specs, or just describe your setup to Claude.' },
  { kind: 'quants', href: '/quants', label: 'Quants', title: 'Which quant should you download?', subtitle: 'The same model from different uploaders, compared on size and quality loss.' },
  { kind: 'probe', href: '/probe', label: 'Device test', title: 'Measure, then share', subtitle: 'Real numbers from your hardware make every estimate better.' },
];

/** The section a pathname belongs to (`/` only matches exactly). */
export function viewFor(pathname: string): View | undefined {
  return VIEWS.find(v => (v.href === '/' ? pathname === '/' : pathname === v.href || pathname.startsWith(v.href + '/')));
}
