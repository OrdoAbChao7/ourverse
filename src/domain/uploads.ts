/**
 * Upload validation. This is the executable spec for what the private bucket
 * accepts. The Supabase bucket is additionally configured with
 * `allowed_mime_types` + `file_size_limit` so the server enforces the same
 * limits even if the client is bypassed.
 */
import type { AttachmentKind } from './types';

export const MAX_FILES_PER_MEMORY = 8;
export const MAX_TOTAL_BYTES_PER_MEMORY = 160 * 1024 * 1024;

export const FILE_RULES: Record<
  AttachmentKind,
  { maxBytes: number; mimeTypes: readonly string[]; extensions: readonly string[]; label: string }
> = {
  image: {
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
    label: '照片',
  },
  video: {
    maxBytes: 80 * 1024 * 1024,
    mimeTypes: ['video/mp4', 'video/webm'],
    extensions: ['mp4', 'webm'],
    label: '视频',
  },
  audio: {
    maxBytes: 30 * 1024 * 1024,
    mimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav'],
    extensions: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav'],
    label: '声音',
  },
};

const EXTENSION_TO_KIND: Record<string, AttachmentKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  mp4: 'video',
  webm: 'video',
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  oga: 'audio',
  wav: 'audio',
};

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export type UploadCheck =
  | { ok: true; kind: AttachmentKind; extension: string; safeName: string }
  | { ok: false; reason: string };

export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  if (index < 0 || index === name.length - 1) return '';
  return name.slice(index + 1).toLowerCase();
}

export function kindOfExtension(extension: string): AttachmentKind | null {
  return EXTENSION_TO_KIND[extension] ?? null;
}

export function attachmentKindOfMime(mime: string): AttachmentKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

/** Strips directories, control characters and reserved characters from a user-supplied name. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'file';
}

export function validateFileMeta(file: FileLike): UploadCheck {
  if (!file.name.trim()) return { ok: false, reason: '文件缺少名称。' };
  if (file.size <= 0) return { ok: false, reason: '文件为空，无法保存。' };

  const extension = extensionOf(file.name);
  const kind = kindOfExtension(extension);
  if (!kind) {
    return {
      ok: false,
      reason: '不支持的文件类型。可上传 JPG/PNG/WebP、MP4/WebM、MP3/M4A/WAV。',
    };
  }
  const rule = FILE_RULES[kind];

  if (file.type && !rule.mimeTypes.includes(file.type)) {
    return { ok: false, reason: `MIME 类型 ${file.type} 与允许的${rule.label}格式不符。` };
  }
  if (file.type) {
    const typeKind = attachmentKindOfMime(file.type);
    const mimeExt = rule.extensions.includes(extension);
    if (typeKind !== kind || !mimeExt) {
      return { ok: false, reason: '文件扩展名与 MIME 类型不一致，已拒绝保存。' };
    }
  }
  if (file.size > rule.maxBytes) {
    const limitMb = Math.round(rule.maxBytes / (1024 * 1024));
    return { ok: false, reason: `${rule.label}不能超过 ${limitMb}MB。` };
  }

  return { ok: true, kind, extension, safeName: sanitizeFileName(file.name) };
}

export function validateFileSet(files: FileLike[]): string | null {
  if (files.length > MAX_FILES_PER_MEMORY) {
    return `一条记忆最多附加 ${MAX_FILES_PER_MEMORY} 个文件。`;
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES_PER_MEMORY) {
    return `单条记忆的附件总大小不能超过 ${Math.round(MAX_TOTAL_BYTES_PER_MEMORY / (1024 * 1024))}MB。`;
  }
  for (const file of files) {
    const check = validateFileMeta(file);
    if (!check.ok) return check.reason;
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i] as number);
  }
  return out;
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBM = [0x1a, 0x45, 0xdf, 0xa3];

/**
 * Checks the leading magic bytes so a renamed .exe or an SVG parsed as an
 * image cannot be stored and later served. Reads only the first 32 bytes.
 */
export async function validateFileSignature(file: Blob & { name: string; type: string }): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const kind = kindOfExtension(extensionOf(file.name));
  if (!kind) return false;

  if (kind === 'image') {
    if (startsWith(head, JPEG)) return true;
    if (startsWith(head, PNG)) return true;
    if (startsWith(head, RIFF) && ascii(head, 8, 4) === 'WEBP') return true;
    return false;
  }
  if (kind === 'video') {
    if (ascii(head, 4, 4) === 'ftyp') return true; // MP4 / M4V (brand at 8)
    if (startsWith(head, WEBM)) return true;
    return false;
  }
  // audio
  if (ascii(head, 0, 3) === 'ID3') return true; // MP3 with ID3 tag
  if ((head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0)) return true; // MPEG/ADTS frame sync
  if (startsWith(head, RIFF) && ascii(head, 8, 4) === 'WAVE') return true;
  if (ascii(head, 0, 4) === 'OggS') return true;
  if (ascii(head, 4, 4) === 'ftyp') return true; // M4A
  return false;
}

export function buildStoragePath(spaceId: string, memoryId: string, attachmentId: string, safeName: string): string {
  return `${spaceId}/${memoryId}/${attachmentId}-${safeName}`;
}
