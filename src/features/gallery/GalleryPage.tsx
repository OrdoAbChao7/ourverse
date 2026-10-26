import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useDocumentTitle } from '@/app/useNow';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, EmptyState, ErrorNotice, LoadingState, PageHeader, SectionHeading } from '@/components/ui/Primitives';
import { Segmented } from '@/components/ui/Controls';
import { useToast } from '@/components/ui/Toast';
import { AttachmentCard } from '@/features/media/Media';
import { downloadAttachment } from '@/features/media/download';
import { useAttachmentUrl } from '@/features/media/useAttachmentUrl';
import { errorMessage } from '@/domain/errors';
import type { Attachment, MemoryWithAuthor } from '@/domain/types';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/cn';
import {
  IconArchive,
  IconAudio,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconImage,
  IconLock,
  IconPlus,
  IconVideo,
} from '@/components/icons';

type Filter = 'all' | 'image' | 'audio' | 'video';

interface MuseumItem {
  attachment: Attachment;
  memory: MemoryWithAuthor;
}

function PhotoTile({ item, onOpen }: { item: MuseumItem; onOpen: () => void }) {
  const { url } = useAttachmentUrl(item.attachment.id);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] text-left"
      aria-label={`查看照片 ${item.memory.title}`}
    >
      {url ? (
        <img
          src={url}
          alt={item.memory.title}
          loading="lazy"
          className="aspect-[4/3] w-full object-cover transition-transform duration-500 ease-[var(--ease-quiet)] group-hover:scale-[1.03]"
        />
      ) : (
        <div className="aspect-[4/3] w-full animate-pulse bg-white/[0.04]" />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-[#04080f]/85 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
      <span className="absolute inset-x-0 bottom-0 translate-y-1 p-3 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
        <span className="block truncate text-[12.5px] text-ink">{item.memory.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[10px] text-mist/70">
          {formatDate(item.memory.occurredOn)}
          {item.memory.visibility === 'private' && (
            <span className="flex items-center gap-0.5">
              <IconLock size={9} /> 仅自己
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function GalleryViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: MuseumItem[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const { url } = useAttachmentUrl(item?.attachment.id);
  const repo = useRepository();
  const { toast } = useToast();

  useEffect(() => {
    if (!item) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') onIndex((index + 1) % items.length);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + items.length) % items.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, item, items.length, onIndex]);

  if (!item) return null;

  return (
    <Dialog open onClose={onClose} title={item.memory.title} description={formatDate(item.memory.occurredOn)} size="xl">
      <div className="relative overflow-hidden rounded-xl bg-black/35">
        {url ? (
          <img src={url} alt={item.memory.title} className="max-h-[68vh] w-full object-contain" />
        ) : (
          <div className="h-72 w-full animate-pulse bg-white/[0.04]" />
        )}
        {items.length > 1 && (
          <>
            <IconButton
              label="上一张"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-[#060c16]/70 backdrop-blur"
              onClick={() => onIndex((index - 1 + items.length) % items.length)}
            >
              <IconChevronLeft size={18} />
            </IconButton>
            <IconButton
              label="下一张"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#060c16]/70 backdrop-blur"
              onClick={() => onIndex((index + 1) % items.length)}
            >
              <IconChevronRight size={18} />
            </IconButton>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11.5px] text-dim">
        <span>
          {index + 1} / {items.length} · 来自《{item.memory.title}》
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconDownload size={14} />}
          onClick={() =>
            void downloadAttachment(repo, item.attachment).catch((error: unknown) =>
              toast({ title: '下载失败', description: errorMessage(error), tone: 'error' }),
            )
          }
        >
          下载原件
        </Button>
      </div>
    </Dialog>
  );
}

export function GalleryPage() {
  useDocumentTitle('数字博物馆');
  const repo = useRepository();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const data = useAsync(() => repo.listMemories(), []);
  const memories = useMemo(() => data.data ?? [], [data.data]);

  const items = useMemo<MuseumItem[]>(
    () =>
      memories
        .flatMap((memory) => memory.attachments.map((attachment) => ({ attachment, memory })))
        .sort((a, b) => (a.memory.occurredAt < b.memory.occurredAt ? 1 : -1)),
    [memories],
  );

  const photos = items.filter((item) => item.attachment.kind === 'image');
  const audios = items.filter((item) => item.attachment.kind === 'audio');
  const videos = items.filter((item) => item.attachment.kind === 'video');

  if (data.loading && !data.data) return <LoadingState label="正在布置展厅…" />;
  if (data.error) {
    return <ErrorNotice message={errorMessage(data.error, '无法读取博物馆数据。')} onRetry={data.reload} />;
  }

  const visiblePhotos = filter === 'all' || filter === 'image' ? photos : [];
  const visibleAudios = filter === 'all' || filter === 'audio' ? audios : [];
  const visibleVideos = filter === 'all' || filter === 'video' ? videos : [];
  const hasAnything = items.length > 0;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="数字博物馆"
        title="被保存下来的光"
        description={`${photos.length} 张照片 · ${audios.length} 段声音 · ${videos.length} 段影像。原件保持私密，可单独下载；也可以整馆导出为断网可看的离线包。`}
        actions={
          <>
            <Link
              to="/app/settings#export"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/10 px-3.5 text-[12.5px] text-mist transition-colors hover:border-white/20 hover:text-ink"
            >
              <IconArchive size={15} /> 离线珍藏
            </Link>
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/app/memories/new')}>
              新建记忆
            </Button>
          </>
        }
      />

      {!hasAnything ? (
        <EmptyState
          icon={<IconImage size={20} />}
          title="展厅还没有展品"
          description="在新建记忆时附上照片、声音或影像，它们会自动来到这里。"
          action={
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/app/memories/new')}>
              添加第一件展品
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
            <Segmented
              label="展厅筛选"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `全部 ${items.length}` },
                { value: 'image', label: `照片 ${photos.length}` },
                { value: 'audio', label: `声音 ${audios.length}` },
                { value: 'video', label: `影像 ${videos.length}` },
              ]}
            />
            <p className="text-[10.5px] text-dim/60">点击照片可全屏查看并下载原件</p>
          </div>

          {visiblePhotos.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                label="Photo hall"
                title={
                  <span className="flex items-center gap-2">
                    照片展厅 <Badge tone="neutral">{visiblePhotos.length}</Badge>
                  </span>
                }
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {visiblePhotos.map((item) => (
                  <PhotoTile
                    key={item.attachment.id}
                    item={item}
                    onOpen={() => setViewerIndex(photos.findIndex((photo) => photo.attachment.id === item.attachment.id))}
                  />
                ))}
              </div>
            </section>
          )}

          {visibleAudios.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                label="Voice collection"
                title={
                  <span className="flex items-center gap-2">
                    <IconAudio size={16} className="text-cyan/80" /> 声音收藏 <Badge tone="cyan">{visibleAudios.length}</Badge>
                  </span>
                }
              />
              <div className="grid gap-3 lg:grid-cols-2">
                {visibleAudios.map((item) => (
                  <div key={item.attachment.id} className="space-y-2">
                    <AttachmentCard attachment={item.attachment} />
                    <Link
                      to={`/app/memories/${item.memory.id}`}
                      className="block truncate px-1 text-[10.5px] text-dim hover:text-mist"
                    >
                      来自《{item.memory.title}》 · {formatDate(item.memory.occurredOn)}
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          {visibleVideos.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                label="Film memories"
                title={
                  <span className="flex items-center gap-2">
                    <IconVideo size={16} className="text-violet/80" /> 影像回忆 <Badge tone="violet">{visibleVideos.length}</Badge>
                  </span>
                }
              />
              <div className="grid gap-3 lg:grid-cols-2">
                {visibleVideos.map((item) => (
                  <div key={item.attachment.id} className="space-y-2">
                    <AttachmentCard attachment={item.attachment} />
                    <Link
                      to={`/app/memories/${item.memory.id}`}
                      className="block truncate px-1 text-[10.5px] text-dim hover:text-mist"
                    >
                      来自《{item.memory.title}》 · {formatDate(item.memory.occurredOn)}
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          {filter !== 'all' && visiblePhotos.length + visibleAudios.length + visibleVideos.length === 0 && (
            <EmptyState
              icon={<IconImage size={20} />}
              title="这一类还没有展品"
              description="在其他类型的记忆里添加附件，它们会自动归入对应展厅。"
            />
          )}
        </>
      )}

      {viewerIndex !== null && photos[viewerIndex] && (
        <GalleryViewer
          items={photos}
          index={viewerIndex}
          onIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      <p className={cn('text-center text-[10.5px] text-dim/50', items.length === 0 && 'hidden')}>
        所有展品都属于这条私密记忆本身 · 没有公开链接
      </p>
    </div>
  );
}
