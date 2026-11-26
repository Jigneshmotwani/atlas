// Dark footer, four columns (prototype). Server Component: reads each source's last sync.
import Link from 'next/link';
import { Wordmark } from '@/components/ui';
import { loadSourceStatus } from '@/lib/data';
import { fmtAgo } from '@/lib/format';
import { ThemeToggle } from './ThemeToggle';
import { VIEWS } from './views';

const SOURCES: [id: string, name: string][] = [
  ['aa', 'Artificial Analysis'],
  ['arena', 'Arena'],
  ['livebench', 'LiveBench'],
  ['epoch', 'Epoch AI'],
  ['openrouter', 'OpenRouter'],
  ['hf-sync', 'Hugging Face'],
];

export async function Footer() {
  const status = await loadSourceStatus();
  return (
    <footer className="bg-night text-white/80">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-sm">
        <div>
          <div className="text-white"><Wordmark size={34} /></div>
          <p className="mt-2 text-white/60">A personal map of AI models: scores, prices, quants and the hardware to run them.</p>
          <ThemeToggle />
        </div>
        <div>
          <div className="serif text-2xl text-white">Explore</div>
          <ul className="mt-3 space-y-2">
            {VIEWS.map(v => <li key={v.kind}><Link href={v.href} className="hover:text-white">{v.label}</Link></li>)}
          </ul>
        </div>
        <div>
          <div className="serif text-2xl text-white">Data</div>
          <ul className="mt-3 space-y-2 text-white/60">
            {SOURCES.map(([id, name]) => {
              const s = status.find(x => x.source === id);
              return <li key={id}>{name} · {!s ? 'not synced yet' : s.ok ? fmtAgo(s.finishedAt) : `failed ${fmtAgo(s.finishedAt)}`}</li>;
            })}
          </ul>
        </div>
        <div>
          <div className="serif text-2xl text-white">Notes</div>
          <p className="mt-3 text-white/60">
            Benchmarks, prices and speeds from <a className="underline" href="https://artificialanalysis.ai/">Artificial Analysis</a>,{' '}
            <a className="underline" href="https://openrouter.ai/">OpenRouter</a> and others. Device specs are approximate.
          </p>
        </div>
      </div>
    </footer>
  );
}
