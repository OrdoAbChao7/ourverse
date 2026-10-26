import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { StarField } from '@/app/StarField';
import { Wordmark } from '@/app/Wordmark';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/domain/errors';
import { IconLink, IconPlus, IconShield } from '@/components/icons';
import { useDocumentTitle } from '@/app/useNow';

export function OnboardingPage() {
  useDocumentTitle('开始');
  const repo = useRepository();
  const { session, refresh, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [token, setToken] = useState('');
  const [working, setWorking] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('给你们的星球起一个名字。');
      return;
    }
    setWorking('create');
    setError(null);
    try {
      await repo.createSpace({ displayName: name.trim(), motto: motto.trim() || undefined });
      await refresh();
      toast({ title: '星球已经建立', description: '接下来可以邀请另一个人加入。', tone: 'success' });
      navigate('/app', { replace: true });
    } catch (createError) {
      setError(errorMessage(createError, '创建空间失败。'));
    } finally {
      setWorking(null);
    }
  }

  async function onJoin(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setError('请粘贴完整的邀请链接或令牌。');
      return;
    }
    setWorking('join');
    setError(null);
    try {
      const raw = token.trim();
      const value = raw.includes('invite=') ? new URL(raw).searchParams.get('invite') ?? raw : raw;
      await repo.auth.acceptInvite({ token: value });
      await refresh();
      toast({ title: '已加入空间', description: '现在可以开始记录共同的故事了。', tone: 'success' });
      navigate('/app', { replace: true });
    } catch (joinError) {
      setError(errorMessage(joinError, '无法加入空间。'));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="relative min-h-dvh">
      <StarField />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-4xl flex-col justify-center px-4 py-12 sm:px-8">
        <div className="mb-10 flex items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-3">
            {repo.isDemo && (
              <Badge tone="gold" dot>
                DEMO
              </Badge>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-[12px] text-dim transition-colors hover:text-mist"
            >
              切换身份
            </button>
          </div>
        </div>

        <header className="max-w-xl">
          <p className="label-caps">开始</p>
          <h1 className="mt-3 text-[30px] font-[540] leading-tight text-ink">
            {session?.user.displayName}，这里还没有你的星球。
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-mist/80">
            创建一个只属于两个人的空间，或者用对方发给你的邀请链接加入。空间最多只有两位成员。
          </p>
        </header>

        {error && (
          <p className="mt-6 rounded-xl border border-rose/25 bg-rose/[0.06] px-4 py-3 text-[13px] text-[#efc6d2]" role="alert">
            {error}
          </p>
        )}

        <div className="mt-9 grid gap-4 md:grid-cols-2">
          <form onSubmit={(event) => void onCreate(event)} className="glass space-y-4 rounded-2xl p-5">
            <div className="flex items-center gap-2.5 text-ink">
              <IconPlus size={17} className="text-violet" />
              <h2 className="text-[15px] font-medium">创建空间</h2>
            </div>
            <p className="text-[12px] leading-relaxed text-dim">你会成为空间创建者，并可以生成一次性邀请链接。</p>
            <Field label="空间名字" htmlFor="space-name">
              <Input
                id="space-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：我们的星球"
                maxLength={40}
              />
            </Field>
            <Field label="欢迎语" htmlFor="space-motto" hint="显示在首页，可以之后修改。">
              <Input
                id="space-motto"
                value={motto}
                onChange={(event) => setMotto(event.target.value)}
                placeholder="把故事留在星光里。"
                maxLength={60}
              />
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={working === 'create'}>
              建立这颗星球
            </Button>
          </form>

          <form onSubmit={(event) => void onJoin(event)} className="glass space-y-4 rounded-2xl p-5">
            <div className="flex items-center gap-2.5 text-ink">
              <IconLink size={17} className="text-cyan" />
              <h2 className="text-[15px] font-medium">接受邀请</h2>
            </div>
            <p className="text-[12px] leading-relaxed text-dim">
              邀请链接只能使用一次，通常 72 小时内有效。粘贴完整链接或其中的令牌。
            </p>
            <Field label="邀请链接 / 令牌" htmlFor="invite-token">
              <Input
                id="invite-token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="https://…/login?invite=…"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Button type="submit" variant="secondary" className="w-full" loading={working === 'join'}>
              加入空间
            </Button>
          </form>
        </div>

        <p className="mt-8 flex items-center gap-2 text-[11.5px] text-dim/80">
          <IconShield size={14} className="text-violet/70" />
          {repo.isDemo
            ? '演示账号「演示访客」不属于任何空间，用于验证未授权访问会被拒绝。'
            : '你只能加入一个空间。邀请链接一次性有效，过期后需要创建者重新生成。'}
        </p>
      </div>
    </div>
  );
}
