import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useAuthoritativeNow, useDocumentTitle } from '@/app/useNow';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorNotice, LoadingState, SectionHeading, Badge } from '@/components/ui/Primitives';
import { Segmented } from '@/components/ui/Controls';
import { Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { daysTogether, describeOccurrence, sortAnniversaries } from '@/domain/anniversaries';
import { errorMessage } from '@/domain/errors';
import type { Visibility } from '@/domain/types';
import { formatDate, formatWeekday, todayDateString } from '@/lib/date';
import { initials } from '@/lib/text';
import { cn } from '@/lib/cn';
import {
  IconChevronRight,
  IconHourglass,
  IconLock,
  IconPlus,
  IconSparkles,
  IconStar,
} from '@/components/icons';
import { MemoryCard } from '@/features/memories/MemoryCard';

function greeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function HomePage() {
  useDocumentTitle('首页');
  const repo = useRepository();
  const { session } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const now = useAuthoritativeNow(30_000);
  const [quickText, setQuickText] = useState('');
  const [quickVisibility, setQuickVisibility] = useState<Visibility>('shared');
  const [saving, setSaving] = useState(false);

  const data = useAsync(async () => {
    const [memories, anniversaries, capsules, space, members] = await Promise.all([
      repo.listMemories(),
      repo.listAnniversaries(),
      repo.listCapsules(),
      repo.getCurrentSpace(),
      repo.listMembers(),
    ]);
    return { memories, anniversaries, capsules, space, members };
  }, []);

  if (data.loading && !data.data) return <LoadingState />;
  if (data.error) {
    return <ErrorNotice message={errorMessage(data.error, '无法加载首页数据。')} onRetry={data.reload} />;
  }

  const { memories, anniversaries, capsules, space, members } = data.data ?? {
    memories: [],
    anniversaries: [],
    capsules: [],
    space: session?.space ?? null,
    members: session?.members ?? [],
  };

  const sortedAnniversaries = sortAnniversaries(anniversaries, now);
  const nextAnniversary = sortedAnniversaries.find((item) => item.occurrence.state !== 'passed') ?? null;
  const mediaCount = memories.reduce((sum, memory) => sum + memory.attachments.length, 0);
  const dayCount = space?.relationshipStartAt ? daysTogether(space.relationshipStartAt, now) : null;
  const recent = memories.slice(0, 3);
  const nextCapsule =
    capsules
      .filter((capsule) => capsule.state === 'locked')
      .sort((a, b) => (a.opensAt < b.opensAt ? -1 : 1))[0] ?? null;
  const memberNames = members.map((member) => member.profile.displayName);
  const motto = space?.settings.motto?.trim() || '把故事留在星光里。';

  async function onQuickNote(event: FormEvent) {
    event.preventDefault();
    const text = quickText.trim();
    if (!text) return;
    setSaving(true);
    try {
      const firstLine = text.split('\n')[0]?.trim() ?? text;
      const title = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine || '随手记';
      await repo.createMemory({
        title,
        bodyMd: text,
        occurredOn: todayDateString(now),
        occurredTime: null,
        visibility: quickVisibility,
        locationLabel: null,
        tags: ['随手记'],
      });
      setQuickText('');
      toast({ title: '已经收进今天的星光', tone: 'success' });
      data.reload();
    } catch (error) {
      toast({ title: '没能记下这句话', description: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-9">
      <section className="grid gap-8 lg:grid-cols-[1.35fr_0.85fr] lg:items-stretch">
        <div className="flex flex-col justify-between gap-8 py-1">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="label-caps">{space?.displayName ?? '私人空间'}</p>
              {space && (
                <span className="text-[10px] text-dim/50">/</span>
              )}
              <span className="text-[10.5px] tracking-[0.12em] text-dim/80">
                {memberNames.length ? memberNames.join(' & ') : '仅限两位成员'}
              </span>
            </div>
            <h1 className="mt-5 max-w-[13em] text-[34px] font-[520] leading-[1.32] tracking-[0.005em] text-ink sm:text-[42px]">
              {motto}
            </h1>
            <p className="mt-5 max-w-md text-[13.5px] leading-[1.95] text-mist/70">
              {greeting(now.getHours())}
              {memberNames[0] ? `，${memberNames[0]}` : ''}。今天是 {formatDate(now)} · {formatWeekday(now)}
              {dayCount ? `，你们同行的第 ${dayCount} 天。` : '。'}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" icon={<IconPlus size={17} />} onClick={() => navigate('/app/memories/new')}>
                写下这一刻
              </Button>
              <Link
                to="/app/stars"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-5 text-[14px] text-mist transition-colors hover:border-white/20 hover:text-ink"
              >
                <IconStar size={16} className="text-gold/80" />
                走进星空
              </Link>
            </div>
          </div>

          <div className="grid max-w-xl grid-cols-3 divide-x divide-white/[0.07]">
            {[
              { label: '记忆', value: memories.length, unit: '条' },
              { label: '照片与影音', value: mediaCount, unit: '件' },
              { label: dayCount ? '同行' : '纪念日', value: dayCount ?? sortedAnniversaries.length, unit: dayCount ? '天' : '个' },
            ].map((stat) => (
              <div key={stat.label} className="px-4 first:pl-0">
                <p className="num text-[24px] leading-none text-ink/90">
                  {stat.value}
                  <span className="ml-1 font-sans text-[11px] text-dim">{stat.unit}</span>
                </p>
                <p className="mt-2 text-[10.5px] tracking-[0.08em] text-dim">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[linear-gradient(160deg,rgba(185,161,232,0.10),rgba(8,17,31,0.05)_55%,rgba(240,212,156,0.05))] p-6 backdrop-blur-xl sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-violet/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex h-full flex-col justify-between gap-6">
            <div className="flex items-center justify-between">
              <p className="label-caps text-[10px]">下一颗纪念日</p>
              <Link to="/app/settings#anniversaries" className="text-[11px] text-dim transition-colors hover:text-mist">
                管理
              </Link>
            </div>

            {nextAnniversary ? (
              <div>
                <p className="text-[15px] text-ink/90">{nextAnniversary.name}</p>
                <p className="mt-1.5 text-[11.5px] text-dim">
                  {nextAnniversary.occurrence.nextDate.getMonth() + 1}月
                  {nextAnniversary.occurrence.nextDate.getDate()}日 · {describeOccurrence(nextAnniversary.occurrence)}
                </p>
                <div className="mt-6 flex items-end gap-2">
                  <span className="num text-[64px] leading-[0.82] text-ink">
                    {nextAnniversary.occurrence.isToday
                      ? '今天'
                      : Math.max(0, nextAnniversary.occurrence.daysUntil)}
                  </span>
                  {!nextAnniversary.occurrence.isToday && (
                    <span className="pb-1 text-[12px] text-dim">天后</span>
                  )}
                </div>
                {nextAnniversary.occurrence.years > 0 && (
                  <p className="mt-3 text-[11px] text-gold/75">第 {nextAnniversary.occurrence.years} 个周年</p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-[14px] text-mist/80">还没有设定纪念日。</p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
                  纪念日由你们自己定义——从来不是系统猜出来的。
                </p>
                <Link
                  to="/app/settings#anniversaries"
                  className="mt-4 inline-flex items-center gap-1 text-[12px] text-violet/90 hover:underline"
                >
                  添加第一个纪念日 <IconChevronRight size={13} />
                </Link>
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-white/[0.07] pt-4">
              <div className="flex -space-x-2">
                {members.slice(0, 2).map((member, index) => (
                  <span
                    key={member.userId}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full border-2 border-[#0b1424] text-[10px] text-ink/90',
                      index === 0 ? 'bg-violet/30' : 'bg-gold/25',
                    )}
                    title={member.profile.displayName}
                  >
                    {initials(member.profile.displayName)}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-dim">
                {members.length === 2 ? '两位成员，一颗星球' : '等待另一位成员'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="quick-note-label">
        <Card className="p-5 sm:p-6">
          <form onSubmit={(event) => void onQuickNote(event)}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="quick-note-label" className="text-[14px] font-medium text-ink">
                今日想写一句话
              </h2>
              <span className="text-[10.5px] text-dim">直接保存到 {formatDate(now)}</span>
            </div>
            <Textarea
              value={quickText}
              onChange={(event) => setQuickText(event.target.value)}
              placeholder="今天有什么想留下来的？哪怕只是一句。"
              className="mt-3 min-h-[84px] border-transparent bg-transparent px-0 text-[14.5px] focus:bg-transparent"
              maxLength={2000}
              aria-label="随手记内容"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
              <Segmented
                label="可见范围"
                value={quickVisibility}
                onChange={setQuickVisibility}
                size="sm"
                options={[
                  { value: 'shared', label: '共同可见' },
                  { value: 'private', label: '仅自己' },
                ]}
              />
              <div className="flex items-center gap-3">
                <Link
                  to="/app/memories/new"
                  className="text-[11.5px] text-dim transition-colors hover:text-mist"
                >
                  完整编辑
                </Link>
                <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!quickText.trim()}>
                  记下
                </Button>
              </div>
            </div>
          </form>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          label="Recently"
          title="最近的记忆"
          action={
            <Link
              to="/app/timeline"
              className="group flex items-center gap-1 text-[11.5px] text-dim transition-colors hover:text-mist"
            >
              全部回忆 <IconChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            icon={<IconStar size={20} />}
            title="第一颗星星还在等你"
            description="写下第一个瞬间，它就会出现在时间线和星空里。"
            action={
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/app/memories/new')}>
                写第一条记忆
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/app/capsules"
          className="group glass flex items-start gap-4 rounded-2xl p-5 transition-all hover:border-white/15 hover:bg-white/[0.05]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gold/25 bg-gold/[0.07] text-gold">
            <IconHourglass size={18} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
              时间胶囊
              {nextCapsule && (
                <Badge tone="gold">
                  <IconLock size={9} />
                  {Math.max(0, Math.ceil((Date.parse(nextCapsule.opensAt) - now.getTime()) / 86_400_000))} 天后
                </Badge>
              )}
            </span>
            <span className="mt-1.5 block text-[12px] leading-relaxed text-dim">
              {nextCapsule
                ? '有一颗胶囊正在密封等待。到时间之前，谁都读不到里面的字。'
                : '写一封给未来的信，设好开启的那一天。'}
            </span>
          </span>
          <IconChevronRight size={16} className="ml-auto mt-1 shrink-0 text-dim transition-transform group-hover:translate-x-0.5" />
        </Link>

        <Link
          to="/app/ask"
          className="group glass flex items-start gap-4 rounded-2xl p-5 transition-all hover:border-white/15 hover:bg-white/[0.05]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet/25 bg-violet/[0.07] text-violet">
            <IconSparkles size={18} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
              记忆助手
              <Badge tone="violet">检索优先</Badge>
            </span>
            <span className="mt-1.5 block text-[12px] leading-relaxed text-dim">
              问一问「我们第一次看海是什么时候」，每一个回答都带着来源。
            </span>
          </span>
          <IconChevronRight size={16} className="ml-auto mt-1 shrink-0 text-dim transition-transform group-hover:translate-x-0.5" />
        </Link>
      </section>

      {memories.length > 0 && (
        <p className="pb-2 text-center text-[10.5px] tracking-[0.08em] text-dim/50">
          这里的一切只存在于你们两个人之间
        </p>
      )}
    </div>
  );
}
