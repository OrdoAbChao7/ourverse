import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { museumFileName } from './build-museum';
import { createMuseumZip, estimateMuseumZipBytes, isMediaFile } from './zip';
import type { BuiltMuseum, MuseumMeta } from './museum-types';

/** Above this size the in-memory download fallback refuses to run. */
export const IN_MEMORY_LIMIT_BYTES = 300 * 1024 * 1024;

export type MuseumSaveMethod = 'file-system' | 'download';

export interface SaveMuseumOptions {
  fileName?: string;
  onProgress?: (progress: number) => void;
}

export interface SaveMuseumResult {
  method: MuseumSaveMethod;
  fileName: string;
}

export type MuseumSaveErrorCode = 'too-large' | 'quota' | 'aborted' | 'unsupported' | 'unknown';

/** Readable, typed failure for the export UI. Messages are user-facing Chinese. */
export class MuseumSaveError extends Error {
  readonly code: MuseumSaveErrorCode;

  constructor(code: MuseumSaveErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MuseumSaveError';
    this.code = code;
  }
}

/** Structural file sink so the streaming path is testable without a browser. */
export interface WritableSink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

interface MuseumFileHandle {
  createWritable(): Promise<WritableSink>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

type WindowWithFilePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<MuseumFileHandle>;
};

export function sanitizeZipFileName(name: string): string {
  const base = name
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
  const withExtension = /\.zip$/i.test(base) ? base : `${base || 'ourverse-museum'}.zip`;
  return withExtension.slice(0, 180);
}

export function defaultMuseumFileName(meta: MuseumMeta): string {
  return museumFileName(new Date(meta.generatedAt), meta.scope);
}

/**
 * Streams a ZIP through fflate's incremental `Zip` into any writable sink.
 * After each entry is compressed the pending write is awaited, so writing to
 * disk never requires a second full-size archive buffer.
 */
export async function streamMuseumZip(
  museum: BuiltMuseum,
  sink: WritableSink,
  onProgress?: (progress: number) => void,
): Promise<void> {
  let zipError: unknown = null;
  let settle: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let writes: Promise<void> = Promise.resolve();

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      zipError = error;
      settle();
      return;
    }
    if (chunk && chunk.byteLength > 0) {
      // fflate may reuse its delivery buffer; copy before handing it to async I/O.
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      writes = writes.then(() => sink.write(copy));
    }
    if (final) settle();
  });

  for (let index = 0; index < museum.files.length; index += 1) {
    const file = museum.files[index];
    if (!file) continue;
    const entry = isMediaFile(file)
      ? new ZipPassThrough(file.path)
      : new ZipDeflate(file.path, { level: 6 });
    zip.add(entry);
    entry.push(file.bytes, true);
    // Apply backpressure: fflate hands over chunks synchronously, so wait for
    // the previous file's bytes to reach the sink before compressing the next.
    await writes;
    onProgress?.((index + 1) / museum.files.length);
  }
  zip.end();

  await finished;
  await writes;
  if (zipError) {
    throw new MuseumSaveError('unknown', '压缩离线博物馆时发生错误，请重试或换用其他浏览器。', {
      cause: zipError,
    });
  }
}

function errorName(error: unknown): string | null {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error.name;
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function readableSaveError(error: unknown): MuseumSaveError {
  if (error instanceof MuseumSaveError) return error;
  const name = errorName(error);
  const detail = error instanceof Error ? error.message : String(error ?? '');
  if (name === 'AbortError') {
    return new MuseumSaveError('aborted', '已取消保存离线博物馆。');
  }
  if (name === 'QuotaExceededError' || /quota|空间不足|disk full|no space/i.test(detail)) {
    return new MuseumSaveError(
      'quota',
      '设备存储空间不足，离线博物馆未能完整写入。请清理空间或更换保存位置后重试。',
      { cause: error },
    );
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MuseumSaveError(
      'unsupported',
      '浏览器拒绝了文件写入权限。请重新点击导出并在提示中允许写入，或换成 Chrome / Edge。',
      { cause: error },
    );
  }
  return new MuseumSaveError(
    'unknown',
    `保存离线博物馆失败：${detail || '未知错误'}。原有文件未被修改。`,
    { cause: error },
  );
}

function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new MuseumSaveError('unsupported', '当前环境无法发起文件下载。');
  }
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
}

/**
 * Saves an offline museum.
 *
 * Chrome/Edge use the File System Access API and stream the archive, so the
 * export is written in chunks. Other browsers fall back to an in-memory Blob;
 * above 300 MB that path throws a typed `too-large` error instead of risking a
 * silent out-of-memory failure. Storage-quota failures always surface as a
 * readable Chinese `MuseumSaveError`.
 */
export async function saveMuseum(
  museum: BuiltMuseum,
  options: SaveMuseumOptions = {},
): Promise<SaveMuseumResult> {
  const fileName = sanitizeZipFileName(options.fileName ?? defaultMuseumFileName(museum.meta));
  const onProgress = options.onProgress;
  onProgress?.(0);

  if (typeof window !== 'undefined') {
    const picker = (window as WindowWithFilePicker).showSaveFilePicker;
    if (typeof picker === 'function') {
      let handle: MuseumFileHandle;
      try {
        handle = await picker.call(window, {
          suggestedName: fileName,
          types: [{ description: 'OURVERSE 离线博物馆', accept: { 'application/zip': ['.zip'] } }],
        });
      } catch (error) {
        throw readableSaveError(error);
      }

      let sink: WritableSink | null = null;
      try {
        sink = await handle.createWritable();
        await streamMuseumZip(museum, sink, onProgress);
        await sink.close();
        onProgress?.(1);
        return { method: 'file-system', fileName };
      } catch (error) {
        try {
          await sink?.abort?.(error);
        } catch {
          // The original failure is the useful one.
        }
        throw readableSaveError(error);
      }
    }
  }

  const totalBytes = estimateMuseumZipBytes(museum.files);
  if (totalBytes > IN_MEMORY_LIMIT_BYTES) {
    throw new MuseumSaveError(
      'too-large',
      `当前浏览器不支持流式保存，内存导出上限为 ${Math.round(
        IN_MEMORY_LIMIT_BYTES / (1024 * 1024),
      )} MB。本次包约 ${Math.ceil(totalBytes / (1024 * 1024))} MB，请使用最新版 Chrome 或 Edge 重新导出。`,
    );
  }

  try {
    const zip = await createMuseumZip(museum);
    const copy = new Uint8Array(zip.byteLength);
    copy.set(zip);
    downloadBlob(new Blob([copy], { type: 'application/zip' }), fileName);
    onProgress?.(1);
    return { method: 'download', fileName };
  } catch (error) {
    throw readableSaveError(error);
  }
}
