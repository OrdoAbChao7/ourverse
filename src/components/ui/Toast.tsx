import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { IconCheck, IconClose, IconInfo } from '../icons';

export type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue['toast']>(
    ({ title, description, tone = 'info' }) => {
      const id = nextId++;
      setItems((current) => [...current.slice(-2), { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-[13px] animate-[ov-rise_220ms_var(--ease-quiet)]',
              item.tone === 'error' && 'border-rose/30',
              item.tone === 'success' && 'border-cyan/25',
            )}
            role={item.tone === 'error' ? 'alert' : 'status'}
          >
            <span
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                item.tone === 'error'
                  ? 'border-rose/30 bg-rose/10 text-rose'
                  : item.tone === 'success'
                    ? 'border-cyan/30 bg-cyan/10 text-cyan'
                    : 'border-white/15 bg-white/[0.05] text-mist',
              )}
            >
              {item.tone === 'success' ? <IconCheck size={12} /> : <IconInfo size={12} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{item.title}</p>
              {item.description && <p className="mt-0.5 leading-relaxed text-mist/80">{item.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="rounded-md p-1 text-dim transition-colors hover:bg-white/5 hover:text-ink"
              aria-label="关闭提示"
            >
              <IconClose size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
