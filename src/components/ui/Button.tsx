import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-[#f2ecdf] text-[#0a1120] border border-white/25 shadow-[0_10px_30px_-14px_rgba(240,212,156,0.55)] hover:bg-[#fbf6ea] hover:shadow-[0_14px_36px_-14px_rgba(240,212,156,0.65)] active:translate-y-px',
  secondary:
    'bg-white/[0.045] text-ink border border-white/12 hover:bg-white/[0.075] hover:border-white/20 active:translate-y-px',
  ghost: 'text-mist hover:text-ink hover:bg-white/[0.055] border border-transparent',
  danger:
    'bg-rose/10 text-[#f3c3d0] border border-rose/25 hover:bg-rose/16 hover:border-rose/40 active:translate-y-px',
  quiet:
    'bg-transparent text-mist border border-white/10 hover:text-ink hover:border-white/20 hover:bg-white/[0.03]',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading = false, icon, iconRight, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium tracking-[0.01em] transition-all duration-200 ease-[var(--ease-quiet)] disabled:cursor-not-allowed disabled:opacity-45',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: Variant; size?: 'sm' | 'md' }
>(function IconButton({ className, label, variant = 'ghost', size = 'md', children, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'ghost' ? 'text-dim hover:text-ink hover:bg-white/[0.06]' : variantClasses[variant],
        size === 'sm' ? 'size-8' : 'size-9',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-80',
        className,
      )}
      aria-hidden="true"
    />
  );
}
