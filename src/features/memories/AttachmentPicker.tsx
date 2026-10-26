import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Attachment, AttachmentKind } from '@/domain/types';
import {
  FILE_RULES,
  MAX_FILES_PER_MEMORY,
  extensionOf,
  kindOfExtension,
  validateFileMeta,
  validateFileSet,
  validateFileSignature,
} from '@/domain/uploads';
import { formatBytes } from '@/lib/date';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/Button';
import { IconAudio, IconClose, IconImage, IconUpload, IconVideo } from '@/components/icons';
import { useAttachmentUrl } from '@/features/media/useAttachmentUrl';

function kindIcon(kind: AttachmentKind) {
  if (kind === 'image') return <IconImage size={15} />;
  if (kind === 'video') return <IconVideo size={15} />;
  return <IconAudio size={15} />;
}

function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url || !file.type.startsWith('image/')) return null;
  return <img src={url} alt="" className="size-11 rounded-lg object-cover" />;
}

function ExistingPreview({ attachment }: { attachment: Attachment }) {
  const { url } = useAttachmentUrl(attachment.kind === 'image' ? attachment.id : undefined);
  if (!url) return <div className="size-11 rounded-lg bg-white/[0.05]" aria-hidden="true" />;
  return <img src={url} alt="" className="size-11 rounded-lg object-cover" />;
}

export function AttachmentPicker({
  files,
  onChange,
  existing,
  removedIds,
  onToggleRemoved,
  onError,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  existing: Attachment[];
  removedIds: Set<string>;
  onToggleRemoved: (attachmentId: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [checking, setChecking] = useState(false);

  const keptExisting = existing.filter((attachment) => !removedIds.has(attachment.id));
  const totalCount = keptExisting.length + files.length;

  async function acceptFiles(incoming: FileList | File[]) {
    if (disabled) return;
    const list = [...incoming];
    if (list.length === 0) return;
    setChecking(true);
    try {
      const combined = [
        ...keptExisting.map((attachment) => ({
          name: attachment.fileName,
          type: attachment.mimeType,
          size: attachment.byteSize,
        })),
        ...files,
        ...list,
      ];
      const setProblem = validateFileSet(combined);
      if (setProblem) {
        onError(setProblem);
        return;
      }
      const valid: File[] = [];
      for (const file of list) {
        const meta = validateFileMeta(file);
        if (!meta.ok) {
          onError(`${file.name}：${meta.reason}`);
          continue;
        }
        const signatureOk = await validateFileSignature(file);
        if (!signatureOk) {
          onError(`${file.name}：文件内容与扩展名不符，已拒绝。`);
          continue;
        }
        if (files.some((item) => item.name === file.name && item.size === file.size)) continue;
        valid.push(file);
      }
      if (valid.length > 0) onChange([...files, ...valid]);
    } finally {
      setChecking(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void acceptFiles(event.dataTransfer.files);
  }

  const kinds = Object.values(FILE_RULES)
    .map((rule) => rule.extensions.map((extension) => `.${extension}`).join(','))
    .join(',');

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-xl border border-dashed px-4 py-5 transition-colors',
          dragging ? 'border-violet/50 bg-violet/[0.06]' : 'border-white/12 bg-white/[0.015]',
          disabled && 'opacity-60',
        )}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-mist">
            <IconUpload size={16} />
          </span>
          <p className="text-[12.5px] text-mist">
            拖入照片、声音或影像，或
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || checking || totalCount >= MAX_FILES_PER_MEMORY}
              className="mx-1 text-violet underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-dim"
            >
              选择文件
            </button>
          </p>
          <p className="text-[10.5px] leading-relaxed text-dim">
            JPG/PNG/WebP · MP4/WebM · MP3/M4A/WAV。单条记忆最多 {MAX_FILES_PER_MEMORY} 个附件，
            照片 ≤20MB、视频 ≤80MB、声音 ≤30MB。
          </p>
          {checking && <p className="text-[11px] text-violet/80">正在检查文件内容…</p>}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={kinds}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void acceptFiles(event.target.files);
            event.target.value = '';
          }}
          aria-label="选择附件"
          disabled={disabled}
        />
      </div>

      {existing.length > 0 && (
        <ul className="space-y-1.5" aria-label="已有附件">
          {existing.map((attachment) => {
            const removed = removedIds.has(attachment.id);
            return (
              <li
                key={attachment.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2',
                  removed && 'opacity-45',
                )}
              >
                {attachment.kind === 'image' ? (
                  <ExistingPreview attachment={attachment} />
                ) : (
                  <span className="flex size-11 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-mist">
                    {kindIcon(attachment.kind)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[12.5px] text-ink/90', removed && 'line-through')}>
                    {attachment.fileName}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-dim">
                    {formatBytes(attachment.byteSize)} · {removed ? '保存后移除' : '已保存'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onToggleRemoved(attachment.id)}
                  className="rounded-md px-2 py-1 text-[11px] text-dim transition-colors hover:bg-white/5 hover:text-mist"
                >
                  {removed ? '恢复' : '移除'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5" aria-label="待上传附件">
          {files.map((file, index) => {
            const kind = kindOfExtension(extensionOf(file.name));
            return (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center gap-3 rounded-lg border border-violet/15 bg-violet/[0.04] px-2.5 py-2"
              >
                {kind === 'image' ? (
                  <LocalPreview file={file} />
                ) : (
                  <span className="flex size-11 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-mist">
                    {kind ? kindIcon(kind) : <IconImage size={15} />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink/90">{file.name}</span>
                  <span className="mt-0.5 block text-[10.5px] text-dim">待保存 · {formatBytes(file.size)}</span>
                </span>
                <IconButton
                  label={`移除 ${file.name}`}
                  size="sm"
                  onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <IconClose size={14} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10.5px] text-dim/70">
        文件只会保存在私有存储中；上传前会校验 MIME、扩展名、大小与文件头签名。
      </p>
    </div>
  );
}
