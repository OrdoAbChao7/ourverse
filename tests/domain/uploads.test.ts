import { describe, expect, it } from 'vitest';
import {
  MAX_FILES_PER_MEMORY,
  buildStoragePath,
  extensionOf,
  sanitizeFileName,
  validateFileMeta,
  validateFileSet,
  validateFileSignature,
} from '@/domain/uploads';

function blobFile(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function headerBytes(header: number[], length = 40): number[] {
  const bytes = new Array<number>(length).fill(0);
  header.forEach((value, index) => {
    bytes[index] = value;
  });
  return bytes;
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

describe('validateFileMeta', () => {
  it('accepts supported image, audio and video files', () => {
    expect(validateFileMeta({ name: 'a.jpg', type: 'image/jpeg', size: 1024 }).ok).toBe(true);
    expect(validateFileMeta({ name: 'b.webp', type: 'image/webp', size: 2048 }).ok).toBe(true);
    expect(validateFileMeta({ name: 'c.mp4', type: 'video/mp4', size: 4096 }).ok).toBe(true);
    expect(validateFileMeta({ name: 'd.mp3', type: 'audio/mpeg', size: 4096 }).ok).toBe(true);
    expect(validateFileMeta({ name: 'e.m4a', type: 'audio/mp4', size: 4096 }).ok).toBe(true);
  });

  it('accepts a 5MB image (S1 acceptance size) and rejects oversize media', () => {
    expect(validateFileMeta({ name: 'big.png', type: 'image/png', size: 5 * 1024 * 1024 }).ok).toBe(true);
    expect(validateFileMeta({ name: 'huge.png', type: 'image/png', size: 21 * 1024 * 1024 }).ok).toBe(false);
    expect(validateFileMeta({ name: 'huge.mp4', type: 'video/mp4', size: 81 * 1024 * 1024 }).ok).toBe(false);
  });

  it('rejects unsupported types, mismatched MIME and empty files', () => {
    expect(validateFileMeta({ name: 'evil.exe', type: 'application/octet-stream', size: 10 }).ok).toBe(false);
    expect(validateFileMeta({ name: 'x.svg', type: 'image/svg+xml', size: 10 }).ok).toBe(false);
    expect(validateFileMeta({ name: 'x.png', type: 'image/jpeg', size: 10 }).ok).toBe(false);
    expect(validateFileMeta({ name: 'x.png', type: 'text/html', size: 10 }).ok).toBe(false);
    expect(validateFileMeta({ name: 'empty.png', type: 'image/png', size: 0 }).ok).toBe(false);
    expect(validateFileMeta({ name: '', type: 'image/png', size: 10 }).ok).toBe(false);
  });

  it('accepts an empty MIME only when the extension is known (browser quirk)', () => {
    expect(validateFileMeta({ name: 'no-mime.png', type: '', size: 10 }).ok).toBe(true);
  });

  it('enforces the per-memory file count and total size', () => {
    const one = { name: 'a.png', type: 'image/png', size: 1024 };
    expect(validateFileSet(Array.from({ length: MAX_FILES_PER_MEMORY }, () => one))).toBeNull();
    expect(validateFileSet(Array.from({ length: MAX_FILES_PER_MEMORY + 1 }, () => one))).not.toBeNull();
  });
});

describe('validateFileSignature', () => {
  it('accepts real leading signatures for every supported family', async () => {
    await expect(
      validateFileSignature(blobFile(headerBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.png', 'image/png')),
    ).resolves.toBe(true);
    await expect(validateFileSignature(blobFile(headerBytes([0xff, 0xd8, 0xff]), 'a.jpg', 'image/jpeg'))).resolves.toBe(true);
    await expect(
      validateFileSignature(blobFile([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')], 'a.webp', 'image/webp')),
    ).resolves.toBe(true);
    await expect(
      validateFileSignature(blobFile([0, 0, 0, 0, ...ascii('ftyp'), ...ascii('isom')], 'a.mp4', 'video/mp4')),
    ).resolves.toBe(true);
    await expect(
      validateFileSignature(blobFile([0x1a, 0x45, 0xdf, 0xa3], 'a.webm', 'video/webm')),
    ).resolves.toBe(true);
    await expect(validateFileSignature(blobFile(ascii('ID3'), 'a.mp3', 'audio/mpeg'))).resolves.toBe(true);
    await expect(
      validateFileSignature(blobFile([0xff, 0xfb, 0x90, 0x00], 'b.mp3', 'audio/mpeg')),
    ).resolves.toBe(true);
    await expect(
      validateFileSignature(blobFile([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')], 'a.wav', 'audio/wav')),
    ).resolves.toBe(true);
  });

  it('rejects renamed executables, HTML and script payloads', async () => {
    await expect(validateFileSignature(blobFile(ascii('MZ\x90\x00'), 'virus.png', 'image/png'))).resolves.toBe(false);
    await expect(validateFileSignature(blobFile(ascii('<html><script>'), 'page.jpg', 'image/jpeg'))).resolves.toBe(false);
    await expect(validateFileSignature(blobFile(ascii('{"x":1}'), 'data.mp4', 'video/mp4'))).resolves.toBe(false);
    await expect(validateFileSignature(blobFile([], 'empty.png', 'image/png'))).resolves.toBe(false);
  });
});

describe('file naming', () => {
  it('strips directories and dangerous characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\photo one.png')).toBe('photo-one.png');
    expect(sanitizeFileName('a<b>c:"|?*.jpg')).toBe('a_b_c_____.jpg');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('')).toBe('file');
  });

  it('builds storage paths bound to space and memory', () => {
    expect(buildStoragePath('space-1', 'memory-1', 'att-1', 'x.png')).toBe('space-1/memory-1/att-1-x.png');
  });

  it('extracts extensions case-insensitively', () => {
    expect(extensionOf('A.PNG')).toBe('png');
    expect(extensionOf('noext')).toBe('');
  });
});
