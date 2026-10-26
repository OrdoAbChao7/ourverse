import type { DBSchema } from 'idb';
import type {
  Accent,
  ActivityAction,
  Anniversary,
  Attachment,
  Memory,
  RepeatRule,
  SpaceRole,
  UserProfile,
  Visibility,
} from '@/domain/types';

export type UserRecord = UserProfile;

export interface SpaceRecord {
  id: string;
  displayName: string;
  createdBy: string;
  createdAt: string;
  relationshipStartAt: string | null;
  motto: string;
  accent: Accent;
}

export interface MemberRecord {
  id: string;
  spaceId: string;
  userId: string;
  role: SpaceRole;
  joinedAt: string;
}

export interface InviteRecord {
  id: string;
  spaceId: string;
  tokenHash: string;
  invitedEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export type MemoryRecord = Omit<Memory, 'attachments'>;

export interface AttachmentRecord extends Attachment {
  /** ArrayBuffer instead of Blob so IndexedDB cloning is portable in every runtime. */
  data: ArrayBuffer;
}

export type AnniversaryRecord = Anniversary;

export interface CapsuleRecord {
  id: string;
  spaceId: string;
  authorId: string;
  title: string;
  opensAt: string;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

export interface CapsuleContentRecord {
  capsuleId: string;
  bodyMd: string;
  bodyLength: number;
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  spaceId: string;
  actorId: string;
  action: ActivityAction;
  targetId: string | null;
  createdAt: string;
}

export interface PreferenceRecord {
  userId: string;
  aiEnabled: boolean;
  consentAt: string | null;
  updatedAt: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface OurverseDB extends DBSchema {
  meta: { key: string; value: MetaRecord };
  users: { key: string; value: UserRecord; indexes: { 'by-email': string } };
  spaces: { key: string; value: SpaceRecord };
  members: {
    key: string;
    value: MemberRecord;
    indexes: { 'by-space': string; 'by-user': string };
  };
  invites: {
    key: string;
    value: InviteRecord;
    indexes: { 'by-space': string; 'by-token': string };
  };
  memories: {
    key: string;
    value: MemoryRecord;
    indexes: { 'by-space': string; 'by-author': string };
  };
  attachments: {
    key: string;
    value: AttachmentRecord;
    indexes: { 'by-memory': string };
  };
  anniversaries: {
    key: string;
    value: AnniversaryRecord;
    indexes: { 'by-space': string };
  };
  capsules: { key: string; value: CapsuleRecord; indexes: { 'by-space': string } };
  capsuleContents: { key: string; value: CapsuleContentRecord };
  activity: { key: string; value: ActivityRecord; indexes: { 'by-space': string } };
  preferences: { key: string; value: PreferenceRecord };
}

export type { RepeatRule };
