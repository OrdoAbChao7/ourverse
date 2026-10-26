import { cn } from '@/lib/cn';

export function OrbitMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <ellipse cx="16" cy="16" rx="13" ry="6.5" transform="rotate(-24 16 16)" stroke="rgba(185,161,232,0.55)" strokeWidth="0.9" />
      <ellipse cx="16" cy="16" rx="13" ry="6.5" transform="rotate(38 16 16)" stroke="rgba(240,212,156,0.28)" strokeWidth="0.7" />
      <circle cx="16" cy="16" r="3.1" fill="rgba(245,247,250,0.92)" />
      <circle cx="16" cy="16" r="6.3" stroke="rgba(185,161,232,0.22)" strokeWidth="0.7" />
      <circle cx="27.2" cy="9.1" r="1.15" fill="rgba(240,212,156,0.95)" />
      <circle cx="5.2" cy="23" r="0.9" fill="rgba(130,197,207,0.8)" />
    </svg>
  );
}

export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-left', className)}>
      <OrbitMark size={compact ? 24 : 30} className="shrink-0 opacity-95" />
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'font-medium uppercase leading-none text-ink',
            compact ? 'text-[11.5px] tracking-[0.28em]' : 'text-[13px] tracking-[0.34em]',
          )}
        >
          Ourverse
        </span>
        <span
          className={cn(
            'mt-1.5 leading-none text-dim',
            compact ? 'text-[9px] tracking-[0.26em]' : 'text-[10px] tracking-[0.3em]',
          )}
        >
          双人星球
        </span>
      </span>
    </span>
  );
}
