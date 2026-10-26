/**
 * Pure access-control rules.
 *
 * These functions are the executable specification that both backends must
 * satisfy:
 *  - `src/data/local/local-repository.ts` enforces them in code;
 *  - `supabase/migrations/*_rls.sql` enforces the same rules in RLS policies.
 *
 * Anything that reads content (memory bodies, attachments, capsule bodies,
 * export payloads, AI retrieval) must pass a Viewer through here first.
 */
import type { Anniversary, Capsule, Memory, Visibility } from './types';

export interface Viewer {
  userId: string | null;
  /** True only when the viewer is a current member of the memory's space. */
  isMemberOfSpace: boolean;
}

export const ANONYMOUS: Viewer = { userId: null, isMemberOfSpace: false };

export function isMember(viewer: Viewer): boolean {
  return Boolean(viewer.userId) && viewer.isMemberOfSpace;
}

function ownerOrShared(viewer: Viewer, visibility: Visibility, authorId: string): boolean {
  if (!isMember(viewer)) return false;
  if (visibility === 'shared') return true;
  return authorId === viewer.userId;
}

export function canViewMemory(viewer: Viewer, memory: Pick<Memory, 'visibility' | 'authorId' | 'deletedAt'>): boolean {
  if (memory.deletedAt) return false;
  return ownerOrShared(viewer, memory.visibility, memory.authorId);
}

export function canEditMemory(viewer: Viewer, memory: Pick<Memory, 'authorId' | 'deletedAt'>): boolean {
  if (memory.deletedAt) return false;
  return isMember(viewer) && memory.authorId === viewer.userId;
}

export function canDeleteMemory(viewer: Viewer, memory: Pick<Memory, 'authorId' | 'deletedAt'>): boolean {
  return canEditMemory(viewer, memory);
}

/** Attachments inherit the visibility of their memory — never more permissive. */
export function canViewAttachment(
  viewer: Viewer,
  memory: Pick<Memory, 'visibility' | 'authorId' | 'deletedAt'>,
): boolean {
  return canViewMemory(viewer, memory);
}

export function canViewAnniversary(
  viewer: Viewer,
  anniversary: Pick<Anniversary, 'visibility' | 'authorId'>,
): boolean {
  return ownerOrShared(viewer, anniversary.visibility, anniversary.authorId);
}

export function canEditAnniversary(
  viewer: Viewer,
  anniversary: Pick<Anniversary, 'authorId'>,
): boolean {
  return isMember(viewer) && anniversary.authorId === viewer.userId;
}

/** Metadata (title, open date) is visible to whoever may see the capsule at all. */
export function canViewCapsuleMetadata(
  viewer: Viewer,
  capsule: Pick<Capsule, 'visibility' | 'authorId'>,
): boolean {
  return ownerOrShared(viewer, capsule.visibility, capsule.authorId);
}

/**
 * The sealed body is readable only after the *authoritative* open time.
 * `now` must come from the repository clock (server `now()` in production),
 * never from an unvalidated device value.
 */
export function canReadCapsuleBody(
  viewer: Viewer,
  capsule: Pick<Capsule, 'visibility' | 'authorId' | 'opensAt'>,
  now: Date,
): boolean {
  if (!canViewCapsuleMetadata(viewer, capsule)) return false;
  return now.getTime() >= new Date(capsule.opensAt).getTime();
}

export function canEditCapsule(viewer: Viewer, capsule: Pick<Capsule, 'authorId'>): boolean {
  return isMember(viewer) && capsule.authorId === viewer.userId;
}

/** Space-level reads: members only. Anonymous visitors can never enumerate data. */
export function canAccessSpace(viewer: Viewer): boolean {
  return isMember(viewer);
}

export function filterVisibleMemories<T extends Pick<Memory, 'visibility' | 'authorId' | 'deletedAt'>>(
  viewer: Viewer,
  memories: T[],
): T[] {
  return memories.filter((memory) => canViewMemory(viewer, memory));
}
