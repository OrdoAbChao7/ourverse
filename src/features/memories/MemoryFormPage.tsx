import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useDocumentTitle } from '@/app/useNow';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Segmented, Switch } from '@/components/ui/Controls';
import { Badge, EmptyState, ErrorNotice, LoadingState } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { TagInput } from '@/components/ui/TagInput';
import { Markdown } from '@/lib/markdown';
import { firstZodMessage, memoryInputSchema } from '@/domain/schemas';
import { errorMessage } from '@/domain/errors';
import { canEditMemory } from '@/domain/permissions';
import type { Attachment, MemoryWithAuthor, Visibility } from '@/domain/types';
import { todayDateString } from '@/lib/date';
import { IconArrowLeft, IconEye, IconLock, IconEdit, IconPlus, IconShield } from '@/components/icons';
import { AttachmentPicker } from './AttachmentPicker';

type ErrorMap = Partial<Record<'title' | 'bodyMd' | 'occurredOn' | 'occurredTime' | 'locationLabel' | 'tags', string>>;

/**
 * Loads the record (for edit mode) and only then mounts the form with its
 * initial values. Mounting the form after loading avoids a race where a user
 * (or a test) could type before the stored values were applied.
 */
export function MemoryFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id = '' } = useParams<{ id: string }>();
  const repo = useRepository();
  const { session } = useAuth();
  const navigate = useNavigate();
  const isEdit = mode === 'edit';
  useDocumentTitle(isEdit ? '编辑记忆' : '新的记忆');

  const memoryQuery = useAsync(() => (isEdit ? repo.getMemory(id) : Promise.resolve(null)), [id, isEdit]);
  const suggestionsQuery = useAsync(() => repo.listMemories(), []);
  const memory = memoryQuery.data ?? null;

  const suggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of suggestionsQuery.data ?? []) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [suggestionsQuery.data]);

  if (isEdit && memoryQuery.loading && !memory) return <LoadingState label="正在打开这段记忆…" />;
  if (isEdit && memoryQuery.error) {
    return <ErrorNotice message={errorMessage(memoryQuery.error, '无法读取记忆。')} onRetry={memoryQuery.reload} />;
  }
  if (isEdit && !memory) {
    return (
      <EmptyState
        icon={<IconLock size={20} />}
        title="无法编辑这条记忆"
        description="它可能已被删除，或者只属于另一个人。你只能编辑自己写下的内容。"
        action={
          <Button variant="secondary" onClick={() => navigate('/app/timeline')}>
            返回长廊
          </Button>
        }
      />
    );
  }
  const viewer = { userId: session?.user.id ?? null, isMemberOfSpace: Boolean(session?.space) };
  if (isEdit && memory && !canEditMemory(viewer, memory)) {
    return (
      <EmptyState
        icon={<IconLock size={20} />}
        title="只能编辑自己的记录"
        description="共同记录双方都能看见，但只有作者本人可以修改或删除。"
        action={
          <Button variant="secondary" onClick={() => navigate(`/app/memories/${memory.id}`)}>
            查看详情
          </Button>
        }
      />
    );
  }

  return (
    <MemoryForm
      key={memory?.id ?? 'new-memory'}
      mode={mode}
      memory={memory}
      suggestions={suggestions}
    />
  );
}

