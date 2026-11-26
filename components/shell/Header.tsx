'use client';
// Header inside the hero: Wordmark → /, centred uppercase nav with the orange active dot, "Ask AI" pill.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Pill, Wordmark } from '@/components/ui';
import { VIEWS, viewFor } from './views';

export function Header() {
  const active = viewFor(usePathname() ?? '/')?.kind;
  return (
    <header className="flex items-center gap-4 h-16 pt-2">
      <Link href="/" aria-label="Atlas home" className="flex items-center flex-none"><Wordmark /></Link>
      <nav className="scroll nobar edge flex-1" aria-label="Sections">
        <div className="flex gap-1 w-max mx-auto">
          {VIEWS.map(v => {
            const on = active === v.kind;
            return (
              <Link
                key={v.kind}
                href={v.href}
                aria-current={on ? 'page' : undefined}
                className={`relative h-10 px-3 flex items-center text-xs font-semibold uppercase tracking-[.08em] rounded-full transition-colors ${on ? 'text-white' : 'text-white/65 hover:text-white'}`}
              >
                {v.label}
                {on && <span className="pop absolute left-1/2 -ml-[3px] bottom-0.5 h-1.5 w-1.5 rounded-full bg-acc" />}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="hidden md:block flex-none"><Pill dark small href="/hardware?mode=ai">Ask AI</Pill></div>
    </header>
  );
}
