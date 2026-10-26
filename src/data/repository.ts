import type {
  ActivityEntry,
  Anniversary,
  AuthState,
  BackendKind,
  Capsule,
  CapsuleContent,
  CreateAnniversaryInput,
  CreateCapsuleInput,
  CreateMemoryInput,
  CreatedInvite,
  MemoryFilter,
  MemoryWithAuthor,
  SessionSnapshot,
  Space,
  SpaceInvite,
  SpaceMember,
  UpdateCapsuleInput,
  UpdateMemoryInput,
  UserProfile,
} from '@/domain/types';

export interface DemoIdentity {
  userId: string;
  displayName: string;
  email: string;
  description: string;
  hasSpace: boolean;
}

export interface AcceptInviteInput {
  token: string;
  displayName?: string;
}

export interface SignUpResult {
  needsEmailConfirmation: boolean;
}

export interface AuthApi {
  getState(): Promise<AuthState>;
  subscribe(listener: (state: AuthState) => void): () => void;
  signInWithPassword(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
  /** Demo builds only: choose one of the fictional identities. */
  signInDemo?(userId: string): Promise<void>;
  listDemoIdentities?(): Promise<DemoIdentity[]>;
  acceptInvite(input: AcceptInviteInput): Promise<void>;
}

export interface AiPreference {
  enabled: boolean;
  consentAt: string | null;
}

export interface InvitePreview {
  spaceName: string;
  expiresAt: string;
  valid: boolean;
  reason?: string;
}

/**
 * One flat interface implemented by both backends. The local implementation
 * checks the same rules as the SQL policies; the Supabase one relies on RLS
 * plus matching client-side guards for friendly errors.
 */
export interface Repository {
  readonly kind: BackendKind;
  readonly isDemo: boolean;

  /** Authoritative time. Server `now()` for Supabase, monotonic-anchored locally. */
  now(): Promise<Date>;

  auth: AuthApi;

  getSession(): Promise<SessionSnapshot | null>;

  getCurrentSpace(): Promise<Space | null>;
  createSpace(input: { displayName: string; motto?: string }): Promise<Space>;
  updateSpace(
    patch: Partial<Pick<Space, 'displayName' | 'relationshipStartAt'>> & {
      motto?: string;
      accent?: Space['settings']['accent'];
    },
  ): Promise<Space>;
  listMembers(): Promise<SpaceMember[]>;

  createInvite(input?: { invitedEmail?: string | null; ttlHours?: number }): Promise<CreatedInvite>;
  listInvites(): Promise<SpaceInvite[]>;
  revokeInvite(inviteId: string): Promise<void>;
  previewInvite(token: string): Promise<InvitePreview>;

  listMemories(filter?: MemoryFilter): Promise<MemoryWithAuthor[]>;
  getMemory(id: string): Promise<MemoryWithAuthor | null>;
  createMemory(input: CreateMemoryInput): Promise<MemoryWithAuthor>;
  updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryWithAuthor>;
  removeMemory(id: string): Promise<void>;

  getAttachmentUrl(attachmentId: string): Promise<string>;
  getAttachmentBytes(attachmentId: string): Promise<Blob>;

  listAnniversaries(): Promise<Anniversary[]>;
  createAnniversary(input: CreateAnniversaryInput): Promise<Anniversary>;
  updateAnniversary(id: string, input: CreateAnniversaryInput): Promise<Anniversary>;
  removeAnniversary(id: string): Promise<void>;

  listCapsules(): Promise<Capsule[]>;
  getCapsule(id: string): Promise<Capsule | null>;
  createCapsule(input: CreateCapsuleInput): Promise<Capsule>;
  updateCapsule(id: string, input: UpdateCapsuleInput): Promise<Capsule>;
  removeCapsule(id: string): Promise<void>;
  /**
   * The sealed body. Must be refused before `opensAt` according to the
   * authoritative clock — never the device clock.
   */
  readCapsuleBody(id: string): Promise<CapsuleContent>;

  getAiPreference(): Promise<AiPreference>;
  setAiPreference(enabled: boolean): Promise<AiPreference>;

  listActivity(limit?: number): Promise<ActivityEntry[]>;

  /** Demo-only: wipe local data and reseed. */
  resetDemoData?(): Promise<void>;
  dispose?(): void;
}

export type { UserProfile };
