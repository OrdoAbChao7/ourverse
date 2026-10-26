import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useAuthoritativeNow, useDocumentTitle } from '@/app/useNow';
import { backendNotice } from '@/data/backend';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Segmented, Switch } from '@/components/ui/Controls';
import { Badge, Card, DemoBadge, Divider, ErrorNotice, LoadingState } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { anniversaryInputSchema, firstZodMessage } from '@/domain/schemas';
import { nextOccurrence, describeOccurrence } from '@/domain/anniversaries';
import { errorMessage } from '@/domain/errors';
import type { Accent, Anniversary, RepeatRule, SpaceInvite, Visibility } from '@/domain/types';
import { formatDate, formatDateTime, formatRelative } from '@/lib/date';
import { initials } from '@/lib/text';
import { accentMeta, ACCENT_META } from '@/lib/accent';
import { cn } from '@/lib/cn';

// Keep the museum builder, fflate and the offline viewer template out of the
// initial bundle; they are only needed when the pair actually exports.
const ExportPanel = lazy(() =>
  import('@/features/export/ExportPanel').then((module) => ({ default: module.ExportPanel })),
);

import {
  IconCalendar,
  IconCheck,
  IconCopy,
  IconEdit,
  IconLink,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconUser,
} from '@/components/icons';

function Section({
  id,
  title,
  description,
  children,
  action,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-[540] text-ink">{title}</h2>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-dim">{description}</p>
        </div>
        {action}
      </div>
      <Card className="p-5 sm:p-6">{children}</Card>
    </section>
  );
}

interface InviteRow {
  id: string;
  invitedEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  spaceId: string;
  createdBy: string;
}

