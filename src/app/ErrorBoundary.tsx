import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StarField } from '@/app/StarField';
import { Wordmark } from '@/app/Wordmark';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ourverse] unexpected render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <StarField />
        <div className="relative z-10 max-w-md">
          <Wordmark className="mb-8 justify-center" />
          <h1 className="text-[22px] font-medium text-ink">这颗星球暂时失去信号</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-dim">
            页面遇到了意外错误。你的记录仍然保存在本地，不会因此丢失。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-10 items-center rounded-xl border border-white/12 bg-white/[0.05] px-4 text-sm text-ink hover:bg-white/[0.08]"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
