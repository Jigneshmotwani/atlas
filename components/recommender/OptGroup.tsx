'use client';
// components/recommender/OptGroup.tsx — option tiles (`.pick`), single or multi choice. W6.
import { Icon } from '@/components/ui';

type Props<T extends string | number> =
  | { label: string; opts: readonly (readonly [T, string])[]; multi?: false; value: T; onChange(v: T): void }
  | { label: string; opts: readonly (readonly [T, string])[]; multi: true; value: T[]; onChange(v: T[]): void };

export function OptGroup<T extends string | number>(props: Props<T>) {
  const { label, opts } = props;
  const on = (v: T) => (props.multi ? props.value.includes(v) : props.value === v);
  const pick = (v: T) => {
    if (props.multi) props.onChange(props.value.includes(v) ? props.value.filter(x => x !== v) : [...props.value, v]);
    else props.onChange(v);
  };
  return (
    <fieldset>
      <legend className="serif text-3xl">{label}</legend>
      {props.multi && <p className="text-sm text-mute">Pick any, or none</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-3">
        {opts.map(([v, l], j) => (
          <button key={String(v)} type="button" aria-pressed={on(v)} onClick={() => pick(v)} style={{ animationDelay: j * 40 + 'ms' }}
            className={`pick fade h-14 px-5 rounded-2xl border text-left text-sm font-semibold flex justify-between items-center gap-2 ${on(v) ? 'border-ink bg-ink text-bg' : 'border-line bg-soft hover:border-ink'}`}>
            {l}
            {on(v) && <span className="h-6 w-6 shrink-0 rounded-full bg-acc text-onacc grid place-items-center"><Icon name="check" on size={14} /></span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
