import { Link } from 'react-router-dom';
import { StarField } from '@/app/StarField';
import { Wordmark } from '@/app/Wordmark';
import { useDocumentTitle } from '@/app/useNow';

export function NotFoundPage() {
  useDocumentTitle('页面不存在');
  return (
    <div className="relative min-h-dvh">
      <StarField />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-6 text-center">
        <Wordmark className="mb-10" />
        <p className="num text-[64px] leading-none text-white/12">404</p>
        <h1 className="mt-4 text-[22px] font-[540] text-ink">这片星域还没有被记录</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-dim">
          页面不存在，或者它属于另一个人的私密空间。
        </p>
        <Link
          to="/app"
          className="mt-7 inline-flex h-10 items-center rounded-xl border border-white/12 bg-white/[0.045] px-4 text-sm text-ink transition-colors hover:bg-white/[0.075]"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}

export function NotFoundInline() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="num text-[52px] leading-none text-white/10">404</p>
      <h1 className="mt-3 text-[19px] font-medium text-ink">这里没有内容</h1>
      <p className="mt-2 text-[13px] text-dim">链接可能已经失效，或者它不属于你。</p>
      <Link to="/app" className="mt-6 text-[13px] text-violet/90 underline-offset-4 hover:underline">
        回到首页
      </Link>
    </div>
  );
}
