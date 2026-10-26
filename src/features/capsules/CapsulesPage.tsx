import { useState, type FormEvent } from 'react';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useAuthoritativeNow, useDocumentTitle } from '@/app/useNow';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Controls';
import {
  Badge,
  EmptyState,
  ErrorNotice,
  LoadingState,
  PageHeader,
} from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { Markdown } from '@/lib/markdown';
import { capsuleInputSchema, firstZodMessage } from '@/domain/schemas';
import { errorMessage, isAppError } from '@/domain/errors';
import { canEditCapsule } from '@/domain/permissions';
import type { Capsule, CapsuleContent, Visibility } from '@/domain/types';
import { addDays, dateStringOf, formatCountdown, formatDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';
import {
  IconHourglass,
  IconLock,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconUnlock,
  IconShield,
} from '@/components/icons';
import { VisibilityBadge } from '@/features/memories/MemoryCard';

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${dateStringOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CapsuleCard({
  capsule,
  now,
  authorName,
  canEdit,
  onOpen,
  onDelete,
  opening,
}: {
  capsule: Capsule;
  now: Date;
  authorName: string;
  canEdit: boolean;
  onOpen: () => void;
  onDelete: () => void;
  opening: boolean;
}) {
  const locked = capsule.state === 'locked';
  const remaining = Date.parse(capsule.opensAt) - now.getTime();
  const days = Math.max(0, Math.floor(remaining / 86_400_000));

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 transition-colors duration-300',
        locked
          ? 'border-gold/15 bg-[linear-gradient(155deg,rgba(240,212,156,0.065),rgba(8,17,31,0.25))]'
          : 'border-cyan/15 bg-[linear-gradient(155deg,rgba(130,197,207,0.06),rgba(8,17,31,0.25))]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-xl border',
            locked ? 'border-gold/25 bg-gold/[0.07] text-gold' : 'border-cyan/25 bg-cyan/[0.07] text-cyan',
          )}
        >
          {locked ? <IconLock size={17} /> : <IconUnlock size={17} />}
        </span>
        <div className="flex items-center gap-1.5">
          <VisibilityBadge visibility={capsule.visibility} />
          {canEdit && (
            <IconButton label="删除这颗胶囊" size="sm" onClick={onDelete}>
              <IconTrash size={14} />
            </IconButton>
          )}
        </div>
      </div>

      <h3 className="mt-4 text-[16px] font-medium leading-snug text-ink">{capsule.title}</h3>
      <p className="mt-1.5 text-[11px] text-dim">
        由 {authorName} 写下 · {formatDateTime(capsule.opensAt)} {locked ? '开启' : '已开启'}
      </p>

      {locked ? (
        <div className="mt-5">
          <div className="flex items-end gap-2">
            <span className="num text-[42px] leading-none text-ink/90">{days}</span>
            <span className="pb-1 text-[11px] text-dim">天后</span>
          </div>
          <p className="num mt-2 text-[11.5px] text-gold/70">{formatCountdown(remaining)}</p>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2 text-[11px] text-dim">
            <IconLock size={12} className="text-gold/70" />
            密封中 · 到期前正文不会被读取
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-[12px] leading-relaxed text-mist/80">
            这颗胶囊已经到期。开启后，内容只对有权看到的成员展示。
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            icon={<IconUnlock size={14} />}
            loading={opening}
            onClick={onOpen}
          >
            开启胶囊
          </Button>
        </div>
      )}
    </article>
  );
}

