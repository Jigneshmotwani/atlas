// The prototype's h-8 w-14 toggle (Device test "Share speed results").
export interface SwitchProps {
  checked: boolean;
  onChange(v: boolean): void;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function Switch({ checked, onChange, id, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      onClick={() => onChange(!checked)}
      className={`mt-0.5 h-8 w-14 flex-none rounded-full p-1 transition-colors ${checked ? 'bg-acc' : 'bg-line'}`}
    >
      <span className="block h-6 w-6 rounded-full bg-card transition-transform duration-300" style={{ transform: checked ? 'translateX(24px)' : 'none' }} />
    </button>
  );
}
