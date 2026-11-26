// Root layout (W2): fonts, theme and the shell from NOTES.md "Shell contract".
import type { Metadata } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Hero } from '@/components/shell/Hero';
import { MotionProvider } from '@/components/shell/MotionProvider';
import { PageMain } from '@/components/shell/PageMain';
import { Stars } from '@/components/shell/Stars';
import { THEME_SCRIPT } from '@/components/shell/theme';
import './globals.css';

// Only 400–800 like the prototype, so the wordmark's font-light renders at 400 exactly as there.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-inter', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument-serif', display: 'swap' });

export const metadata: Metadata = { title: 'Atlas', description: 'A personal map of AI models: scores, prices, quants and the hardware to run them.' };

// Footer sync ages refresh at least hourly.
export const revalidate = 3600;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <MotionProvider>
          <div className="min-h-screen">
            <div className="hero relative text-white overflow-hidden">
              <Stars />
              <div className="relative max-w-[1240px] mx-auto px-4 sm:px-6">
                <Header />
                <Hero />
              </div>
            </div>
            <div className="after">
              <PageMain>{children}</PageMain>
            </div>
            <Footer />
          </div>
        </MotionProvider>
      </body>
    </html>
  );
}
