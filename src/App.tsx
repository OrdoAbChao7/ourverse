import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { createRepository } from '@/data/backend';
import { RepositoryProvider } from '@/app/RepositoryContext';
import { AuthProvider } from '@/app/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { router } from '@/app/router';
import { Wordmark } from '@/app/Wordmark';
import { StarField } from '@/app/StarField';
import type { Repository } from '@/data/repository';

function BootScreen({ error }: { error: string | null }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <StarField />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <Wordmark />
        {error ? (
          <>
            <p className="max-w-sm text-[13px] leading-relaxed text-dim">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2 text-sm text-ink hover:bg-white/[0.08]"
            >
              重新加载
            </button>
          </>
        ) : (
          <span className="size-4 animate-spin rounded-full border-[1.5px] border-violet/70 border-t-transparent" />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    createRepository()
      .then((repo) => {
        if (active) setRepository(repo);
      })
      .catch((error: unknown) => {
        if (active) setBootError(error instanceof Error ? error.message : '无法初始化数据后端。');
      });
    return () => {
      active = false;
    };
  }, []);

  if (!repository) return <BootScreen error={bootError} />;

  return (
    <ErrorBoundary>
      <RepositoryProvider repository={repository}>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </RepositoryProvider>
    </ErrorBoundary>
  );
}