export function SettingsPage() {
  useDocumentTitle('设置');
  const repo = useRepository();
  const { session, state, refresh, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const now = useAuthoritativeNow(60_000);

  const [displayName, setDisplayName] = useState(session?.space?.displayName ?? '');
  const [motto, setMotto] = useState(session?.space?.settings.motto ?? '');
  const [accent, setAccent] = useState<Accent>(session?.space?.settings.accent ?? 'violet');
  const [startDate, setStartDate] = useState(session?.space?.relationshipStartAt ?? '');
  const [savingSpace, setSavingSpace] = useState(false);

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SpaceInvite | null>(null);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiConsentAt, setAiConsentAt] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);

  const [anniversaryDialog, setAnniversaryDialog] = useState<{ open: boolean; item: Anniversary | null }>({
    open: false,
    item: null,
  });
  const [annName, setAnnName] = useState('');
  const [annDate, setAnnDate] = useState('');
  const [annRepeat, setAnnRepeat] = useState<RepeatRule>('yearly');
  const [annVisibility, setAnnVisibility] = useState<Visibility>('shared');
  const [annNote, setAnnNote] = useState('');
  const [savingAnniversary, setSavingAnniversary] = useState(false);
  const [anniversaryError, setAnniversaryError] = useState<string | null>(null);
  const [deleteAnniversary, setDeleteAnniversary] = useState<Anniversary | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const data = useAsync(async () => {
    const [anniversaries, preference, list] = await Promise.all([
      repo.listAnniversaries(),
      repo.getAiPreference(),
      repo.listInvites(),
    ]);
    return { anniversaries, preference, list };
  }, []);

  useEffect(() => {
    if (!session?.space) return;
    setDisplayName(session.space.displayName);
    setMotto(session.space.settings.motto);
    setAccent(session.space.settings.accent);
    setStartDate(session.space.relationshipStartAt ?? '');
  }, [session?.space]);

  useEffect(() => {
    if (!data.data) return;
    setInvites(data.data.list);
    setAiEnabled(data.data.preference.enabled);
    setAiConsentAt(data.data.preference.consentAt);
  }, [data.data]);

  const members = session?.members ?? [];
  const isOwner = members.find((member) => member.userId === session?.user.id)?.role === 'owner';
  const spaceFull = members.length >= 2;
  const anniversaries = useMemo(() => data.data?.anniversaries ?? [], [data.data]);
  const notice = backendNotice();

  const sortedAnniversaries = useMemo(
    () =>
      anniversaries
        .map((item) => ({ item, occurrence: nextOccurrence(item.date, item.repeat, now) }))
        .sort((a, b) => {
          const aPassed = a.occurrence.state === 'passed';
          const bPassed = b.occurrence.state === 'passed';
          if (aPassed !== bPassed) return aPassed ? 1 : -1;
          return aPassed ? b.occurrence.daysUntil - a.occurrence.daysUntil : a.occurrence.daysUntil - b.occurrence.daysUntil;
        }),
    [anniversaries, now],
  );

  async function saveSpace(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim()) {
      toast({ title: '空间名称不能为空', tone: 'error' });
      return;
    }
    setSavingSpace(true);
    try {
      await repo.updateSpace({
        displayName: displayName.trim(),
        motto,
        accent,
        relationshipStartAt: startDate || null,
      });
      await refresh();
      toast({ title: '空间设置已保存', tone: 'success' });
    } catch (error) {
      toast({ title: '保存失败', description: errorMessage(error), tone: 'error' });
    } finally {
      setSavingSpace(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: '已复制邀请链接', tone: 'success' });
    } catch {
      toast({ title: '无法自动复制', description: '请手动选中链接复制。', tone: 'error' });
    }
  }

  async function createInvite() {
    setCreatingInvite(true);
    try {
      const created = await repo.createInvite({ ttlHours: 72 });
      setInviteUrl(created.url);
      toast({ title: '邀请已生成', description: '链接只显示这一次，72 小时内有效。', tone: 'success' });
      data.reload();
    } catch (error) {
      toast({ title: '无法生成邀请', description: errorMessage(error), tone: 'error' });
    } finally {
      setCreatingInvite(false);
    }
  }

  async function revokeInvite() {
    if (!revokeTarget) return;
    try {
      await repo.revokeInvite(revokeTarget.id);
      setRevokeTarget(null);
      toast({ title: '邀请已撤销', tone: 'success' });
      data.reload();
    } catch (error) {
      toast({ title: '撤销失败', description: errorMessage(error), tone: 'error' });
    }
  }

  function openAnniversary(item: Anniversary | null) {
    setAnniversaryDialog({ open: true, item });
    setAnniversaryError(null);
    if (item) {
      setAnnName(item.name);
      setAnnDate(item.date);
      setAnnRepeat(item.repeat);
      setAnnVisibility(item.visibility);
      setAnnNote(item.note ?? '');
    } else {
      setAnnName('');
      setAnnDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10));
      setAnnRepeat('yearly');
      setAnnVisibility('shared');
      setAnnNote('');
    }
  }

  async function saveAnniversary(event: FormEvent) {
    event.preventDefault();
    const parsed = anniversaryInputSchema.safeParse({
      name: annName,
      date: annDate,
      repeat: annRepeat,
      visibility: annVisibility,
      note: annNote,
    });
    if (!parsed.success) {
      setAnniversaryError(firstZodMessage(parsed.error));
      return;
    }
    setSavingAnniversary(true);
    setAnniversaryError(null);
    try {
      if (anniversaryDialog.item) {
        await repo.updateAnniversary(anniversaryDialog.item.id, parsed.data);
      } else {
        await repo.createAnniversary(parsed.data);
      }
      toast({ title: anniversaryDialog.item ? '纪念日已更新' : '纪念日已添加', tone: 'success' });
      setAnniversaryDialog({ open: false, item: null });
      data.reload();
    } catch (error) {
      setAnniversaryError(errorMessage(error, '无法保存纪念日。'));
    } finally {
      setSavingAnniversary(false);
    }
  }

  async function removeAnniversary() {
    if (!deleteAnniversary) return;
    try {
      await repo.removeAnniversary(deleteAnniversary.id);
      setDeleteAnniversary(null);
      toast({ title: '纪念日已删除', tone: 'success' });
      data.reload();
    } catch (error) {
      toast({ title: '删除失败', description: errorMessage(error), tone: 'error' });
    }
  }

  async function onToggleAi(next: boolean) {
    if (next) {
      setConsentOpen(true);
      return;
    }
    await repo.setAiPreference(false);
    setAiEnabled(false);
    setAiConsentAt(null);
    toast({ title: '已关闭 AI 外部调用' });
  }

  async function confirmAiConsent() {
    await repo.setAiPreference(true);
    setAiEnabled(true);
    setAiConsentAt(new Date().toISOString());
    setConsentOpen(false);
    toast({ title: '已启用', description: '只有你提问时，检索到的片段才会被发送。' });
  }

  async function resetDemo() {
    if (!repo.resetDemoData) return;
    setResetting(true);
    try {
      await repo.resetDemoData();
      await refresh();
      data.reload();
      setResetOpen(false);
      toast({ title: '演示数据已重置', description: '12 条虚构记忆与附件已重新生成。', tone: 'success' });
    } catch (error) {
      toast({ title: '重置失败', description: errorMessage(error), tone: 'error' });
    } finally {
      setResetting(false);
    }
  }

  if (data.loading && !data.data) return <LoadingState label="正在读取设置…" />;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="label-caps">设置</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-[540] text-ink">这颗星球的样子</h1>
          {state.isDemo && <DemoBadge />}
        </div>
        <p className="max-w-2xl text-[13px] leading-relaxed text-mist/75">
          空间、成员、纪念日、隐私与数据都集中在这里。所有设置只影响这颗两人星球。
        </p>
      </header>

      {notice && <ErrorNotice title="后端提示" message={notice} />}
      {data.error ? (
        <ErrorNotice message={errorMessage(data.error, '部分设置无法读取。')} onRetry={data.reload} />
      ) : null}

      <nav aria-label="设置分区" className="hidden gap-1 overflow-x-auto border-b border-white/[0.06] pb-3 md:flex">
        {[
          ['space', '空间'],
          ['members', '成员与邀请'],
          ['anniversaries', '纪念日'],
          ['ai', '隐私与 AI'],
          ['export', '离线导出'],
          ['data', '数据管理'],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full px-3 py-1.5 text-[11.5px] text-dim transition-colors hover:bg-white/[0.04] hover:text-mist"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="space" title="空间" description="名字、欢迎语与主题色由你们共同定义。不会自动填入任何关系设定。">
        <form onSubmit={(event) => void saveSpace(event)} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="空间名字" htmlFor="settings-name">
              <Input
                id="settings-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={40}
              />
            </Field>
            <Field label="欢迎语" htmlFor="settings-motto" hint="显示在首页第一屏。">
              <Input
                id="settings-motto"
                value={motto}
                onChange={(event) => setMotto(event.target.value)}
                maxLength={60}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="同行开始日"
              htmlFor="settings-start"
              hint="可选。不填就只显示在一起记录的天数，不假设任何关系。"
            >
              <Input
                id="settings-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="[color-scheme:dark]"
              />
            </Field>
            <Field label="主题色" hint="影响首页光晕与强调色，不改变内容。">
              <div className="flex gap-2">
                {(Object.keys(ACCENT_META) as Accent[]).map((key) => {
                  const meta = accentMeta(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAccent(key)}
                      aria-pressed={accent === key}
                      className={cn(
                        'flex flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors',
                        accent === key
                          ? 'border-white/25 bg-white/[0.06]'
                          : 'border-white/8 bg-white/[0.02] hover:border-white/15',
                      )}
                    >
                      <span
                        className="size-3.5 rounded-full"
                        style={{ backgroundColor: meta.hex, boxShadow: `0 0 12px ${meta.hex}66` }}
                      />
                      <span className="text-[12px] text-mist">{meta.label}</span>
                      {accent === key && <IconCheck size={13} className="ml-auto text-ink/70" />}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>

          <div className="flex justify-end border-t border-white/[0.06] pt-4">
            <Button type="submit" variant="primary" loading={savingSpace}>
              保存空间设置
            </Button>
          </div>
        </form>
      </Section>

      <Section
        id="members"
        title="成员与邀请"
        description="这个空间恰好只有两位成员。邀请链接一次性使用，过期或撤销后立即失效。"
      >
        <div className="space-y-5">
          <ul className="space-y-2.5">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
                <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-gradient-to-b from-white/[0.08] to-transparent text-[12px] text-ink/90">
                  {initials(member.profile.displayName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13.5px] text-ink">
                    {member.profile.displayName}
                    {member.userId === session?.user.id && <Badge tone="violet">你</Badge>}
                    {member.role === 'owner' && <Badge tone="neutral">创建者</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-dim">
                    {member.profile.email} · 加入于 {formatDate(member.joinedAt)}
                  </p>
                </div>
              </li>
            ))}
            {members.length < 2 && (
              <li className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-3.5 py-3 text-[12px] text-dim">
                <IconUser size={16} />
                还有一位成员没有加入。生成邀请链接后发送给对方。
              </li>
            )}
          </ul>

          {isOwner ? (
            <div className="space-y-3 border-t border-white/[0.06] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] text-ink">邀请另一位成员</p>
                  <p className="mt-0.5 text-[11px] text-dim">
                    {spaceFull
                      ? '空间已经满员。需要先移除现有成员才能邀请新的人。'
                      : '生成后只显示一次，72 小时内有效，且只能使用一次。'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IconPlus size={14} />}
                  onClick={() => void createInvite()}
                  loading={creatingInvite}
                  disabled={spaceFull}
                >
                  生成邀请链接
                </Button>
              </div>

              {inviteUrl && (
                <div className="rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3">
                  <div className="flex items-center gap-2">
                    <IconLink size={14} className="shrink-0 text-cyan" />
                    <code className="min-w-0 flex-1 truncate text-[11.5px] text-[#c6e8ec]">{inviteUrl}</code>
                    <IconButton label="复制邀请链接" size="sm" onClick={() => void copy(inviteUrl)}>
                      <IconCopy size={14} />
                    </IconButton>
                  </div>
                  <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
                    关闭页面后无法再次查看明文链接（服务端只保存哈希）。现在复制并发给对方。
                  </p>
                </div>
              )}

              {invites.length > 0 && (
                <ul className="space-y-1.5">
                  {invites.map((invite) => {
                    const used = Boolean(invite.usedAt);
                    const revoked = Boolean(invite.revokedAt);
                    const expired = Date.parse(invite.expiresAt) <= now.getTime();
                    const status = revoked ? '已撤销' : used ? '已使用' : expired ? '已过期' : '有效';
                    return (
                      <li
                        key={invite.id}
                        className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2 text-[11.5px]"
                      >
                        <Badge tone={status === '有效' ? 'green' : 'neutral'}>{status}</Badge>
                        <span className="text-dim">创建于 {formatRelative(invite.createdAt)}</span>
                        <span className="text-dim/60">到期 {formatDateTime(invite.expiresAt)}</span>
                        {status === '有效' && (
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(invite)}
                            className="ml-auto text-[11px] text-rose/80 hover:text-rose"
                          >
                            撤销
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <p className="border-t border-white/[0.06] pt-4 text-[11.5px] text-dim">
              只有空间创建者可以发出或撤销邀请。
            </p>
          )}
        </div>
      </Section>

      <Section
        id="anniversaries"
        title="纪念日"
        description="由你们自己添加。逢年重复或只发生一次，都由你决定。"
        action={
          <Button variant="secondary" size="sm" icon={<IconPlus size={14} />} onClick={() => openAnniversary(null)}>
            添加纪念日
          </Button>
        }
      >
        {sortedAnniversaries.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-dim">还没有纪念日。添加一个，首页会出现倒计时。</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {sortedAnniversaries.map(({ item, occurrence }) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex size-9 items-center justify-center rounded-xl border border-gold/20 bg-gold/[0.05] text-gold">
                  <IconCalendar size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink">
                    {item.name}
                    <Badge tone="neutral">{item.repeat === 'yearly' ? '每年' : '一次性'}</Badge>
                    {item.visibility === 'private' && (
                      <Badge tone="rose">
                        <IconLock size={9} /> 仅自己
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-dim">
                    {item.repeat === 'yearly' ? formatDate(occurrence.nextDate) : formatDate(item.date)} · {describeOccurrence(occurrence)}
                    {item.note ? ` · ${item.note}` : ''}
                  </p>
                </div>
                {item.authorId === session?.user.id && (
                  <div className="flex items-center gap-1">
                    <IconButton label={`编辑 ${item.name}`} size="sm" onClick={() => openAnniversary(item)}>
                      <IconEdit size={14} />
                    </IconButton>
                    <IconButton label={`删除 ${item.name}`} size="sm" onClick={() => setDeleteAnniversary(item)}>
                      <IconTrash size={14} />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="ai" title="隐私与 AI" description="AI 默认关闭。关闭时，记忆助手只在本机检索，不发送任何内容。">
        <div className="space-y-4">
          <Switch
            checked={aiEnabled}
            onChange={(value) => void onToggleAi(value)}
            label="允许模型增强回答（可选）"
            description="开启后，只有在你提问时，才会把问题与最多 5 条你有权查看的记忆摘录发送给服务端代理。照片、音视频原件、胶囊正文与对方的私密内容永远不会被发送。"
          />
          {aiEnabled && (
            <p className="rounded-lg border border-violet/20 bg-violet/[0.05] px-3 py-2 text-[11.5px] leading-relaxed text-[#dfd3f4]/90">
              已启用{aiConsentAt ? `（同意时间：${formatDateTime(aiConsentAt)}）` : ''}。
              若尚未配置模型提供商，助手会继续以检索模式工作，并明确告知。
            </p>
          )}

          <Divider />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3.5">
              <p className="flex items-center gap-2 text-[12.5px] text-ink">
                <IconShield size={14} className="text-violet/80" /> 隐私边界
              </p>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-dim">
                <li>· 私密记忆仅作者本人可读，附件继承同一权限。</li>
                <li>· 检索层只接收你有权查看的记录。</li>
                <li>· 时间胶囊正文永远不进入检索或模型上下文。</li>
                <li>· 模型输出会被引用校验，失败则整段丢弃。</li>
              </ul>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3.5">
              <p className="flex items-center gap-2 text-[12.5px] text-ink">
                <IconLock size={14} className="text-cyan/80" /> 数据位置
              </p>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-dim">
                <li>· 当前后端：{repo.isDemo ? '本机 IndexedDB（演示）' : 'Supabase 私有数据库'}</li>
                <li>· 附件：{repo.isDemo ? '本机 IndexedDB' : 'Supabase 私有 Bucket，短期签名访问'}</li>
                <li>· 演示模式不会向任何服务器发送数据。</li>
                <li>· 真实 Supabase 模式下数据受行级权限保护。</li>
              </ul>
            </div>
          </div>
        </div>
      </Section>

      <Section id="export" title="离线导出" description="把你们的故事做成一个断网也能打开的数字博物馆。">
        <Suspense fallback={<LoadingState label="正在准备离线导出…" />}>
          <ExportPanel />
        </Suspense>
      </Section>

      <Section id="data" title="数据管理" description="高风险操作都会要求再次确认。">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5">
            <div>
              <p className="text-[13px] text-ink">当前演示数据</p>
              <p className="mt-0.5 text-[11px] text-dim">
                {state.isDemo
                  ? '本机演示记忆与附件。重置会清空本机 IndexedDB 并重新生成，不影响任何云端数据。'
                  : '真实后端模式下不提供演示重置。'}
              </p>
            </div>
            {repo.resetDemoData && (
              <Button variant="danger" size="sm" icon={<IconRefresh size={14} />} onClick={() => setResetOpen(true)}>
                重置演示数据
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5">
            <div>
              <p className="text-[13px] text-ink">退出登录</p>
              <p className="mt-0.5 text-[11px] text-dim">
                {state.isDemo ? '演示身份只对当前标签页有效。' : '退出后需要重新登录才能访问这颗星球。'}
              </p>
            </div>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}
            >
              退出
            </Button>
          </div>
        </div>
      </Section>

      <Section id="about" title="关于" description="版本与运行状态。">
        <dl className="grid gap-3 text-[12px] sm:grid-cols-2">
          {[
            ['产品', 'OURVERSE · 双人星球'],
            ['版本', import.meta.env.VITE_APP_VERSION ?? '0.1.0'],
            ['后端', repo.isDemo ? 'local · IndexedDB（演示）' : 'supabase'],
            ['演示模式', state.isDemo ? '是 · 全部内容为虚构' : '否'],
            ['部署状态', 'NOT_DEPLOYED_BY_DESIGN（未获授权，不公开部署）'],
            ['成员上限', '2 人'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.05] px-3 py-2">
              <dt className="text-dim">{label}</dt>
              <dd className="text-right text-mist">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[10.5px] leading-relaxed text-dim/70">
          隐私说明、备份与恢复建议见仓库 docs/privacy.md 与 docs/backup-and-restore.md。
          任何真实部署、云端账号或模型密钥都需要你明确授权后才会配置。
        </p>
      </Section>

      <Dialog
        open={anniversaryDialog.open}
        onClose={() => setAnniversaryDialog({ open: false, item: null })}
        title={anniversaryDialog.item ? '编辑纪念日' : '添加纪念日'}
        description="日期是你们自己的，系统不会替你决定。"
        size="md"
      >
        <form onSubmit={(event) => void saveAnniversary(event)} className="space-y-4">
          <Field label="名称" htmlFor="ann-name">
            <Input id="ann-name" value={annName} onChange={(event) => setAnnName(event.target.value)} maxLength={60} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="日期" htmlFor="ann-date">
              <Input
                id="ann-date"
                type="date"
                value={annDate}
                onChange={(event) => setAnnDate(event.target.value)}
                className="[color-scheme:dark]"
              />
            </Field>
            <Field label="重复">
              <Select value={annRepeat} onChange={(event) => setAnnRepeat(event.target.value as RepeatRule)} aria-label="重复规则">
                <option value="yearly">每年重复</option>
                <option value="once">只发生一次</option>
              </Select>
            </Field>
          </div>
          <Field label="可见范围">
            <Segmented
              label="纪念日可见范围"
              value={annVisibility}
              onChange={setAnnVisibility}
              options={[
                { value: 'shared', label: '共同可见' },
                { value: 'private', label: '仅自己' },
              ]}
            />
          </Field>
          <Field label="备注" htmlFor="ann-note">
            <Textarea
              id="ann-note"
              value={annNote}
              onChange={(event) => setAnnNote(event.target.value)}
              maxLength={500}
              className="min-h-20"
            />
          </Field>
          {anniversaryError && (
            <p className="rounded-lg border border-rose/25 bg-rose/[0.06] px-3 py-2 text-[12.5px] text-[#efc6d2]" role="alert">
              {anniversaryError}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
            <Button variant="quiet" onClick={() => setAnniversaryDialog({ open: false, item: null })}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={savingAnniversary}>
              保存
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteAnniversary)}
        onClose={() => setDeleteAnniversary(null)}
        onConfirm={() => void removeAnniversary()}
        title="删除这个纪念日？"
        description={deleteAnniversary ? `「${deleteAnniversary.name}」会从首页倒计时中移除。` : ''}
        confirmLabel="删除"
      />

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => void revokeInvite()}
        title="撤销这个邀请？"
        description="已经发出的链接会立即失效，对方将无法用它加入空间。"
        confirmLabel="撤销邀请"
        tone="primary"
      />

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => void resetDemo()}
        title="重置本机演示数据？"
        description="所有本机演示记忆、附件、胶囊与设置都会被删除并重新生成。此操作不可撤销，但不涉及任何云端数据。"
        confirmLabel="重置"
        loading={resetting}
      />

      <Dialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="启用模型增强回答？"
        description="只有你提问时才会发送内容。"
        size="md"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConsentOpen(false)}>
              保持关闭
            </Button>
            <Button variant="primary" onClick={() => void confirmAiConsent()}>
              我已了解并启用
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-2 pl-5 text-[12.5px] leading-relaxed text-mist/85">
          <li>会发送：你的问题 + 最多 5 条你有权查看的记忆标题、日期与摘录。</li>
          <li>不会发送：照片/视频/音频原件、时间胶囊正文、对方私密内容、密码或令牌。</li>
          <li>模型密钥只保存在服务端，浏览器不会接触。</li>
          <li>模型回答必须带有效引用，否则整段丢弃并回到检索模式。</li>
          <li>随时可以关闭；关闭后不会再发起任何模型请求。</li>
        </ul>
      </Dialog>
    </div>
  );
}
