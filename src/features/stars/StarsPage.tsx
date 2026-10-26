import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useDocumentTitle } from '@/app/useNow';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState, ErrorNotice, LoadingState, PageHeader } from '@/components/ui/Primitives';
import { Segmented as SegmentedControl } from '@/components/ui/Controls';
import { IconPlus, IconStar } from '@/components/icons';
import { AuthorChip, MemoryRow, VisibilityBadge } from '@/features/memories/MemoryCard';
import { buildStarMap, type StarMap } from '@/domain/stars';
import { errorMessage } from '@/domain/errors';
import type { MemoryWithAuthor } from '@/domain/types';
import { excerpt } from '@/lib/text';
import { formatDate } from '@/lib/date';

const STAR_COLORS = {
  shared: 'rgba(238, 242, 250, 0.95)',
  private: 'rgba(224, 162, 182, 0.95)',
} as const;

function StarCanvas({
  starMap,
  memories,
  hoveredId,
  selectedId,
  reducedMotion,
}: {
  starMap: StarMap;
  memories: MemoryWithAuthor[];
  hoveredId: string | null;
  selectedId: string | null;
  reducedMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(starMap.width * dpr);
    canvas.height = Math.floor(starMap.height * dpr);
    canvas.style.width = `${starMap.width}px`;
    canvas.style.height = `${starMap.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const memoryMap = new Map(memories.map((memory) => [memory.id, memory]));
    const starMapById = new Map(starMap.stars.map((star) => [star.memoryId, star]));
    let raf = 0;
    const start = performance.now();

    const draw = (time: number) => {
      context.clearRect(0, 0, starMap.width, starMap.height);

      // Constellation lines
      context.lineWidth = 0.7;
      context.strokeStyle = 'rgba(185, 161, 232, 0.16)';
      for (const constellation of starMap.constellations) {
        for (const line of constellation.lines) {
          const from = starMapById.get(line.from);
          const to = starMapById.get(line.to);
          if (!from || !to) continue;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();
        }
      }

      // Stars
      for (const star of starMap.stars) {
        const memory = memoryMap.get(star.memoryId);
        const isHovered = hoveredId === star.memoryId;
        const isSelected = selectedId === star.memoryId;
        const twinkle = reducedMotion ? 1 : 0.8 + 0.2 * Math.sin((time - start) * 0.0012 + star.phase);
        const alpha = Math.min(1, star.brightness * twinkle);
        const baseColor = memory?.visibility === 'private' ? STAR_COLORS.private : STAR_COLORS.shared;
        const radius = star.radius * (isHovered || isSelected ? 1.9 : 1);

        context.beginPath();
        context.fillStyle = baseColor;
        context.globalAlpha = isHovered || isSelected ? 1 : alpha;
        context.arc(star.x, star.y, radius, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;

        const glow = isHovered || isSelected ? 5.5 : 3.4;
        const gradient = context.createRadialGradient(star.x, star.y, 0, star.x, star.y, radius * glow);
        gradient.addColorStop(0, `rgba(185, 161, 232, ${isHovered || isSelected ? 0.38 : 0.16})`);
        gradient.addColorStop(1, 'rgba(185, 161, 232, 0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(star.x, star.y, radius * glow, 0, Math.PI * 2);
        context.fill();

        if (isSelected) {
          context.beginPath();
          context.strokeStyle = 'rgba(240, 212, 156, 0.75)';
          context.lineWidth = 1;
          context.arc(star.x, star.y, radius * 3.6, 0, Math.PI * 2);
          context.stroke();
        }
      }
    };

    if (reducedMotion) {
      draw(0);
      return;
    }

    let last = 0;
    const loop = (time: number) => {
      if (time - last > 45) {
        draw(time);
        last = time;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [starMap, memories, hoveredId, selectedId, reducedMotion]);

  return <canvas ref={canvasRef} className="block" aria-hidden="true" />;
}

export function StarsPage() {
  useDocumentTitle('星空');
  const repo = useRepository();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion() ?? false;
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const [view, setView] = useState<'stars' | 'list'>('stars');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const data = useAsync(() => repo.listMemories(), []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view, data.data]);

  const memories = useMemo(() => data.data ?? [], [data.data]);
  const starMap = useMemo(
    () => (width > 0 ? buildStarMap(memories, { width }) : null),
    [memories, width],
  );

  useEffect(() => {
    if (!focusId || !starMap) return;
    if (starMap.stars.some((star) => star.memoryId === focusId)) {
      setSelectedId(focusId);
      setView('stars');
      const element = document.getElementById(`star-${focusId}`);
      element?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [focusId, starMap, reducedMotion]);

  const selectedMemory = memories.find((memory) => memory.id === selectedId) ?? null;
  const hoveredMemory = memories.find((memory) => memory.id === hoveredId) ?? null;

  function selectStar(memoryId: string) {
    setSelectedId(memoryId);
    setSearchParams({ focus: memoryId }, { replace: true });
  }

  function closeDetail() {
    setSelectedId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }

  if (data.loading && !data.data) return <LoadingState label="正在点亮星空…" />;
  if (data.error) {
    return <ErrorNotice message={errorMessage(data.error, '无法读取星空数据。')} onRetry={data.reload} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="星空记忆"
        title="每一颗星，都是一段真实的记忆"
        description="按发生月份自动结成星座。星星不会随机生成——你看到的每一颗，都能打开对应的一天。"
        actions={
          <>
            <SegmentedControl
              label="视图"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'stars', label: '星空' },
                { value: 'list', label: '列表' },
              ]}
            />
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/app/memories/new')}>
              新建记忆
            </Button>
          </>
        }
      />

      {memories.length === 0 ? (
        <EmptyState
          icon={<IconStar size={20} />}
          title="夜空还是空的"
          description="等你写下第一条记忆，第一颗星就会亮起来。"
          action={
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/app/memories/new')}>
              点亮第一颗星
            </Button>
          }
        />
      ) : view === 'list' ? (
        <div className="space-y-2">
          {memories.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-dim">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-[#eef2fa]" /> 共同记忆
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-[#e0a2b6]" /> 仅自己可见
              </span>
              <span className="hidden sm:inline">· 同一月份的星点连成星座</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-dim">
              <span className="num">{memories.length}</span> 颗星 ·{' '}
              <span className="num">{starMap?.constellations.length ?? 0}</span> 个星座
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" aria-label="按月份跳转">
            {starMap?.months.map((month) => (
              <button
                key={month.monthKey}
                type="button"
                onClick={() => {
                  document.getElementById(`month-${month.monthKey}`)?.scrollIntoView({
                    block: 'center',
                    behavior: reducedMotion ? 'auto' : 'smooth',
                  });
                }}
                className="shrink-0 rounded-full border border-white/8 px-2.5 py-1 text-[11px] text-dim transition-colors hover:border-white/20 hover:text-mist"
              >
                {month.label}
              </button>
            ))}
          </div>

          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[radial-gradient(120%_70%_at_50%_0%,rgba(24,38,66,0.65),rgba(6,12,22,0.4))]"
          >
            <div className="pointer-events-none absolute inset-0 dot-grid opacity-[0.16]" aria-hidden="true" />
            <div className="relative">
              {starMap && (
                <>
                  <StarCanvas
                    starMap={starMap}
                    memories={memories}
                    hoveredId={hoveredId}
                    selectedId={selectedId}
                    reducedMotion={reducedMotion}
                  />
                  {starMap.months.map((month) => (
                    <div
                      key={month.monthKey}
                      id={`month-${month.monthKey}`}
                      className="pointer-events-none absolute"
                      style={{ left: Math.max(14, month.x - 50), top: month.y - 6 }}
                    >
                      <p className="num text-[10px] tracking-[0.1em] text-mist/55">{month.label}</p>
                    </div>
                  ))}
                  {starMap.stars.map((star) => {
                    const memory = memories.find((item) => item.id === star.memoryId);
                    if (!memory) return null;
                    return (
                      <div key={star.memoryId} className="absolute" style={{ left: star.x - 14, top: star.y - 14 }}>
                        <button
                          id={`star-${star.memoryId}`}
                          type="button"
                          onClick={() => selectStar(star.memoryId)}
                          onMouseEnter={() => setHoveredId(star.memoryId)}
                          onMouseLeave={() => setHoveredId((current) => (current === star.memoryId ? null : current))}
                          onFocus={() => setHoveredId(star.memoryId)}
                          onBlur={() => setHoveredId((current) => (current === star.memoryId ? null : current))}
                          aria-label={`${formatDate(memory.occurredOn)} · ${memory.title}${
                            memory.visibility === 'private' ? '（仅自己可见）' : ''
                          }`}
                          className="flex size-7 items-center justify-center rounded-full focus-visible:bg-white/10"
                        >
                          <span className="sr-only">{memory.title}</span>
                        </button>
                      </div>
                    );
                  })}
                  {hoveredMemory && (
                    <div
                      className="pointer-events-none absolute z-10 max-w-[220px] -translate-x-1/2 rounded-lg border border-white/12 bg-[rgba(6,12,22,0.92)] px-3 py-2 shadow-xl backdrop-blur"
                      style={{
                        left:
                          (starMap.stars.find((star) => star.memoryId === hoveredMemory.id)?.x ?? 0),
                        top: Math.max(8, (starMap.stars.find((star) => star.memoryId === hoveredMemory.id)?.y ?? 0) - 54),
                      }}
                    >
                      <p className="text-[11.5px] leading-snug text-ink">{hoveredMemory.title}</p>
                      <p className="mt-0.5 text-[10px] text-dim">
                        {formatDate(hoveredMemory.occurredOn)}
                        {hoveredMemory.visibility === 'private' ? ' · 仅自己' : ''}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <p className="text-center text-[10.5px] text-dim/60">
            提示：用 Tab 键可以在星点之间移动，回车打开对应的记忆。
          </p>
        </div>
      )}

      <Dialog
        open={Boolean(selectedMemory)}
        onClose={closeDetail}
        title={selectedMemory?.title ?? ''}
        description={selectedMemory ? formatDate(selectedMemory.occurredOn) : undefined}
        size="md"
        footer={
          selectedMemory ? (
            <>
              <Button variant="quiet" onClick={closeDetail}>
                关闭
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  closeDetail();
                  navigate(`/app/memories/${selectedMemory.id}`);
                }}
              >
                打开完整记忆
              </Button>
            </>
          ) : null
        }
      >
        {selectedMemory && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <VisibilityBadge visibility={selectedMemory.visibility} />
              <AuthorChip name={selectedMemory.author.displayName} />
              {selectedMemory.locationLabel && (
                <span className="text-[11px] text-dim">{selectedMemory.locationLabel}</span>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-mist/85">{excerpt(selectedMemory.bodyMd, 220)}</p>
            {selectedMemory.attachments.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-dim">
                <IconStar size={13} className="text-gold/70" />
                {selectedMemory.attachments.length} 个附件
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
