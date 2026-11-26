// Hero starfield: 90 dots from the prototype's seeded random (Park–Miller, seed 7); about a third twinkle.
interface Star { x: number; y: number; r: number; d: number; t: boolean }

const STARS: Star[] = (() => {
  let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 90 }, () => ({ x: r() * 100, y: r() * 100, r: r() * 1.3 + 0.3, d: r() * 3.2, t: r() < 0.35 }));
})();

export function Stars() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      {STARS.map((p, i) => (
        <circle
          key={i}
          cx={p.x + '%'}
          cy={p.y + '%'}
          r={p.r}
          fill="white"
          opacity={p.t ? undefined : 0.55}
          className={p.t ? 'tw' : undefined}
          style={p.t ? { animationDelay: p.d + 's' } : undefined}
        />
      ))}
    </svg>
  );
}
