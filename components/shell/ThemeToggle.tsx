'use client';
// System / Light / Dark. Sets data-theme on <html> and persists it; THEME_SCRIPT (./theme) applies it before paint.
import { useSyncExternalStore } from 'react';
import { THEME_KEY } from './theme';

type Theme = 'system' | 'light' | 'dark';
const OPTIONS: [Theme, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const listeners = new Set<() => void>();

function apply(t: Theme) {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
}

function current(): Theme {
  const v = document.documentElement.getAttribute('data-theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    apply(e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system');
    cb();
  };
  addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); removeEventListener('storage', onStorage); };
}

function choose(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch { /* storage blocked: theme still applies for this page view */ }
  apply(t);
  listeners.forEach(l => l());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => 'system' as Theme);
  return (
    <div role="group" aria-label="Theme" className="mt-5 inline-flex gap-1 rounded-full border border-white/15 p-1 text-xs font-semibold">
      {OPTIONS.map(([t, label]) => (
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          onClick={() => choose(t)}
          className={`h-8 px-3 rounded-full transition-colors ${theme === t ? 'bg-white text-night' : 'text-white/65 hover:text-white'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
