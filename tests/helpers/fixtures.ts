import type { Attachment, MemoryWithAuthor, UserProfile } from '@/domain/types';

export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export function pngFile(name = 'pixel.png', extraBytes = 0): File {
  if (extraBytes <= 0) return new File([PNG_BYTES], name, { type: 'image/png' });
  const bytes = new Uint8Array(PNG_BYTES.length + extraBytes);
  bytes.set(PNG_BYTES);
  return new File([bytes], name, { type: 'image/png' });
}

export function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'attachment-1',
    spaceId: 'space-1',
    memoryId: 'memory-1',
    storagePath: 'space-1/memory-1/attachment-1-file.png',
    fileName: 'file.png',
    mimeType: 'image/png',
    byteSize: 1024,
    sha256: null,
    kind: 'image',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function memory(overrides: Partial<MemoryWithAuthor> = {}): MemoryWithAuthor {
  const occurredOn = overrides.occurredOn ?? '2025-07-12';
  return {
    id: 'memory-1',
    spaceId: 'space-1',
    authorId: 'user-a',
    title: '一条测试记忆',
    bodyMd: '正文',
    occurredOn,
    occurredTime: null,
    occurredAt: `${occurredOn}T04:00:00.000Z`,
    visibility: 'shared',
    locationLabel: null,
    tags: [],
    createdAt: '2025-07-12T04:00:00.000Z',
    updatedAt: '2025-07-12T04:00:00.000Z',
    deletedAt: null,
    attachments: [],
    author: { id: 'user-a', displayName: '甲' },
    ...overrides,
  };
}

export function userProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { id: 'user-a', email: 'a@example.test', displayName: '甲', ...overrides };
}

export function jsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
