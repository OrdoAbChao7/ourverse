import { useState } from 'react';
import { useRepository } from '@/app/RepositoryContext';
import type { Attachment } from '@/domain/types';
import { downloadAttachment } from './download';
import { useAttachmentUrl } from './useAttachmentUrl';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/Button';
import { IconAudio, IconDownload, IconImage, IconVideo } from '@/components/icons';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/domain/errors';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/date';

function KindIcon({ kind, size = 14 }: { kind: Attachment['kind']; size?: number }) {
  if (kind === 'image') return <IconImage size={size} />;
  if (kind === 'video') return <IconVideo size={size} />;
  return <IconAudio size={size} />;
}

export function MemoryThumbnail({ attachment, className }: { attachment: Attachment | null; className?: string }) {
  const { url } = useAttachmentUrl(attachment?.id);
  if (!attachment) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-white/[0.07] bg-[radial-gradient(120%_120%_at_20%_0%,rgba(185,161,232,0.14),rgba(8,17,31,0.2))]',
          className,
        )}
        aria-hidden="true"
      >
        <span className="size-1.5 rounded-full bg-violet/70 shadow-[0_0_12px_2px_rgba(185,161,232,0.45)]" />
      </div>
    );
  }
  if (!url) {
    return <div className={cn('animate-pulse rounded-xl bg-white/[0.045]', className)} aria-hidden="true" />;
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={cn('rounded-xl object-cover', className)}
      style={{ objectPosition: 'center' }}
    />
  );
}

export function MediaLightbox({
  attachment,
  open,
  onClose,
}: {
  attachment: Attachment | null;
  open: boolean;
  onClose: () => void;
}) {
  const { url, error } = useAttachmentUrl(attachment?.id);
  return (
    <Dialog open={open} onClose={onClose} title={attachment?.fileName ?? '照片'} size="xl">
      <div className="flex max-h-[72vh] items-center justify-center overflow-hidden rounded-xl bg-black/30">
        {error ? (
          <p className="p-8 text-[13px] text-dim">{error}</p>
        ) : url ? (
          <img src={url} alt={attachment?.fileName ?? ''} className="max-h-[72vh] w-auto max-w-full object-contain" />
        ) : (
          <div className="h-64 w-full animate-pulse bg-white/[0.04]" />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11.5px] text-dim">
        <span>{attachment ? formatBytes(attachment.byteSize) : ''}</span>
        <span>{attachment?.mimeType}</span>
      </div>
    </Dialog>
  );
}

export function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const repo = useRepository();
  const { toast } = useToast();
  const { url, error } = useAttachmentUrl(attachment.kind === 'image' ? attachment.id : undefined);
  const [lightbox, setLightbox] = useState(false);

  async function onDownload() {
    try {
      await downloadAttachment(repo, attachment);
    } catch (downloadError) {
      toast({ title: '下载失败', description: errorMessage(downloadError), tone: 'error' });
    }
  }

  if (attachment.kind === 'image') {
    return (
      <>
        <figure className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-black/20">
          <button
            type="button"
            onClick={() => setLightbox(true)}
            className="block w-full"
            aria-label={`查看照片 ${attachment.fileName}`}
          >
            {url ? (
              <img
                src={url}
                alt={attachment.fileName}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover transition-transform duration-500 ease-[var(--ease-quiet)] group-hover:scale-[1.02]"
              />
            ) : (
              <div className="aspect-[4/3] w-full animate-pulse bg-white/[0.04]" />
            )}
          </button>
          <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/65 to-transparent px-3 pb-2.5 pt-8 text-[10.5px] text-white/75 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            <span className="truncate">{attachment.fileName}</span>
            <span className="pointer-events-auto">
              <IconButton
                label={`下载 ${attachment.fileName}`}
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  void onDownload();
                }}
              >
                <IconDownload size={14} />
              </IconButton>
            </span>
          </figcaption>
        </figure>
        <MediaLightbox attachment={attachment} open={lightbox} onClose={() => setLightbox(false)} />
      </>
    );
  }

  const media = <MediaElement attachment={attachment} />;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-[12px] text-mist">
          <KindIcon kind={attachment.kind} />
          <span className="truncate">{attachment.fileName}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10.5px] text-dim">{formatBytes(attachment.byteSize)}</span>
          <IconButton label={`下载 ${attachment.fileName}`} size="sm" onClick={() => void onDownload()}>
            <IconDownload size={14} />
          </IconButton>
        </span>
      </div>
      {error ? <p className="text-[12px] text-[#efc6d2]">{error}</p> : media}
    </div>
  );
}

function MediaElement({ attachment }: { attachment: Attachment }) {
  const { url } = useAttachmentUrl(attachment.id);
  if (!url) return <div className="h-10 animate-pulse rounded-lg bg-white/[0.04]" />;
  if (attachment.kind === 'video') {
    return (
      // Private user media has no caption track; captions are not generated.
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        controls
        preload="metadata"
        playsInline
        src={url}
        className="aspect-video w-full rounded-lg bg-black/40"
        aria-label={attachment.fileName}
      />
    );
  }
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio
      controls
      preload="metadata"
      src={url}
      className="h-10 w-full"
      aria-label={attachment.fileName}
    />
  );
}

export function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.kind === 'image');
  const others = attachments.filter((attachment) => attachment.kind !== 'image');
  return (
    <div className="space-y-4">
      {images.length > 0 && (
        <div className={cn('grid gap-3', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {images.map((attachment) => (
            <AttachmentCard key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="space-y-3">
          {others.map((attachment) => (
            <AttachmentCard key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}
