'use client';
// The content sheet that overlaps the hero. Re-keyed on the pathname only (not the query string,
// which pages use for their own state) so each page fades up 10 px on arrival.
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export function PageMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main key={pathname} className="fade relative max-w-[1240px] mx-auto px-3 sm:px-6 -mt-28 sm:-mt-32 pb-16">
      {children}
    </main>
  );
}
