import type { ReactNode, SelectHTMLAttributes } from 'react';
import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const controlClass =
  'w-full rounded-xl border border-white/10 bg-[rgba(8,17,31,0.55)] px-3.5 text-[15px] text-ink placeholder:text-mist/40 transition-colors duration-200 hover:border-white/16 focus:border-violet/50 focus:bg-[rgba(10,20,36,0.75)] focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-violet/20 disabled:cursor-not-allowed disabled:opacity-50';

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  aside?: ReactNode;
}

export function Field({ label, hint, error, required, htmlFor, className, children, aside }: FieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <label htmlFor={htmlFor} className="text-[13px] font-medium text-mist">
              {label}
              {required && <span className="ml-1 text-violet/80">·</span>}
            </label>
          ) : (
            <span />
          )}
          {aside}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-[12.5px] leading-relaxed text-[#f3b6c6]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] leading-relaxed text-dim">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(controlClass, 'h-11', invalid && 'border-rose/45 focus:border-rose/60 focus:ring-rose/15', className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        controlClass,
        'min-h-28 resize-y py-3 leading-[1.8]',
        invalid && 'border-rose/45 focus:border-rose/60 focus:ring-rose/15',
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(controlClass, 'h-11 appearance-none pr-9', className)} {...props}>
      {children}
    </select>
  );
});

export function useFieldId(provided?: string): string {
  const generated = useId();
  return provided ?? generated;
}