function MemoryForm({
  mode,
  memory,
  suggestions,
}: {
  mode: 'create' | 'edit';
  memory: MemoryWithAuthor | null;
  suggestions: string[];
}) {
  const repo = useRepository();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = mode === 'edit';

  const [title, setTitle] = useState(memory?.title ?? '');
  const [body, setBody] = useState(memory?.bodyMd ?? '');
  const [occurredOn, setOccurredOn] = useState(() => memory?.occurredOn ?? todayDateString(new Date()));
  const [hasTime, setHasTime] = useState(Boolean(memory?.occurredTime));
  const [occurredTime, setOccurredTime] = useState(memory?.occurredTime ?? '');
  const [visibility, setVisibility] = useState<Visibility>(memory?.visibility ?? 'shared');
  const [location, setLocation] = useState(memory?.locationLabel ?? '');
  const [tags, setTags] = useState<string[]>(memory?.tags ?? []);
  const [existing] = useState<Attachment[]>(memory?.attachments ?? []);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [editorTab, setEditorTab] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function validate(): boolean {
    const parsed = memoryInputSchema.safeParse({
      title,
      bodyMd: body,
      occurredOn,
      occurredTime: hasTime ? occurredTime : null,
      visibility,
      locationLabel: location,
      tags,
    });
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const next: ErrorMap = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && !next[field as keyof ErrorMap]) {
        next[field as keyof ErrorMap] = issue.message;
      }
    }
    setErrors(next);
    toast({ title: '还有几处需要补充', description: firstZodMessage(parsed.error), tone: 'error' });
    return false;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    if (!validate()) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      bodyMd: body,
      occurredOn,
      occurredTime: hasTime && occurredTime ? occurredTime : null,
      visibility,
      locationLabel: location.trim() || null,
      tags,
    };
    try {
      if (isEdit && memory) {
        await repo.updateMemory(memory.id, {
          ...payload,
          addFiles: newFiles,
          removeAttachmentIds: [...removedIds],
        });
        toast({ title: '已经更新', tone: 'success' });
        navigate(`/app/memories/${memory.id}`, { replace: true });
      } else {
        const created = await repo.createMemory({ ...payload, files: newFiles });
        toast({ title: '这一刻已经留在星光里', tone: 'success' });
        navigate(`/app/memories/${created.id}`, { replace: true });
      }
    } catch (error) {
      setSaveError(errorMessage(error, '保存失败，请稍后再试。'));
      toast({ title: '保存失败', description: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const backTo = isEdit && memory ? `/app/memories/${memory.id}` : '/app/timeline';

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={backTo} className="inline-flex items-center gap-1.5 text-[12px] text-dim transition-colors hover:text-mist">
          <IconArrowLeft size={14} /> 返回
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(backTo)} disabled={saving}>
            取消
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {isEdit ? '保存修改' : '保存这一刻'}
          </Button>
        </div>
      </div>

      <header className="space-y-2">
        <p className="label-caps">{isEdit ? '编辑记忆' : '新的记忆'}</p>
        <h1 className="text-[26px] font-[540] text-ink">{isEdit ? '修改这段记录' : '写下此刻'}</h1>
        <p className="text-[12.5px] leading-relaxed text-dim">
          日期按你所在时区保存。没有具体时间也没关系，它可以只是一天。
        </p>
      </header>

      {saveError && <ErrorNotice title="没有保存成功" message={saveError} />}

      <div className="glass space-y-6 rounded-2xl p-5 sm:p-7">
        <Field
          label="标题"
          htmlFor="memory-title"
          required
          error={errors.title}
          aside={<span className="text-[10.5px] text-dim">{title.length}/120</span>}
        >
          <Input
            id="memory-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="给这一刻一个名字"
            maxLength={120}
            invalid={Boolean(errors.title)}
            className="h-12 text-[16px]"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="发生日期" htmlFor="memory-date" required error={errors.occurredOn}>
            <Input
              id="memory-date"
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
              invalid={Boolean(errors.occurredOn)}
              className="[color-scheme:dark]"
            />
          </Field>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-mist">具体时间</span>
              <Switch
                checked={hasTime}
                onChange={(value) => {
                  setHasTime(value);
                  if (value && !occurredTime) setOccurredTime('12:00');
                }}
                label="记录具体时间"
              />
            </div>
            {hasTime ? (
              <Input
                type="time"
                value={occurredTime}
                onChange={(event) => setOccurredTime(event.target.value)}
                aria-label="发生时间"
                invalid={Boolean(errors.occurredTime)}
                className="[color-scheme:dark]"
              />
            ) : (
              <p className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-3 text-[12px] text-dim">
                只记录日期，不记录时刻。
              </p>
            )}
            {errors.occurredTime && <p className="text-[12px] text-[#f3b6c6]">{errors.occurredTime}</p>}
          </div>
        </div>

        <Field
          label="可见范围"
          hint={
            visibility === 'shared'
              ? '双方都能在时间线、星空和导出中看到这条记录。'
              : '只有你自己能看到。它不会出现在对方的列表、检索、AI 上下文或导出里。'
          }
        >
          <Segmented
            label="可见范围"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'shared', label: <span className="flex items-center gap-1.5"><IconEye size={13} /> 共同可见</span> },
              { value: 'private', label: <span className="flex items-center gap-1.5"><IconLock size={13} /> 仅自己</span> },
            ]}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="地点" htmlFor="memory-location" error={errors.locationLabel} hint="可选，例如「青岛 · 金沙滩」。">
            <Input
              id="memory-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="当时在哪里"
              maxLength={80}
            />
          </Field>
          <Field label="标签" hint="用回车添加，最多 12 个。" error={errors.tags}>
            <TagInput value={tags} onChange={setTags} suggestions={suggestions} max={12} />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-mist">正文</span>
            <Segmented
              label="编辑器模式"
              size="sm"
              value={editorTab}
              onChange={setEditorTab}
              options={[
                { value: 'write', label: <span className="flex items-center gap-1"><IconEdit size={12} /> 编辑</span> },
                { value: 'preview', label: <span className="flex items-center gap-1"><IconEye size={12} /> 预览</span> },
              ]}
            />
          </div>
          {editorTab === 'write' ? (
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="发生了什么？当时在想什么？&#10;&#10;支持 Markdown：**加粗**、*斜体*、`代码`、列表、引用、链接。"
              className="min-h-[260px] text-[14.5px]"
              maxLength={20_000}
              aria-label="正文"
            />
          ) : (
            <div className="min-h-[260px] rounded-xl border border-white/10 bg-[rgba(8,17,31,0.35)] p-4">
              {body.trim() ? (
                <Markdown>{body}</Markdown>
              ) : (
                <p className="text-[13px] italic text-dim">还没有正文，切回编辑开始写吧。</p>
              )}
            </div>
          )}
          <div className="flex items-center justify-between text-[10.5px] text-dim">
            <span>正文为 Markdown，原始 HTML 不会被执行。</span>
            <span className="num">{body.length}/20000</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-mist">照片、声音与影像</span>
            <Badge tone="neutral">
              {existing.filter((attachment) => !removedIds.has(attachment.id)).length + newFiles.length} 个附件
            </Badge>
          </div>
          <AttachmentPicker
            files={newFiles}
            onChange={setNewFiles}
            existing={existing}
            removedIds={removedIds}
            onToggleRemoved={(attachmentId) => {
              setRemovedIds((current) => {
                const next = new Set(current);
                if (next.has(attachmentId)) next.delete(attachmentId);
                else next.add(attachmentId);
                return next;
              });
            }}
            onError={(message) => toast({ title: '附件未添加', description: message, tone: 'error' })}
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-[11px] text-dim/70">
          <IconShield size={13} className="text-violet/70" />
          {visibility === 'shared' ? '保存后，对方可以看到这条共同记忆。' : '保存后，这条只存在于你自己的视野里。'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate(backTo)} disabled={saving}>
            取消
          </Button>
          <Button type="submit" variant="primary" loading={saving} icon={<IconPlus size={16} />}>
            {isEdit ? '保存修改' : '保存这一刻'}
          </Button>
        </div>
      </div>
    </form>
  );
}
