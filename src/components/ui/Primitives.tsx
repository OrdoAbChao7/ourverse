import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Card({
  children,
  className,
  as: Tag = 'div',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
  interactive?: boolean;
}) {
  return (
    <Tag
      className={cn(
        'glass rounded-2xl',
        interactive &&
          'transition-all duration-300 ease-[var(--ease-quiet)] hover:border-white/15 hover:bg-white/[0.05] hover:shadow-[0_30px_80px_-46px_rgba(0,0,0,1)]',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

type BadgeTone = 'neutral' | 'violet' | 'gold' | 'cyan' | 'rose' | 'green';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-white/10 bg-white/[0.04] text-mist',
  violet: 'border-violet/25 bg-violet/[0.09] text-[#d8cbf2]',
  gold: 'border-gold/25 bg-gold/[0.08] text-[#f2e0b9]',
  cyan: 'border-cyan/25 bg-cyan/[0.08] text-[#bde5ea]',
  rose: 'border-rose/25 bg-rose/[0.08] text-[#efc3d0]',
  green: 'border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-200/90',
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-medium tracking-[0.04em]',
        badgeTones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Chip({
  children,
  selected = false,
  onClick,
  className,
  title,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] transition-colors duration-200',
        selected
          ? 'border-violet/40 bg-violet/[0.14] text-[#e2d8f6]'
          : 'border-white/10 bg-white/[0.025] text-mist hover:border-white/20 hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-2.5">
        {eyebrow && <p className="label-caps">{eyebrow}</p>}
        <h1 className="text-[26px] font-[550] leading-tight tracking-[0.01em] text-ink sm:text-[30px]">{title}</h1>
        {description && <p className="max-w-2xl text-[13.5px] leading-relaxed text-mist/85">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function SectionHeading({
  label,
  title,
  action,
  className,
}: {
  label?: string;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="space-y-1.5">
        {label && <p className="label-caps">{label}</p>}
        <h2 className="text-[17px] font-[550] tracking-[0.01em] text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-violet/80">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-medium text-ink">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-dim">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNotice({
  title = '出了点问题',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-rose/25 bg-rose/[0.06] px-4 py-3.5 text-[13px] text-[#efc6d2] sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-[12.5px] text-[#efc6d2]/80">{message}</p>
      </div>
      {onRetry && (
        <Button variant="quiet" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

export function LoadingState({ label = '正在读取星光…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-[13px] text-dim" role="status">
      <span className="size-4 animate-spin rounded-full border-[1.5px] border-violet/70 border-t-transparent" />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-white/[0.045]', className)} aria-hidden="true" />;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-white/[0.06]', className)} />;
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="gold" dot className={cn('uppercase tracking-[0.14em]', className)}>
      demo · 虚构数据
    </Badge>
  );
}
