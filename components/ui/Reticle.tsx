// Atlas logo. Hover motion (tick ring rotates 30°, star scales 1.25) is CSS: `.logo:hover .ticks/.star`.
export interface ReticleProps { size?: number }
export interface WordmarkProps { size?: number }

export function Reticle({ size = 30 }: ReticleProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path
        className="ticks"
        d="M44 11.22L41.75 15.11M52.78 20L48.89 22.25M52.78 44L48.89 41.75M44 52.78L41.75 48.89M20 52.78L22.25 48.89M11.22 44L15.11 41.75M11.22 20L15.11 22.25M20 11.22L22.25 15.11"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".6"
      />
      <path d="M32 3V22M32 42V61M3 32H22M42 32H61" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path className="star" d="M32 23Q32 32 41 32Q32 32 32 41Q32 32 23 32Q32 32 32 23Z" fill="var(--acc)" />
      <circle cx="44" cy="20" r="2.6" fill="var(--mint)" />
    </svg>
  );
}

export function Wordmark({ size = 30 }: WordmarkProps) {
  return (
    <span className="logo flex items-center gap-2.5">
      <Reticle size={size} />
      <span className="font-light tracking-[.32em] text-[17px]">ATLAS</span>
    </span>
  );
}
