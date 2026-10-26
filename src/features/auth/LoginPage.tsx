import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { StarField } from '@/app/StarField';
import { Wordmark, OrbitMark } from '@/app/Wordmark';
import { Button, Spinner } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { IconChevronRight, IconLock, IconLink, IconShield } from '@/components/icons';
import { errorMessage } from '@/domain/errors';
import { initials } from '@/lib/text';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/app/useNow';
import type { InvitePreview } from '@/data/repository';

export function LoginPage() {
  useDocumentTitle('进入');
  const repo = useRepository();
  const auth = useAuth();
  const { state, loading, demoIdentities } = auth;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } | null };
  const { toast } = useToast();
  const inviteToken = searchParams.get('invite') ?? '';
  const redirectTo = location.state?.from?.startsWith('/app') ? location.state.from : '/app';
  const [working, setWorking] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const suppressRedirect = useRef(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || state.status !== 'authenticated' || suppressRedirect.current || working) return;
    navigate(redirectTo, { replace: true });
  }, [loading, state.status, navigate, redirectTo, working]);

  useEffect(() => {
    if (!inviteToken) return;
    let active = true;
    repo
      .previewInvite(inviteToken)
      .then((preview) => {
        if (active) setInvitePreview(preview);
      })
      .catch((previewError: unknown) => {
        if (active) setInviteError(errorMessage(previewError, '无法验证邀请链接。'));
      });
    return () => {
      active = false;
    };
  }, [repo, inviteToken]);

  const inviteStatus = useMemo(() => {
    if (!inviteToken) return null;
    if (inviteError) return { valid: false, label: inviteError };
    if (!invitePreview) return { valid: false, label: '正在验证邀请…' };
    if (invitePreview.valid) return { valid: true, label: `邀请你加入「${invitePreview.spaceName}」` };
    return { valid: false, label: invitePreview.reason ?? '邀请不可用。' };
  }, [inviteToken, inviteError, invitePreview]);

  async function acceptPendingInvite() {
    if (!inviteToken || !invitePreview?.valid) return;
    try {
      await auth.acceptInvite(inviteToken);
      toast({ title: '已加入空间', description: '现在可以看到两个人共同的记录了。', tone: 'success' });
    } catch (acceptError) {
      toast({ title: '未能加入空间', description: errorMessage(acceptError), tone: 'error' });
    }
  }

  async function onDemoIdentity(userId: string) {
    if (working) return;
    suppressRedirect.current = true;
    setWorking(userId);
    try {
      await auth.signInDemo(userId);
      await acceptPendingInvite();
      navigate(redirectTo, { replace: true });
    } catch (signInError) {
      suppressRedirect.current = false;
      toast({ title: '登录失败', description: errorMessage(signInError), tone: 'error' });
    } finally {
      setWorking(null);
    }
  }

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('请输入有效的邮箱地址。');
      return;
    }
    if (password.length < 8) {
      setFormError('密码至少需要 8 位。');
      return;
    }
    suppressRedirect.current = true;
    setWorking(mode);
    try {
      if (mode === 'signup') {
        if (!displayName.trim()) throw new Error('请填写你的名字。');
        const result = await auth.signUp(email.trim(), password, displayName.trim());
        if (result.needsEmailConfirmation) {
          toast({ title: '请查收邮件', description: '完成邮箱验证后再回来登录。' });
          setMode('signin');
          suppressRedirect.current = false;
          return;
        }
      } else {
        await auth.signInWithPassword(email.trim(), password);
      }
      await acceptPendingInvite();
      navigate(redirectTo, { replace: true });
    } catch (submitError) {
      suppressRedirect.current = false;
      setFormError(errorMessage(submitError, '无法完成登录。'));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <StarField intensity={1.25} />
      <div className="pointer-events-none absolute inset-0 z-0 hero-glow opacity-80" aria-hidden="true" />

      <main id="main" className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1380px] lg:grid-cols-[1.02fr_0.98fr]">
        <section className="relative hidden flex-col justify-between px-12 py-12 lg:flex xl:px-20 xl:py-16">
          <Wordmark />

          <div className="max-w-lg">
            <div className="mb-9 flex items-center gap-4">
              <OrbitMark size={72} className="opacity-90" />
              <div className="h-px w-16 bg-gradient-to-r from-violet/50 to-transparent" />
            </div>
            <p className="label-caps mb-4">私人数字记忆世界</p>
            <h1 className="text-[46px] font-[520] leading-[1.26] tracking-[0.01em] xl:text-[54px]">
              只有两个人的
              <br />
              <span className="aurora-text">微小宇宙。</span>
            </h1>
            <p className="mt-7 max-w-md text-[14.5px] leading-[1.95] text-mist/75">
              把一起看过的海、走过的夜路、没有说完的话，留在这里。不公开、不推荐、不被算法打扰——只属于你们两个人。
            </p>

            <div className="mt-10 space-y-3">
              {[
                { icon: IconLock, text: '双人邀请制，没有公开注册入口' },
                { icon: IconShield, text: '私密记录默认只有本人可见，绝不进入对方视野' },
                { icon: IconLink, text: '随时可导出为断网也能打开的数字博物馆' },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-3 text-[12.5px] text-dim">
                  <item.icon size={15} className="text-violet/80" />
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed tracking-[0.02em] text-dim/70">
            OURVERSE · 双人星球 — 私人空间，非社交产品。
          </p>
        </section>

        <section className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-8">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>

          <div className="glass w-full max-w-[430px] rounded-2xl p-6 sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[20px] font-[550] text-ink">进入你的星球</h2>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
                  {state.isDemo ? '演示空间使用虚构身份与虚构记录。' : '使用受邀邮箱登录。'}
                </p>
              </div>
              {state.isDemo && <Badge tone="gold">DEMO</Badge>}
            </div>

            {inviteStatus && inviteToken && (
              <div
                className={cn(
                  'mt-5 rounded-xl border px-3.5 py-3 text-[12.5px]',
                  inviteStatus.valid
                    ? 'border-cyan/25 bg-cyan/[0.06] text-[#c6e8ec]'
                    : 'border-rose/25 bg-rose/[0.06] text-[#efc6d2]',
                )}
                role="status"
              >
                {inviteStatus.label}
              </div>
            )}

            {state.isDemo ? (
              <div className="mt-6 space-y-2.5">
                <p className="label-caps text-[10px]">选择一个虚构身份</p>
                {demoIdentities.length === 0 && (
                  <div className="flex items-center gap-2 py-6 text-[12.5px] text-dim">
                    <Spinner /> 正在准备演示数据…
                  </div>
                )}
                {demoIdentities.map((identity) => (
                  <button
                    key={identity.userId}
                    type="button"
                    onClick={() => void onDemoIdentity(identity.userId)}
                    disabled={Boolean(working)}
                    aria-label={`${identity.displayName}${identity.hasSpace ? '' : ' 无空间'} ${identity.description}，以${identity.displayName}的身份进入演示`}
                    className={cn(
                      'group flex w-full items-center gap-3.5 rounded-xl border border-white/[0.09] bg-white/[0.025] px-3.5 py-3 text-left transition-all duration-200',
                      'hover:border-violet/35 hover:bg-violet/[0.06] disabled:cursor-wait disabled:opacity-60',
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-gradient-to-b from-white/[0.09] to-transparent text-[13px] text-ink/90">
                      {working === identity.userId ? <Spinner className="size-3.5" /> : initials(identity.displayName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-ink">{identity.displayName}</span>
                        {!identity.hasSpace && <Badge tone="rose">无空间</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-dim">{identity.description}</span>
                    </span>
                    <IconChevronRight
                      size={16}
                      className="text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-mist"
                    />
                  </button>
                ))}
                <p className="pt-2 text-[11px] leading-relaxed text-dim/80">
                  同一浏览器的两个标签页可以分别以「林雾」和「江照」登录，观察真实的双人隔离效果。演示数据保存在本机
                  IndexedDB，不会上传。
                </p>
              </div>
            ) : (
              <form className="mt-6 space-y-4" onSubmit={(event) => void onPasswordSubmit(event)}>
                <Field label="邮箱" htmlFor="login-email">
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </Field>
                {mode === 'signup' && (
                  <Field label="你的名字" htmlFor="login-name" hint="只在这颗星球里显示。">
                    <Input
                      id="login-name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="如何称呼你"
                      autoComplete="nickname"
                    />
                  </Field>
                )}
                <Field label="密码" htmlFor="login-password" hint={mode === 'signup' ? '至少 8 位。' : undefined}>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </Field>
                {formError && (
                  <p
                    className="rounded-lg border border-rose/25 bg-rose/[0.06] px-3 py-2 text-[12.5px] text-[#efc6d2]"
                    role="alert"
                  >
                    {formError}
                  </p>
                )}
                <Button type="submit" variant="primary" className="w-full" loading={working !== null}>
                  {mode === 'signup' ? '创建账号' : '登录'}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'signin' ? 'signup' : 'signin');
                    setFormError(null);
                  }}
                  className="w-full text-center text-[12px] text-dim transition-colors hover:text-mist"
                >
                  {mode === 'signin' ? '第一次来？创建账号后使用邀请加入' : '已有账号？返回登录'}
                </button>
                {inviteToken && (
                  <p className="text-center text-[11.5px] leading-relaxed text-dim">登录后会自动接受邀请链接。</p>
                )}
              </form>
            )}

            <div className="mt-7 border-t border-white/[0.07] pt-4">
              <p className="text-[11px] leading-relaxed text-dim/80">
                {state.isDemo
                  ? '演示模式不会连接到 Supabase、不会发送任何数据。真实后端需要配置环境变量后单独验收。'
                  : '你只能看到自己与另一位成员的内容。密码不会保存在本机。'}
              </p>
            </div>
          </div>

          <Link to="/" className="mt-7 text-[11.5px] text-dim transition-colors hover:text-mist">
            返回首页
          </Link>
        </section>
      </main>
    </div>
  );
}
