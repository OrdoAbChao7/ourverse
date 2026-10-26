/**
 * Domain model — mirrors supabase/migrations and is the single source of truth
 * for both the local (demo) repository and the Supabase repository.
 *
 * Dates that represent *when something happened* are stored twice on purpose:
 *  - `occurredOn` ('YYYY-MM-DD') + `occurredTime` ('HH:mm' | null) are the
 *    author-entered local values; they are what the UI displays.
 *  - `occurredAt` (ISO-8601 UTC) is derived for ordering and range queries.
 * This keeps "a date without a time" from drifting across timezones.
 */

export const VISIBILITIES = ['shared', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const ACCENTS = ['violet', 'gold', 'cyan'] as const;
export type Accent = (typeof ACCENTS)[number];

export type SpaceRole = 'owner' | 'member';

export type BackendKind = 'local' | 'supabase';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
}

export interface SpaceMember {
  id: string;
  spaceId: string;
  userId: string;
  role: SpaceRole;
  joinedAt: string;
  profile: UserProfile;
}

export interface SpaceSettings {
  /** Customisable welcome line. Never auto-filled with a fabricated relationship. */
  motto: string;
  accent: Accent;
}

export interface Space {
  id: string;
  displayName: string;
  createdBy: string;
  createdAt: string;
  /** Only set when the two people explicitly configure it. Never inferred. */
  relationshipStartAt: string | null;
  settings: SpaceSettings;
}

export type AttachmentKind = 'image' | 'video' | 'audio';

export interface Attachment {
  id: string;
  spaceId: string;
  memoryId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  /** Hex SHA-256 of the stored bytes; computed on upload when available. */
  sha256: string | null;
  kind: AttachmentKind;
  createdAt: string;
}

export interface Memory {
  id: string;
  spaceId: string;
  authorId: string;
  title: string;
  bodyMd: string;
  occurredOn: string;
  occurredTime: string | null;
  occurredAt: string;
  visibility: Visibility;
  locationLabel: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  attachments: Attachment[];
}

export interface MemoryAuthor {
  id: string;
  displayName: string;
}

export interface MemoryWithAuthor extends Memory {
  author: MemoryAuthor;
}

export interface NewAttachmentFile {
  file: File;
}

export interface CreateMemoryInput {
  title: string;
  bodyMd: string;
  occurredOn: string;
  occurredTime: string | null;
  visibility: Visibility;
  locationLabel: string | null;
  tags: string[];
  files?: File[];
}

export type UpdateMemoryInput = Omit<CreateMemoryInput, 'files'> & {
  addFiles?: File[];
  removeAttachmentIds?: string[];
};

export type RepeatRule = 'yearly' | 'once';

export interface Anniversary {
  id: string;
  spaceId: string;
  authorId: string;
  name: string;
  /** The original calendar date, 'YYYY-MM-DD'. */
  date: string;
  repeat: RepeatRule;
  visibility: Visibility;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnniversaryInput {
  name: string;
  date: string;
  repeat: RepeatRule;
  visibility: Visibility;
  note: string | null;
}

export type CapsuleState = 'locked' | 'open';

export interface Capsule {
  id: string;
  spaceId: string;
  authorId: string;
  title: string;
  opensAt: string;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  /** Derived from the authoritative clock at read time — never from the device clock alone. */
  state: CapsuleState;
}

export interface CapsuleContent {
  capsuleId: string;
  bodyMd: string;
  openedAt: string;
}

export interface CreateCapsuleInput {
  title: string;
  bodyMd: string;
  /** ISO timestamp; must be in the future relative to the authoritative clock. */
  opensAt: string;
  visibility: Visibility;
}

export interface UpdateCapsuleInput {
  title: string;
  bodyMd: string;
  visibility: Visibility;
}

export interface SpaceInvite {
  id: string;
  spaceId: string;
  invitedEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreatedInvite {
  invite: SpaceInvite;
  /** Plaintext token — returned exactly once and never stored in this form. */
  token: string;
  /** Ready-to-share link (points at /login?invite=…). */
  url: string;
}

export type ActivityAction =
  | 'space.created'
  | 'member.joined'
  | 'memory.created'
  | 'memory.updated'
  | 'memory.deleted'
  | 'anniversary.created'
  | 'capsule.created'
  | 'capsule.opened'
  | 'export.generated';

export interface ActivityEntry {
  id: string;
  spaceId: string;
  actorId: string;
  action: ActivityAction;
  targetId: string | null;
  createdAt: string;
}

export interface MemoryFilter {
  query?: string;
  tags?: string[];
  from?: string;
  to?: string;
  authorId?: string;
  visibility?: Visibility;
}

export interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: UserProfile | null;
  backend: BackendKind;
  isDemo: boolean;
}

export interface SessionSnapshot {
  user: UserProfile;
  space: Space | null;
  members: SpaceMember[];
}

export interface BackendHealth {
  ok: boolean;
  message: string;
  checkedAt: string;
}

/** The fixed demo cast. All content authored by them is fictional and labelled DEMO. */
export const DEMO_USER_IDS = {
  a: 'demo-user-linwu',
  b: 'demo-user-jiangzhao',
  third: 'demo-user-third',
} as const;

export const DEMO_SPACE_ID = 'demo-space-ourverse';
