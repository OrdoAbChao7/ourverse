import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS,
  canAccessSpace,
  canDeleteMemory,
  canEditMemory,
  canReadCapsuleBody,
  canViewAnniversary,
  canViewAttachment,
  canViewCapsuleMetadata,
  canViewMemory,
  filterVisibleMemories,
  type Viewer,
} from '@/domain/permissions';

const viewerA: Viewer = { userId: 'user-a', isMemberOfSpace: true };
const viewerB: Viewer = { userId: 'user-b', isMemberOfSpace: true };
const outsider: Viewer = { userId: 'user-c', isMemberOfSpace: false };

const sharedA = { visibility: 'shared' as const, authorId: 'user-a', deletedAt: null };
const privateA = { visibility: 'private' as const, authorId: 'user-a', deletedAt: null };
const privateB = { visibility: 'private' as const, authorId: 'user-b', deletedAt: null };
const deletedA = { visibility: 'shared' as const, authorId: 'user-a', deletedAt: '2025-01-01T00:00:00.000Z' };

describe('memory permissions', () => {
  it('both members can read shared memories', () => {
    expect(canViewMemory(viewerA, sharedA)).toBe(true);
    expect(canViewMemory(viewerB, sharedA)).toBe(true);
  });

  it('a private memory is readable only by its author', () => {
    expect(canViewMemory(viewerA, privateA)).toBe(true);
    expect(canViewMemory(viewerB, privateA)).toBe(false);
    expect(canViewMemory(viewerA, privateB)).toBe(false);
  });

  it('non-members and anonymous visitors cannot read anything', () => {
    expect(canViewMemory(outsider, sharedA)).toBe(false);
    expect(canViewMemory(ANONYMOUS, sharedA)).toBe(false);
    expect(canAccessSpace(outsider)).toBe(false);
    expect(canAccessSpace(ANONYMOUS)).toBe(false);
    expect(canAccessSpace(viewerA)).toBe(true);
  });

  it('deleted memories disappear for everyone', () => {
    expect(canViewMemory(viewerA, deletedA)).toBe(false);
    expect(canEditMemory(viewerA, deletedA)).toBe(false);
    expect(canDeleteMemory(viewerA, deletedA)).toBe(false);
  });

  it('only the author may edit or delete, even for shared content', () => {
    expect(canEditMemory(viewerA, sharedA)).toBe(true);
    expect(canEditMemory(viewerB, sharedA)).toBe(false);
    expect(canDeleteMemory(viewerB, sharedA)).toBe(false);
    expect(canEditMemory(outsider, sharedA)).toBe(false);
  });

  it('attachments inherit the memory visibility exactly', () => {
    expect(canViewAttachment(viewerA, privateA)).toBe(true);
    expect(canViewAttachment(viewerB, privateA)).toBe(false);
    expect(canViewAttachment(ANONYMOUS, sharedA)).toBe(false);
  });

  it('filters a mixed list without leaking private rows', () => {
    const visibleForB = filterVisibleMemories(viewerB, [sharedA, privateA, privateB, deletedA]);
    expect(visibleForB).toEqual([sharedA, privateB]);
    expect(filterVisibleMemories(ANONYMOUS, [sharedA, privateA])).toEqual([]);
  });
});

describe('anniversary and capsule permissions', () => {
  it('applies the same visibility rule to anniversaries', () => {
    expect(canViewAnniversary(viewerA, { visibility: 'shared', authorId: 'user-b' })).toBe(true);
    expect(canViewAnniversary(viewerB, { visibility: 'private', authorId: 'user-a' })).toBe(false);
    expect(canViewAnniversary(outsider, { visibility: 'shared', authorId: 'user-a' })).toBe(false);
  });

  it('shows capsule metadata to permitted viewers but seals the body until opensAt', () => {
    const capsule = {
      visibility: 'shared' as const,
      authorId: 'user-a',
      opensAt: '2026-11-01T00:00:00.000Z',
    };
    expect(canViewCapsuleMetadata(viewerB, capsule)).toBe(true);
    expect(canReadCapsuleBody(viewerB, capsule, new Date('2026-10-31T23:59:59.000Z'))).toBe(false);
    expect(canReadCapsuleBody(viewerB, capsule, new Date('2026-11-01T00:00:00.000Z'))).toBe(true);
  });

  it('never reveals a private capsule body to the other member', () => {
    const capsule = {
      visibility: 'private' as const,
      authorId: 'user-a',
      opensAt: '2020-01-01T00:00:00.000Z',
    };
    expect(canReadCapsuleBody(viewerB, capsule, new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
    expect(canReadCapsuleBody(viewerA, capsule, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
  });
});
