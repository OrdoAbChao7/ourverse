import { Link } from 'react-router-dom';
import type { MemoryWithAuthor } from '@/domain/types';
import { formatDateShort, formatRelative, formatWeekday } from '@/lib/date';
import { excerpt, initials } from '@/lib/text';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Primitives';
import { IconImage, IconLock, IconPin, IconVideo, IconAudio } from '@/components/icons';
import { MemoryThumbnail } from '@/features/media/Media';
import { useAttachmentUrl } from '@/features/media/useAttachmentUrl';

function MediaCounts({ memory }: { memory: MemoryWithAuthor }) {
  const images = memory.attachments.filter((attachment) => attachment.kind === 'image').length;
  const videos = memory.attachments.filter((attachment) => attachment.kind === 'video').length;
  const audios = memory.attachments.filter((attachment) => attachment.kind === 'audio').length;
  if (!images && !videos && !audios) return null;
  return (
    <span className="flex items-center gap-2 text-[10.5px] text-dim/80">
      {images > 0 && (
        <span className="flex items-center gap-1">
          <IconImage size={12} /> {images}
        </span>
      )}
      {videos > 0 && (
        <span className="flex items-center gap-1">
          <IconVideo size={12} /> {videos}
        </span>
      )}
      {audios > 0 && (
        <span className="flex items-center gap-1">
          <IconAudio size={12} /> {audios}
        </span>
      )}
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility: 'shared' | 'private' }) {
  if (visibility === 'private') {
    return (
      <Badge tone="rose">
        <IconLock size={10} /> 仅自己
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <span className="flex -space-x-1" aria-hidden="true">
        <span className="size-1.5 rounded-full bg-cyan/70" />
        <span className="size-1.5 rounded-full bg-violet/70" />
      </span>
      共同
    </Badge>
  );
}

export function AuthorChip({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11.5px] text-dim', className)}>
      <span className="flex size-5 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[9px] text-mist">
        {initials(name)}
      </span>
      {name}
    </span>
  );
}

export function MemoryRow({ memory }: { memory: MemoryWithAuthor }) {
  const cover = memory.attachments.find((attachment) => attachment.kind === 'image') ?? null;
  return (
    <Link
      to={`/app/memories/${memory.id}`}
      className="group flex gap-4 rounded-xl border border-transparent px-2 py-3 transition-colors duration-200 hover:border-white/[0.07] hover:bg-white/[0.025] sm:px-3"
    >
      <div className="w-11 shrink-0 pt-0.5 text-center">
        <p className="text-[10px] text-dim">{Number(memory.occurredOn.slice(5, 7))}月</p>
        <p className="num mt-1 text-[19px] leading-none text-ink/90">{memory.occurredOn.slice(8, 10)}</p>
        <p className="mt-1.5 text-[9.5px] text-dim">{formatWeekday(memory.occurredOn)}</p>
      </div>
      <MemoryThumbnail attachment={cover} className="size-[74px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-[14.5px] font-medium text-ink transition-colors group-hover:text-white">
            {memory.title}
          </h3>
          <VisibilityBadge visibility={memory.visibility} />
        </div>
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-mist/65">{excerpt(memory.bodyMd, 95)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AuthorChip name={memory.author.displayName} />
          {memory.locationLabel && (
            <span className="flex items-center gap-1 text-[10.5px] text-dim">
              <IconPin size={11} /> {memory.locationLabel}
            </span>
          )}
          <MediaCounts memory={memory} />
          {memory.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[10.5px] text-violet/60">
              #{tag}
            </span>
          ))}
          <span className="ml-auto hidden text-[10.5px] text-dim/60 sm:inline">
            {formatRelative(memory.updatedAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function MemoryCard({ memory, className }: { memory: MemoryWithAuthor; className?: string }) {
  const cover = memory.attachments.find((attachment) => attachment.kind === 'image') ?? null;
  return (
    <Link
      to={`/app/memories/${memory.id}`}
      className={cn(
        'group glass block overflow-hidden rounded-2xl transition-all duration-300 ease-[var(--ease-quiet)] hover:border-white/15 hover:bg-white/[0.05]',
        className,
      )}
    >
      <div className="relative">
        <CardCover memory={memory} cover={cover} />
        <div className="absolute right-3 top-3">
          <VisibilityBadge visibility={memory.visibility} />
        </div>
      </div>
      <div className="space-y-2 p-4">
        <p className="label-caps text-[9.5px]">{formatDateShort(memory.occurredOn)} · {formatWeekday(memory.occurredOn)}</p>
        <h3 className="line-clamp-1 text-[15px] font-medium text-ink">{memory.title}</h3>
        <p className="line-clamp-2 min-h-[2.9em] text-[12.5px] leading-relaxed text-mist/65">
          {excerpt(memory.bodyMd, 82)}
        </p>
        <div className="flex items-center justify-between pt-1">
          <AuthorChip name={memory.author.displayName} />
          <span className="text-[10.5px] text-dim/70">{formatRelative(memory.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function CardCover({ memory, cover }: { memory: MemoryWithAuthor; cover: MemoryWithAuthor['attachments'][number] | null }) {
  if (!cover) {
    return (
      <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden border-b border-white/[0.05] bg-[radial-gradient(140%_140%_at_20%_0%,rgba(185,161,232,0.12),rgba(8,17,31,0))]">
        <div className="dot-grid absolute inset-0 opacity-30" aria-hidden="true" />
        <span className="relative text-[11px] tracking-[0.2em] text-dim/60">{formatDateShort(memory.occurredOn)}</span>
      </div>
    );
  }
  return <CoverImage attachmentId={cover.id} alt={memory.title} />;
}

function CoverImage({ attachmentId, alt }: { attachmentId: string; alt: string }) {
  const { url } = useAttachmentUrl(attachmentId);
  if (!url) {
    return <div className="aspect-[16/10] w-full animate-pulse border-b border-white/[0.05] bg-white/[0.035]" />;
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="aspect-[16/10] w-full border-b border-white/[0.05] object-cover transition-transform duration-500 ease-[var(--ease-quiet)] group-hover:scale-[1.015]"
    />
  );
}
