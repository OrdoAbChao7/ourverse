import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useDocumentTitle } from '@/app/useNow';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Badge, EmptyState, ErrorNotice, LoadingState } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { Markdown } from '@/lib/markdown';
import { errorMessage } from '@/domain/errors';
import { canEditMemory } from '@/domain/permissions';
import { formatDate, formatMemoryDate, formatRelative, formatWeekday } from '@/lib/date';
import { IconArrowLeft, IconEdit, IconPin, IconStar, IconTrash, IconLock } from '@/components/icons';
import { AttachmentGallery } from '@/features/media/Media';
import { VisibilityBadge, AuthorChip } from '@/features/memories/MemoryCard';

export function MemoryDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const repo = useRepository();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const data = useAsync(() => repo.getMemory(id), [id]);
  useDocumentTitle(data.data?.title ?? '记忆');

  if (data.loading && !data.data) return <LoadingState label="正在展开这段记忆…" />;
  if (data.error) {
    return <ErrorNotice message={errorMessage(data.error, '无法读取这条记忆。')} onRetry={data.reload} />;
  }

  const memory = data.data;
  if (!memory) {
    return (
      <div className="space-y-4">
        <Link to="/app/timeline" className="inline-flex items-center gap-1.5 text-[12px] text-dim hover:text-mist">
          <IconArrowLeft size={14} /> 返回时光长廊
        </Link>
        <EmptyState
          icon={<IconLock size={20} />}
          title="这条记忆打不开"
          description="它可能已被删除，或者只对写它的人可见。你无法访问属于对方的私密记录。"
          action={
            <Link
              to="/app/timeline"
              className="inline-flex h-10 items-center rounded-xl border border-white/12 bg-white/[0.045] px-4 text-sm text-ink hover:bg-white/[0.075]"
            >
              回到长廊
            </Link>
          }
        />
      </div>
    );
  }

  const viewer = { userId: session?.user.id ?? null, isMemberOfSpace: Boolean(session?.space) };
  const editable = canEditMemory(viewer, memory);
  const memoryId = memory.id;

  async function onDelete() {
    setDeleting(true);
    try {
      await repo.removeMemory(memoryId);
      toast({ title: '记忆已删除', description: '它已从时间线与星空中移除。', tone: 'success' });
      navigate('/app/timeline', { replace: true });
    } catch (error) {
      toast({ title: '删除失败', description: errorMessage(error), tone: 'error' });
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/app/timeline" className="inline-flex items-center gap-1.5 text-[12px] text-dim transition-colors hover:text-mist">
          <IconArrowLeft size={14} /> 时光长廊
        </Link>
        <div className="flex items-center gap-1.5">
          <Link
            to={`/app/stars?focus=${memory.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-dim transition-colors hover:bg-white/[0.05] hover:text-mist"
          >
            <IconStar size={14} className="text-gold/80" /> 在星空中定位
          </Link>
          {editable && (
            <>
              <Link
                to={`/app/memories/${memory.id}/edit`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-mist transition-colors hover:bg-white/[0.05] hover:text-ink"
              >
                <IconEdit size={14} /> 编辑
              </Link>
              <IconButton label="删除这条记忆" size="sm" onClick={() => setConfirmOpen(true)}>
                <IconTrash size={15} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="num text-[12px] tracking-[0.04em] text-gold/80">{formatDate(memory.occurredOn)}</p>
          <span className="text-[10px] text-dim/50">·</span>
          <p className="text-[11.5px] text-dim">{formatWeekday(memory.occurredOn)}</p>
          {memory.occurredTime && (
            <>
              <span className="text-[10px] text-dim/50">·</span>
              <p className="num text-[11.5px] text-dim">{memory.occurredTime}</p>
            </>
          )}
          <VisibilityBadge visibility={memory.visibility} />
        </div>
        <h1 className="text-[30px] font-[520] leading-[1.35] text-ink sm:text-[36px]">{memory.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
          <AuthorChip name={memory.author.displayName} />
          {memory.locationLabel && (
            <span className="flex items-center gap-1.5 text-dim">
              <IconPin size={13} /> {memory.locationLabel}
            </span>
          )}
          <span className="text-dim/70">最后更新于 {formatRelative(memory.updatedAt)}</span>
          {memory.visibility === 'private' && (
            <Badge tone="rose">
              <IconLock size={10} /> 这条只有你能看到
            </Badge>
          )}
        </div>
        {memory.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {memory.tags.map((tag) => (
              <Link
                key={tag}
                to={`/app/timeline?tag=${encodeURIComponent(tag)}`}
                className="rounded-full border border-white/8 px-2.5 py-1 text-[11px] text-dim transition-colors hover:border-violet/30 hover:text-violet"
              >
                #{tag}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className="h-px w-full bg-gradient-to-r from-white/[0.09] to-transparent" />

      <article className="glass rounded-2xl p-5 sm:p-8">
        {memory.bodyMd.trim() ? (
          <Markdown>{memory.bodyMd}</Markdown>
        ) : (
          <p className="text-[13px] italic text-dim">这条记忆没有正文，只有标题和日期。</p>
        )}
      </article>

      {memory.attachments.length > 0 && (
        <section className="space-y-3" aria-labelledby="attachments-heading">
          <h2 id="attachments-heading" className="label-caps">
            附件 · {memory.attachments.length}
          </h2>
          <AttachmentGallery attachments={memory.attachments} />
          <p className="text-[10.5px] text-dim/70">原件保持私密，仅通过短期授权链接在浏览器中加载；也可以单独下载。</p>
        </section>
      )}

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-5">
        <p className="text-[11px] text-dim/60">记录于 {formatMemoryDate(memory.occurredOn, memory.occurredTime)}</p>
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/timeline')}>
          返回长廊
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void onDelete()}
        title="删除这条记忆？"
        description={
          <>
            「{memory.title}」会从时间线、星空和导出中消失。此操作对你和对方都会生效，且不可撤销。
          </>
        }
        confirmLabel="删除"
        loading={deleting}
      />
    </div>
  );
}
