// Placeholder from Wave 0 (W1). W2 replaces this with fonts, theme and the shell.
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Atlas', description: 'A personal map of AI models' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
