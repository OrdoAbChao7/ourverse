import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useDocumentTitle } from '@/app/useNow';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Chip, EmptyState, ErrorNotice, LoadingState, PageHeader, SectionHeading } from '@/components/ui/Primitives';
import { IconBook, IconPlus, IconSearch, IconStar, IconLock } from '@/components/icons';
import { MemoryRow } from '@/features/memories/MemoryCard';
import { searchMemories } from '@/domain/search';
import { errorMessage } from '@/domain/errors';
import type { MemoryWithAuthor, Visibility } from '@/domain/types';
import { formatMonth, monthKeyOf } from '@/lib/date';

type AuthorFilter = 'all' | 'mine' | string;

export function TimelinePage() {
  useDocumentTitle('时光长廊');
  const repo = useRepository();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [visibility, setVisibility] = useState<'all' | Visibility>('all');
  const [author, setAuthor] = useState<AuthorFilter>('all');
  const [tag, setTag] = useState<string | null>(null);

  const data = useAsync(() => repo.listMemories(), []);
  const memories = useMemo(() => data.data ?? [], [data.data]);
  const members = session?.members ?? [];

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const memory of memories) {
      for (const item of memory.tags) counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name]) => name);
  }, [memories]);

  const filtered = useMemo(() => {
    let result: MemoryWithAuthor[] = memories;
    if (visibility !== 'all') result = result.filter((memory) => memory.visibility === visibility);
    if (author === 'mine') result = result.filter((memory) => memory.authorId === session?.user.id);
    else if (author !== 'all') result = result.filter((memory) => memory.authorId === author);
    if (tag) result = result.filter((memory) => memory.tags.includes(tag));
    if (deferredQuery.trim()) {
      return searchMemories(result, deferredQuery.trim(), { now: new Date() }).map((entry) => entry.memory);
    }
    return result.slice().sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  }, [memories, visibility, author, tag, deferredQuery, session?.user.id]);

  const grouped = useMemo(() => {
    const groups: { key: string; label: string; items: MemoryWithAuthor[] }[] = [];
    for (const memory of filtered) {
      const key = monthKeyOf(memory.occurredOn);
      const existing = groups[groups.length - 1];
      if (existing && existing.key === key) existing.items.push(memory);
      else groups.push({ key, label: formatMonth(memory.occurredOn), items: [memory] });
    }
    return groups;
  }, [filtered]);

  const activeFilter = visibility !== 'all' || author !== 'all' || tag !== null || Boolean(deferredQuery);

  if (data.loading && !data.data) return <LoadingState label="正在翻开时光长廊…" />;
  if (data.error) {
    return <ErrorNotice message={errorMessage(data.error, '无法读取记忆列表。')} onRetry={data.reload} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="时光长廊"
        title="所有被留下的时刻"
        description={
          memories.length > 0
            ? `共 ${memories.length} 条记录，按发生时间排列。共同记录双方都能看见；私密记录只有写下它的人可以打开。`
            : '还没有记录。写下第一刻，长廊就会开始生长。'
        }
        actions={
          <>
            <Link
              to="/app/stars"
              className="hidden h-10 items-center gap-1.5 rounded-xl border border-white/10 px-3.5 text-[12.5px] text-mist transition-colors hover:border-white/20 hover:text-ink sm:inline-flex"
            >
              <IconStar size={15} className="text-gold/80" /> 星空视图
            </Link>
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/app/memories/new')}>
              新建记忆
            </Button>
          </>
        }
      />

      <div className="space-y-3">
        <div className="relative">
          <IconSearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、正文、地点或日期，例如「海边」「2025年7月」"
            className="h-11 pl-10"
            aria-label="搜索记忆"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="筛选记忆">
          <Chip selected={visibility === 'all'} onClick={() => setVisibility('all')}>
            全部
          </Chip>
          <Chip selected={visibility === 'shared'} onClick={() => setVisibility('shared')}>
            <span className="size-1.5 rounded-full bg-cyan/70" /> 共同
          </Chip>
          <Chip selected={visibility === 'private'} onClick={() => setVisibility('private')}>
            <IconLock size={11} /> 仅自己
          </Chip>
          <span className="mx-1 w-px shrink-0 bg-white/10" aria-hidden="true" />
          <Chip selected={author === 'all'} onClick={() => setAuthor('all')}>
            所有作者
          </Chip>
          <Chip selected={author === 'mine'} onClick={() => setAuthor('mine')}>
            我写的
          </Chip>
          {members
            .filter((member) => member.userId !== session?.user.id)
            .map((member) => (
              <Chip
                key={member.userId}
                selected={author === member.userId}
                onClick={() => setAuthor(member.userId)}
              >
                {member.profile.displayName}
              </Chip>
            ))}
          {tagOptions.length > 0 && <span className="mx-1 w-px shrink-0 bg-white/10" aria-hidden="true" />}
          {tagOptions.map((option) => (
            <Chip key={option} selected={tag === option} onClick={() => setTag(tag === option ? null : option)}>
              #{option}
            </Chip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        memories.length === 0 ? (
          <EmptyState
            icon={<IconBook size={20} />}
            title="长廊里还没有故事"
            description="记录一次见面、一顿饭、一个普通的下午。它们会按时间自动排好。"
            action={
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/app/memories/new')}>
                写下第一条
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<IconSearch size={20} />}
            title="没有找到符合条件的记录"
            description="试试更少的关键词，或清除筛选条件。搜索只会在你有权查看的记录中进行。"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setVisibility('all');
                  setAuthor('all');
                  setTag(null);
                }}
              >
                清除筛选
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-8">
          {activeFilter && (
            <p className="text-[11.5px] text-dim">
              找到 <span className="num text-mist">{filtered.length}</span> 条记录
            </p>
          )}
          {grouped.map((group) => (
            <section key={group.key} aria-labelledby={`month-${group.key}`}>
              <div className="sticky top-14 z-10 -mx-2 mb-2 flex items-center gap-3 bg-[#08111f]/75 px-2 py-2 backdrop-blur-md lg:top-0">
                <h2 id={`month-${group.key}`} className="num text-[12px] tracking-[0.06em] text-mist/80">
                  {group.label}
                </h2>
                <span className="h-px flex-1 bg-white/[0.06]" />
                <span className="text-[10px] text-dim/60">{group.items.length} 条</span>
              </div>
              <div className="space-y-1">
                {group.items.map((memory) => (
                  <MemoryRow key={memory.id} memory={memory} />
                ))}
              </div>
            </section>
          ))}
          <SectionHeading
            label=""
            title={<span className="text-[12px] font-normal text-dim">已经到底了 · 共 {filtered.length} 条</span>}
            className="justify-center pt-2"
          />
        </div>
      )}
    </div>
  );
}