export function CapsulesPage() {
  useDocumentTitle('时间胶囊');
  const repo = useRepository();
  const { session } = useAuth();
  const { toast } = useToast();
  const now = useAuthoritativeNow(1000);
  const data = useAsync(async () => {
    const [capsules, members] = await Promise.all([repo.listCapsules(), repo.listMembers()]);
    return { capsules, members };
  }, []);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [opensAtInput, setOpensAtInput] = useState(() => toLocalInputValue(addDays(new Date(), 30)));
  const [visibility, setVisibility] = useState<Visibility>('shared');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ capsule: Capsule; content: CapsuleContent } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Capsule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const capsules = data.data?.capsules ?? [];
  const members = data.data?.members ?? session?.members ?? [];
  const nameOf = (userId: string) => members.find((member) => member.userId === userId)?.profile.displayName ?? '成员';
  const locked = capsules.filter((capsule) => capsule.state === 'locked');
  const open = capsules.filter((capsule) => capsule.state === 'open');

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const parsed = capsuleInputSchema.safeParse({ title, bodyMd: body, visibility });
    if (!parsed.success) {
      setFormError(firstZodMessage(parsed.error));
      return;
    }
    const opensAtDate = new Date(opensAtInput);
    if (Number.isNaN(opensAtDate.getTime())) {
      setFormError('请选择有效的开启时间。');
      return;
    }
    if (opensAtDate.getTime() <= now.getTime() + 60_000) {
      setFormError('开启时间需要至少比现在晚一分钟。');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      await repo.createCapsule({
        title: parsed.data.title,
        bodyMd: parsed.data.bodyMd,
        visibility: parsed.data.visibility,
        opensAt: opensAtDate.toISOString(),
      });
      toast({ title: '胶囊已经密封', description: '在开启时间之前，正文不会被读取。', tone: 'success' });
      setCreateOpen(false);
      setTitle('');
      setBody('');
      setOpensAtInput(toLocalInputValue(addDays(new Date(), 30)));
      data.reload();
    } catch (error) {
      setFormError(errorMessage(error, '无法创建时间胶囊。'));
    } finally {
      setCreating(false);
    }
  }

  async function onOpenCapsule(capsule: Capsule) {
    setOpeningId(capsule.id);
    try {
      const content = await repo.readCapsuleBody(capsule.id);
      setOpened({ capsule, content });
    } catch (error) {
      if (isAppError(error) && error.code === 'CAPSULE_LOCKED') {
        toast({ title: '还不到时候', description: '这颗胶囊仍在密封中。', tone: 'error' });
      } else {
        toast({ title: '无法开启', description: errorMessage(error), tone: 'error' });
      }
    } finally {
      setOpeningId(null);
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await repo.removeCapsule(deleteTarget.id);
      toast({ title: '胶囊已删除', tone: 'success' });
      setDeleteTarget(null);
      data.reload();
    } catch (error) {
      toast({ title: '删除失败', description: errorMessage(error), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  if (data.loading && !data.data) return <LoadingState label="正在读取密封的信…" />;
  if (data.error) {
    return <ErrorNotice message={errorMessage(data.error, '无法读取时间胶囊。')} onRetry={data.reload} />;
  }

  const viewer = { userId: session?.user.id ?? null, isMemberOfSpace: Boolean(session?.space) };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="时间胶囊"
        title="写给未来的信"
        description="设定一个开启日期，正文会被封存。到期之前，任何客户端都读不到里面的内容；到期之后，有权限的成员才能打开。"
        actions={
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            写一封信
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[11.5px] leading-relaxed text-dim">
        <IconShield size={15} className="mt-0.5 shrink-0 text-violet/70" />
        <p>
          开启时间由服务端的权威时钟判断（本地演示使用不受系统时间调整影响的单调时钟）。把本机时间调快不会让胶囊提前解锁。
          {repo.isDemo && <span className="text-dim/70"> 真实部署时由数据库 now() 与行级权限强制。</span>}
        </p>
      </div>

      {capsules.length === 0 ? (
        <EmptyState
          icon={<IconHourglass size={20} />}
          title="还没有时间胶囊"
          description="写给一个月后、一年后的你们。等待本身也是记忆的一部分。"
          action={
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
              写第一封信
            </Button>
          }
        />
      ) : (
        <div className="space-y-7">
          {locked.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <IconLock size={14} className="text-gold/80" />
                <h2 className="text-[14px] font-medium text-ink">密封中</h2>
                <Badge tone="gold">{locked.length}</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {locked.map((capsule) => (
                  <CapsuleCard
                    key={capsule.id}
                    capsule={capsule}
                    now={now}
                    authorName={nameOf(capsule.authorId)}
                    canEdit={canEditCapsule(viewer, capsule)}
                    onOpen={() => void onOpenCapsule(capsule)}
                    onDelete={() => setDeleteTarget(capsule)}
                    opening={openingId === capsule.id}
                  />
                ))}
              </div>
            </section>
          )}

          {open.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <IconUnlock size={14} className="text-cyan/80" />
                <h2 className="text-[14px] font-medium text-ink">已开启</h2>
                <Badge tone="cyan">{open.length}</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {open.map((capsule) => (
                  <CapsuleCard
                    key={capsule.id}
                    capsule={capsule}
                    now={now}
                    authorName={nameOf(capsule.authorId)}
                    canEdit={canEditCapsule(viewer, capsule)}
                    onOpen={() => void onOpenCapsule(capsule)}
                    onDelete={() => setDeleteTarget(capsule)}
                    opening={openingId === capsule.id}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="写一封给未来的信"
        description="设定开启时间后，正文会被封存，直到那一刻。"
        size="lg"
      >
        <form onSubmit={(event) => void onCreate(event)} className="space-y-4">
          <Field label="标题" htmlFor="capsule-title">
            <Input
              id="capsule-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：一年后的我们"
              maxLength={120}
            />
          </Field>
          <Field label="正文" htmlFor="capsule-body" hint="支持 Markdown。到期之前，它会一直密封。">
            <Textarea
              id="capsule-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="想对未来的你们说什么？"
              className="min-h-[170px]"
              maxLength={20_000}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="开启时间" htmlFor="capsule-opens">
              <Input
                id="capsule-opens"
                type="datetime-local"
                value={opensAtInput}
                onChange={(event) => setOpensAtInput(event.target.value)}
                className="[color-scheme:dark]"
              />
            </Field>
            <Field label="可见范围">
              <Segmented
                label="胶囊可见范围"
                value={visibility}
                onChange={setVisibility}
                options={[
                  { value: 'shared', label: '共同可见' },
                  { value: 'private', label: '仅自己' },
                ]}
              />
            </Field>
          </div>
          {formError && (
            <p className="rounded-lg border border-rose/25 bg-rose/[0.06] px-3 py-2 text-[12.5px] text-[#efc6d2]" role="alert">
              {formError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-white/[0.06] pt-4 sm:flex-row sm:justify-end">
            <Button variant="quiet" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={creating} icon={<IconHourglass size={15} />}>
              密封这颗胶囊
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(opened)}
        onClose={() => setOpened(null)}
        title={opened?.capsule.title ?? ''}
        description={
          opened
            ? `写于 ${formatDateTime(opened.capsule.createdAt)} · 开启于 ${formatDateTime(opened.content.openedAt)}`
            : undefined
        }
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setOpened(null)}>
            收好这封信
          </Button>
        }
      >
        {opened && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="cyan">
                <IconSparkles size={10} /> 已解锁
              </Badge>
              <VisibilityBadge visibility={opened.capsule.visibility} />
              <span className="text-[11px] text-dim">{nameOf(opened.capsule.authorId)}</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4">
              <Markdown>{opened.content.bodyMd}</Markdown>
            </div>
            <p className="text-[10.5px] leading-relaxed text-dim/70">
              这封信不会再被重新密封。正文不会进入记忆检索或 AI 上下文，除非你自己把它写成一条记忆。
            </p>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void onDelete()}
        title="删除这颗时间胶囊？"
        description={
          deleteTarget
            ? `「${deleteTarget.title}」将被永久删除，正文也会一起消失。${
                deleteTarget.state === 'locked' ? '它还没有被打开过。' : ''
              }`
            : ''
        }
        confirmLabel="删除"
        loading={deleting}
      />
    </div>
  );
}
