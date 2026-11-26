'use client';
// Page title + subtitle per pathname (prototype VIEWS copy). Explorer also gets the four crystal links.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gem, Icon } from '@/components/ui';
import { VIEWS, viewFor } from './views';

function copyFor(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return { title: 'Match model names', subtitle: 'Confirm how source names map to Atlas models.' };
  return viewFor(pathname) ?? { title: 'Page not found', subtitle: 'This page is off the map. Pick a section above.' };
}

export function Hero() {
  const pathname = usePathname() ?? '/';
  const explorer = pathname === '/';
  const { title, subtitle } = copyFor(pathname);
  return (
    <div key={pathname} className="text-center pt-12 sm:pt-16 pb-36 sm:pb-44">
      <h1 className="fade text-[clamp(36px,6vw,72px)] font-semibold tracking-[-.03em] leading-[1.02] [text-wrap:balance] max-w-4xl mx-auto">
        {explorer ? <>Find the right model.<br />Run it on your hardware.</> : title}
      </h1>
      <p className="fade text-white/70 mt-4 max-w-xl mx-auto" style={{ animationDelay: '80ms' }}>{subtitle}</p>
      {explorer && (
        <div className="fade mt-12 grid grid-cols-2 lg:grid-cols-4 text-left border-t border-white/15" style={{ animationDelay: '160ms' }}>
          {VIEWS.slice(1).map((v, i) => (
            <Link
              key={v.kind}
              href={v.href}
              className={`lift flex items-center gap-3 p-4 sm:p-5 hover:bg-white/5 transition-colors ${i ? 'lg:border-l border-white/15' : ''} ${i % 2 ? 'border-l border-white/15 lg:border-l' : ''}`}
            >
              <Gem kind={v.kind} />
              <span className="flex-1">
                <span className="block font-semibold text-sm">{v.label}</span>
                <span className="block text-xs text-white/60 mt-0.5 leading-snug">{v.title}</span>
              </span>
              <span className="arr text-white/80"><Icon name="arrow" size={18} /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
