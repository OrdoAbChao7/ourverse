import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cn';

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-white/10 bg-[rgba(6,13,24,0.5)] p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-200',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[12.5px]',
              active
                ? 'bg-white/[0.085] text-ink shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]'
                : 'text-dim hover:text-mist',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-[14px] font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-dim">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-250 disabled:opacity-40',
          checked ? 'border-violet/50 bg-violet/35' : 'border-white/12 bg-white/[0.06]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-[18px] rounded-full bg-[#f5f2ea] shadow transition-all duration-250 ease-[var(--ease-quiet)]',
            checked ? 'left-[22px]' : 'left-[3px]',
          )}
        />
      </button>
    </div>
  );
}
