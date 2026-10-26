import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import {
  canEditAnniversary,
  canEditCapsule,
  canEditMemory,
  canViewAnniversary,
  canViewCapsuleMetadata,
  canViewMemory,
  type Viewer,
} from '@/domain/permissions';
import { AppError, CapsuleLockedError } from '@/domain/errors';
import { anniversaryInputSchema, capsuleInputSchema, firstZodMessage, memoryInputSchema, spaceProfileSchema } from '@/domain/schemas';
import { searchMemories } from '@/domain/search';
import type {
  Anniversary,
  AuthState,
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
  ActivityEntry,
} from '@/domain/types';
import { isValidDateString, toIsoTimestamp } from '@/lib/date';
import { newId, randomToken, sha256Hex } from '@/lib/crypto';
import { buildStoragePath, validateFileSet, validateFileMeta, validateFileSignature } from '@/domain/uploads';
import type {
  AcceptInviteInput,
  AiPreference,
  AuthApi,
  DemoIdentity,
  Repository,
  SignUpResult,
} from '../repository';
import { MonotonicClock } from './clock';
import type {
  ActivityRecord,
  AnniversaryRecord,
  AttachmentRecord,
  CapsuleRecord,
  InviteRecord,
  MemberRecord,
  MemoryRecord,
  OurverseDB,
  SpaceRecord,
  UserRecord,
} from './db';
import { DEMO_SEED_VERSION, writeDemoSeed } from './seed';

export interface LocalRepositoryOptions {
  dbName?: string;
  sessionKey?: string;
  seed?: boolean;
  assetLoader?: () => Promise<Map<string, Blob>>;
  clock?: MonotonicClock;
}

const DEFAULT_DB = 'ourverse-local';
const DEFAULT_SESSION_KEY = 'ourverse.demo.session.v1';

function nowIso(clock: MonotonicClock): string {
  return clock.now().toISOString();
}

function asUserProfile(user: UserRecord): UserProfile {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

function asSpace(space: SpaceRecord): Space {
  return {
    id: space.id,
    displayName: space.displayName,
    createdBy: space.createdBy,
    createdAt: space.createdAt,
    relationshipStartAt: space.relationshipStartAt,
    settings: { motto: space.motto, accent: space.accent },
  };
}

function capsuleState(record: CapsuleRecord, now: Date): 'locked' | 'open' {
  return now.getTime() >= new Date(record.opensAt).getTime() ? 'open' : 'locked';
}

function asCapsule(record: CapsuleRecord, now: Date): Capsule {
  return {
    id: record.id,
    spaceId: record.spaceId,
    authorId: record.authorId,
    title: record.title,
    opensAt: record.opensAt,
    visibility: record.visibility,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    state: capsuleState(record, now),
  };
}

interface UploadPrepared {
  record: Omit<AttachmentRecord, 'blob'>;
  blob: Blob;
}

interface ActiveContext {
  user: UserRecord;
  space: SpaceRecord;
  member: MemberRecord;
  viewer: Viewer;
}

export class LocalRepository implements Repository {
  readonly kind = 'local' as const;
  readonly isDemo = true;

  private readonly options: LocalRepositoryOptions;
  private readonly dbName: string;
  private readonly sessionKey: string;
  private readonly clock: MonotonicClock;
  private readonly listeners = new Set<(state: AuthState) => void>();
  private readonly objectUrls = new Map<string, string>();
  private readonly memorySession = new Map<string, string>();
  private dbPromise: Promise<IDBPDatabase<OurverseDB>> | null = null;

  readonly auth: AuthApi;

  constructor(options: LocalRepositoryOptions = {}) {
    this.options = options;
    this.dbName = options.dbName ?? DEFAULT_DB;
    this.sessionKey = options.sessionKey ?? DEFAULT_SESSION_KEY;
    this.clock = options.clock ?? new MonotonicClock();

    this.auth = {
      getState: () => this.getAuthState(),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      signInWithPassword: async () => {
        throw new AppError('VALIDATION', '演示模式不需要密码。请从下方选择一个虚构身份进入。');
      },
      signUp: async (): Promise<SignUpResult> => {
        throw new AppError('VALIDATION', '演示模式不开放注册。真实部署时使用 Supabase 邮箱注册。');
      },
      signOut: async () => {
        this.writeSession(null);
        await this.notifyAuth();
      },
      signInDemo: async (userId: string) => {
        const db = await this.db();
        const user = await db.get('users', userId);
        if (!user) throw new AppError('NOT_FOUND', '演示身份不存在。');
        this.writeSession(userId);
        await this.notifyAuth();
      },
      listDemoIdentities: () => this.listDemoIdentities(),
      acceptInvite: (input) => this.acceptInvite(input),
    };
  }

  now(): Promise<Date> {
    return Promise.resolve(this.clock.now());
  }

  // ── bootstrapping ────────────────────────────────────────────────────────

  private db(): Promise<IDBPDatabase<OurverseDB>> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDatabase().catch((error: unknown) => {
        this.dbPromise = null;
        throw error;
      });
    }
    return this.dbPromise;
  }

  private async openDatabase(): Promise<IDBPDatabase<OurverseDB>> {
    const db = await openDB<OurverseDB>(this.dbName, 1, {
      upgrade(database) {
        database.createObjectStore('meta', { keyPath: 'key' });
        const users = database.createObjectStore('users', { keyPath: 'id' });
        users.createIndex('by-email', 'email', { unique: true });
        database.createObjectStore('spaces', { keyPath: 'id' });
        const members = database.createObjectStore('members', { keyPath: 'id' });
        members.createIndex('by-space', 'spaceId');
        members.createIndex('by-user', 'userId');
        const invites = database.createObjectStore('invites', { keyPath: 'id' });
        invites.createIndex('by-space', 'spaceId');
        invites.createIndex('by-token', 'tokenHash', { unique: true });
        const memories = database.createObjectStore('memories', { keyPath: 'id' });
        memories.createIndex('by-space', 'spaceId');
        memories.createIndex('by-author', 'authorId');
        const attachments = database.createObjectStore('attachments', { keyPath: 'id' });
        attachments.createIndex('by-memory', 'memoryId');
        const anniversaries = database.createObjectStore('anniversaries', { keyPath: 'id' });
        anniversaries.createIndex('by-space', 'spaceId');
        const capsules = database.createObjectStore('capsules', { keyPath: 'id' });
        capsules.createIndex('by-space', 'spaceId');
        database.createObjectStore('capsuleContents', { keyPath: 'capsuleId' });
        const activity = database.createObjectStore('activity', { keyPath: 'id' });
        activity.createIndex('by-space', 'spaceId');
        database.createObjectStore('preferences', { keyPath: 'userId' });
      },
    });

    if (this.options.seed !== false) {
      await this.ensureSeeded(db);
    }
    return db;
  }

  private async ensureSeeded(db: IDBPDatabase<OurverseDB>): Promise<void> {
    const meta = await db.get('meta', 'seed');
    const version = (meta?.value as { version?: number } | undefined)?.version;
    if (version === DEMO_SEED_VERSION) return;
    await this.clearAllStores(db);
    let assets = new Map<string, Blob>();
    if (this.options.assetLoader) {
      try {
        assets = await this.options.assetLoader();
      } catch (error) {
        console.warn('[ourverse] demo assets unavailable, seeding text only', error);
      }
    }
    await writeDemoSeed(db, this.clock.now(), assets);
  }

  private async clearAllStores(db: IDBPDatabase<OurverseDB>): Promise<void> {
    const stores = [
      'meta',
      'users',
      'spaces',
      'members',
      'invites',
      'memories',
      'attachments',
      'anniversaries',
      'capsules',
      'capsuleContents',
      'activity',
      'preferences',
    ] as const;
    const tx = db.transaction(stores, 'readwrite');
    for (const store of stores) {
      await tx.objectStore(store).clear();
    }
    await tx.done;
    for (const url of this.objectUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    this.objectUrls.clear();
  }

  // ── session / auth ───────────────────────────────────────────────────────

  private readSession(): string | null {
    try {
      return sessionStorage.getItem(this.sessionKey);
    } catch {
      return this.memorySession.get(this.sessionKey) ?? null;
    }
  }

  private writeSession(userId: string | null): void {
    try {
      if (userId) sessionStorage.setItem(this.sessionKey, userId);
      else sessionStorage.removeItem(this.sessionKey);
    } catch {
      if (userId) this.memorySession.set(this.sessionKey, userId);
      else this.memorySession.delete(this.sessionKey);
    }
  }

  private async currentUser(): Promise<UserRecord | null> {
    const userId = this.readSession();
    if (!userId) return null;
    const db = await this.db();
    const user = await db.get('users', userId);
    if (!user) {
      this.writeSession(null);
      return null;
    }
    return user;
  }

  async getAuthState(): Promise<AuthState> {
    await this.db();
    const user = await this.currentUser();
    return {
      status: user ? 'authenticated' : 'anonymous',
      user: user ? asUserProfile(user) : null,
      backend: 'local',
      isDemo: true,
    };
  }

  private async notifyAuth(): Promise<void> {
    const state = await this.getAuthState();
    for (const listener of this.listeners) listener(state);
  }

  async listDemoIdentities(): Promise<DemoIdentity[]> {
    const db = await this.db();
    const users = await db.getAll('users');
    const members = await db.getAll('members');
    const joined = new Set(members.map((member) => member.userId));
    return users.map((user) => {
      const description =
        user.id === 'demo-user-linwu'
          ? '空间创建者 · 第一个身份'
          : user.id === 'demo-user-jiangzhao'
            ? '受邀加入的成员 · 第二个身份'
            : '不属于任何空间的第三方账号 · 用于验证隔离';
      return {
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        description,
        hasSpace: joined.has(user.id),
      };
    });
  }

  async getSession(): Promise<SessionSnapshot | null> {
    return this.getSessionSnapshot();
  }

  async getSessionSnapshot() {
    const user = await this.currentUser();
    if (!user) return null;
    const db = await this.db();
    const member = await db.getFromIndex('members', 'by-user', user.id);
    if (!member) {
      return { user: asUserProfile(user), space: null, members: [] };
    }
    const space = await db.get('spaces', member.spaceId);
    if (!space) return { user: asUserProfile(user), space: null, members: [] };
    const members = await db.getAllFromIndex('members', 'by-space', space.id);
    const users = await db.getAll('users');
    const profiles = new Map(users.map((entry) => [entry.id, entry]));
    return {
      user: asUserProfile(user),
      space: asSpace(space),
      members: members.map((entry) => this.toSpaceMember(entry, profiles.get(entry.userId))),
    };
  }

  private toSpaceMember(member: MemberRecord, user: UserRecord | undefined): SpaceMember {
    return {
      id: member.id,
      spaceId: member.spaceId,
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      profile: user
        ? asUserProfile(user)
        : { id: member.userId, email: '', displayName: '未知成员' },
    };
  }

  private async requireUser(): Promise<UserRecord> {
    const user = await this.currentUser();
    if (!user) throw new AppError('UNAUTHENTICATED', '请先登录。');
    return user;
  }

  private async requireContext(): Promise<ActiveContext> {
    const user = await this.requireUser();
    const db = await this.db();
    const member = await db.getFromIndex('members', 'by-user', user.id);
    if (!member) throw new AppError('FORBIDDEN', '你还没有加入任何空间。');
    const space = await db.get('spaces', member.spaceId);
    if (!space) throw new AppError('FORBIDDEN', '空间不存在。');
    return { user, space, member, viewer: { userId: user.id, isMemberOfSpace: true } };
  }

  private async acceptInvite(input: AcceptInviteInput): Promise<void> {
    const user = await this.requireUser();
    const db = await this.db();
    const tokenHash = await this.hashToken(input.token);
    const invite = await db.getFromIndex('invites', 'by-token', tokenHash);
    if (!invite) throw new AppError('INVITE_INVALID', '邀请链接无效。');
    if (invite.revokedAt) throw new AppError('INVITE_INVALID', '邀请已被撤销。');
    if (invite.usedAt) throw new AppError('INVITE_USED', '邀请已被使用。');
    if (Date.parse(invite.expiresAt) <= this.clock.now().getTime()) {
      throw new AppError('INVITE_EXPIRED', '邀请已过期，请联系空间创建者重新生成。');
    }

    const existing = await db.getFromIndex('members', 'by-user', user.id);
    if (existing && existing.spaceId === invite.spaceId) {
      await db.put('invites', { ...invite, usedAt: nowIso(this.clock) });
      await this.notifyAuth();
      return;
    }
    if (existing) throw new AppError('CONFLICT', '你已经属于另一个空间。');

    const members = await db.getAllFromIndex('members', 'by-space', invite.spaceId);
    if (members.length >= 2) throw new AppError('SPACE_FULL', '这个空间已经有两位成员了。');

    const now = nowIso(this.clock);
    const member: MemberRecord = {
      id: newId('member'),
      spaceId: invite.spaceId,
      userId: user.id,
      role: 'member',
      joinedAt: now,
    };
    const tx = db.transaction(['members', 'invites', 'activity'], 'readwrite');
    await tx.objectStore('members').put(member);
    await tx.objectStore('invites').put({ ...invite, usedAt: now });
    await tx.objectStore('activity').put({
      id: newId('activity'),
      spaceId: invite.spaceId,
      actorId: user.id,
      action: 'member.joined',
      targetId: user.id,
      createdAt: now,
    } satisfies ActivityRecord);
    await tx.done;
    await this.notifyAuth();
  }

  private async hashToken(token: string): Promise<string> {
    const hash = await sha256Hex(new TextEncoder().encode(token));
    if (!hash) throw new AppError('VALIDATION', '当前环境无法生成安全邀请令牌（需要 HTTPS 或 localhost）。');
    return hash;
  }

  // ── spaces ───────────────────────────────────────────────────────────────

  async getCurrentSpace(): Promise<Space | null> {
    const user = await this.currentUser();
    if (!user) return null;
    const db = await this.db();
    const member = await db.getFromIndex('members', 'by-user', user.id);
    if (!member) return null;
    const space = await db.get('spaces', member.spaceId);
    return space ? asSpace(space) : null;
  }

  async createSpace(input: { displayName: string; motto?: string }): Promise<Space> {
    const user = await this.requireUser();
    const parsed = spaceProfileSchema.safeParse({ displayName: input.displayName, motto: input.motto ?? '' });
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const db = await this.db();
    const existing = await db.getFromIndex('members', 'by-user', user.id);
    if (existing) throw new AppError('CONFLICT', '你已经属于一个空间。');

    const now = nowIso(this.clock);
    const space: SpaceRecord = {
      id: newId('space'),
      displayName: parsed.data.displayName,
      createdBy: user.id,
      createdAt: now,
      relationshipStartAt: null,
      motto: parsed.data.motto || '把故事留在星光里。',
      accent: 'violet',
    };
    const member: MemberRecord = {
      id: newId('member'),
      spaceId: space.id,
      userId: user.id,
      role: 'owner',
      joinedAt: now,
    };
    const tx = db.transaction(['spaces', 'members', 'activity'], 'readwrite');
    await tx.objectStore('spaces').put(space);
    await tx.objectStore('members').put(member);
    await tx.objectStore('activity').put({
      id: newId('activity'),
      spaceId: space.id,
      actorId: user.id,
      action: 'space.created',
      targetId: space.id,
      createdAt: now,
    } satisfies ActivityRecord);
    await tx.done;
    await this.notifyAuth();
    return asSpace(space);
  }

  async updateSpace(
    patch: Partial<Pick<Space, 'displayName' | 'relationshipStartAt'>> & {
      motto?: string;
      accent?: Space['settings']['accent'];
    },
  ): Promise<Space> {
    const { space } = await this.requireContext();
    const db = await this.db();
    const next: SpaceRecord = { ...space };
    if (patch.displayName !== undefined) {
      const value = patch.displayName.trim();
      if (!value || value.length > 40) throw new AppError('VALIDATION', '空间名称需要 1–40 个字符。');
      next.displayName = value;
    }
    if (patch.motto !== undefined) next.motto = patch.motto.trim().slice(0, 60);
    if (patch.accent !== undefined) {
      if (!['violet', 'gold', 'cyan'].includes(patch.accent)) {
        throw new AppError('VALIDATION', '未知的主题色。');
      }
      next.accent = patch.accent;
    }
    if (patch.relationshipStartAt !== undefined) {
      if (patch.relationshipStartAt !== null && !isValidDateString(patch.relationshipStartAt)) {
        throw new AppError('VALIDATION', '请选择有效的纪念日日期。');
      }
      next.relationshipStartAt = patch.relationshipStartAt;
    }
    await db.put('spaces', next);
    return asSpace(next);
  }

  async listMembers(): Promise<SpaceMember[]> {
    const { space } = await this.requireContext();
    const db = await this.db();
    const members = await db.getAllFromIndex('members', 'by-space', space.id);
    const users = await db.getAll('users');
    const profiles = new Map(users.map((entry) => [entry.id, entry]));
    return members
      .sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1))
      .map((member) => this.toSpaceMember(member, profiles.get(member.userId)));
  }

  // ── invites ──────────────────────────────────────────────────────────────

  async createInvite(input: { invitedEmail?: string | null; ttlHours?: number } = {}): Promise<CreatedInvite> {
    const context = await this.requireContext();
    if (context.member.role !== 'owner') {
      throw new AppError('FORBIDDEN', '只有空间创建者可以发出邀请。');
    }
    const db = await this.db();
    const members = await db.getAllFromIndex('members', 'by-space', context.space.id);
    if (members.length >= 2) throw new AppError('SPACE_FULL', '空间已经满员（最多两人）。');

    const ttlHours = Math.min(168, Math.max(1, input.ttlHours ?? 72));
    const token = randomToken(32);
    const tokenHash = await this.hashToken(token);
    const now = this.clock.now();
    const invite: InviteRecord = {
      id: newId('invite'),
      spaceId: context.space.id,
      tokenHash,
      invitedEmail: input.invitedEmail?.trim() || null,
      expiresAt: new Date(now.getTime() + ttlHours * 3_600_000).toISOString(),
      usedAt: null,
      revokedAt: null,
      createdBy: context.user.id,
      createdAt: now.toISOString(),
    };
    await db.put('invites', invite);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return {
      invite: this.toInvite(invite),
      token,
      url: `${origin}/login?invite=${encodeURIComponent(token)}`,
    };
  }

  private toInvite(record: InviteRecord): SpaceInvite {
    return {
      id: record.id,
      spaceId: record.spaceId,
      invitedEmail: record.invitedEmail,
      expiresAt: record.expiresAt,
      usedAt: record.usedAt,
      revokedAt: record.revokedAt,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
    };
  }

  async listInvites(): Promise<SpaceInvite[]> {
    const context = await this.requireContext();
    if (context.member.role !== 'owner') return [];
    const db = await this.db();
    const invites = await db.getAllFromIndex('invites', 'by-space', context.space.id);
    return invites
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((invite) => this.toInvite(invite));
  }

  async revokeInvite(inviteId: string): Promise<void> {
    const context = await this.requireContext();
    if (context.member.role !== 'owner') throw new AppError('FORBIDDEN', '只有空间创建者可以撤销邀请。');
    const db = await this.db();
    const invite = await db.get('invites', inviteId);
    if (!invite || invite.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '邀请不存在。');
    await db.put('invites', { ...invite, revokedAt: nowIso(this.clock) });
  }

  async previewInvite(token: string): Promise<{ spaceName: string; expiresAt: string; valid: boolean; reason?: string }> {
    const db = await this.db();
    const tokenHash = await this.hashToken(token);
    const invite = await db.getFromIndex('invites', 'by-token', tokenHash);
    if (!invite) return { spaceName: '', expiresAt: '', valid: false, reason: '邀请链接无效。' };
    const space = await db.get('spaces', invite.spaceId);
    const members = await db.getAllFromIndex('members', 'by-space', invite.spaceId);
    if (invite.revokedAt) return { spaceName: space?.displayName ?? '', expiresAt: invite.expiresAt, valid: false, reason: '邀请已被撤销。' };
    if (invite.usedAt) return { spaceName: space?.displayName ?? '', expiresAt: invite.expiresAt, valid: false, reason: '邀请已被使用。' };
    if (Date.parse(invite.expiresAt) <= this.clock.now().getTime()) {
      return { spaceName: space?.displayName ?? '', expiresAt: invite.expiresAt, valid: false, reason: '邀请已过期。' };
    }
    if (members.length >= 2) return { spaceName: space?.displayName ?? '', expiresAt: invite.expiresAt, valid: false, reason: '空间已满员。' };
    return { spaceName: space?.displayName ?? '', expiresAt: invite.expiresAt, valid: true };
  }

  // ── memories ─────────────────────────────────────────────────────────────

  private async attachmentsFor(memoryId: string): Promise<AttachmentRecord[]> {
    const db = await this.db();
    const attachments = await db.getAllFromIndex('attachments', 'by-memory', memoryId);
    return attachments.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.fileName.localeCompare(b.fileName)));
  }

  private async authorMap(): Promise<Map<string, UserRecord>> {
    const db = await this.db();
    const users = await db.getAll('users');
    return new Map(users.map((user) => [user.id, user]));
  }

  private toMemory(
    record: MemoryRecord,
    attachments: AttachmentRecord[],
    author: UserRecord | undefined,
  ): MemoryWithAuthor {
    return {
      ...record,
      attachments: attachments.map(({ blob: _blob, ...rest }) => rest),
      author: {
        id: record.authorId,
        displayName: author?.displayName ?? '未知作者',
      },
    };
  }

  async listMemories(filter: MemoryFilter = {}): Promise<MemoryWithAuthor[]> {
    const { space, viewer } = await this.requireContext();
    const db = await this.db();
    const records = await db.getAllFromIndex('memories', 'by-space', space.id);
    const authors = await this.authorMap();

    const visible = records.filter((record) => canViewMemory(viewer, record));
    const structural = visible.filter((record) => {
      if (filter.authorId && record.authorId !== filter.authorId) return false;
      if (filter.visibility && record.visibility !== filter.visibility) return false;
      if (filter.from && record.occurredOn < filter.from) return false;
      if (filter.to && record.occurredOn > filter.to) return false;
      if (filter.tags?.length) {
        const set = new Set(record.tags);
        if (!filter.tags.every((tag) => set.has(tag))) return false;
      }
      return true;
    });

    const withMeta: MemoryWithAuthor[] = [];
    for (const record of structural) {
      const attachments = await this.attachmentsFor(record.id);
      withMeta.push(this.toMemory(record, attachments, authors.get(record.authorId)));
    }

    if (filter.query?.trim()) {
      const scored = searchMemories(withMeta, filter.query.trim(), { now: this.clock.now() });
      return scored.map((entry) => entry.memory);
    }

    return withMeta.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
  }

  async getMemory(id: string): Promise<MemoryWithAuthor | null> {
    const { space, viewer } = await this.requireContext();
    const db = await this.db();
    const record = await db.get('memories', id);
    if (!record || record.spaceId !== space.id) return null;
    if (!canViewMemory(viewer, record)) return null;
    const attachments = await this.attachmentsFor(record.id);
    const authors = await this.authorMap();
    return this.toMemory(record, attachments, authors.get(record.authorId));
  }

  private async prepareUploads(
    context: ActiveContext,
    memoryId: string,
    files: File[],
    existing: AttachmentRecord[],
  ): Promise<UploadPrepared[]> {
    if (files.length === 0) return [];
    if (existing.length + files.length > 8) {
      throw new AppError('UPLOAD_REJECTED', '一条记忆最多附加 8 个文件。');
    }
    const problem = validateFileSet([...existing.map((a) => ({ name: a.fileName, type: a.mimeType, size: a.byteSize })), ...files]);
    if (problem) throw new AppError('UPLOAD_REJECTED', problem);

    const prepared: UploadPrepared[] = [];
    for (const file of files) {
      const meta = validateFileMeta(file);
      if (!meta.ok) throw new AppError('UPLOAD_REJECTED', meta.reason);
      const signatureOk = await validateFileSignature(file);
      if (!signatureOk) {
        throw new AppError('UPLOAD_REJECTED', `文件「${file.name}」的内容与扩展名不符，已拒绝保存。`);
      }
      const attachmentId = newId('attachment');
      const sha = await sha256Hex(file);
      const record: Omit<AttachmentRecord, 'blob'> = {
        id: attachmentId,
        spaceId: context.space.id,
        memoryId,
        storagePath: buildStoragePath(context.space.id, memoryId, attachmentId, meta.safeName),
        fileName: meta.safeName,
        mimeType: file.type || (meta.kind === 'image' ? 'image/jpeg' : meta.kind === 'video' ? 'video/mp4' : 'audio/mpeg'),
        byteSize: file.size,
        sha256: sha,
        kind: meta.kind,
        createdAt: nowIso(this.clock),
      };
      prepared.push({ record, blob: file });
    }
    return prepared;
  }

  async createMemory(input: CreateMemoryInput): Promise<MemoryWithAuthor> {
    const context = await this.requireContext();
    const parsed = memoryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const db = await this.db();
    const memoryId = newId('memory');
    const files = input.files ?? [];
    if (files.length > 8) throw new AppError('UPLOAD_REJECTED', '一条记忆最多附加 8 个文件。');
    const uploads = await this.prepareUploads(context, memoryId, files, []);
    const now = this.clock.now();
    const record: MemoryRecord = {
      id: memoryId,
      spaceId: context.space.id,
      authorId: context.user.id,
      title: parsed.data.title,
      bodyMd: parsed.data.bodyMd,
      occurredOn: parsed.data.occurredOn,
      occurredTime: parsed.data.occurredTime,
      occurredAt: toIsoTimestamp(parsed.data.occurredOn, parsed.data.occurredTime),
      visibility: parsed.data.visibility,
      locationLabel: parsed.data.locationLabel ?? null,
      tags: parsed.data.tags,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deletedAt: null,
    };

    try {
      const tx = db.transaction(['memories', 'attachments', 'activity'], 'readwrite');
      await tx.objectStore('memories').put(record);
      for (const upload of uploads) {
        await tx.objectStore('attachments').put({ ...upload.record, blob: upload.blob } satisfies AttachmentRecord);
      }
      await tx.objectStore('activity').put({
        id: newId('activity'),
        spaceId: context.space.id,
        actorId: context.user.id,
        action: 'memory.created',
        targetId: memoryId,
        createdAt: now.toISOString(),
      } satisfies ActivityRecord);
      await tx.done;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new AppError('STORAGE_LIMIT', '浏览器存储空间不足，请清理空间或导出备份后重试。', { cause: error });
      }
      throw error;
    }

    const attachments = await this.attachmentsFor(memoryId);
    return this.toMemory(record, attachments, context.user);
  }

  async updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryWithAuthor> {
    const context = await this.requireContext();
    const db = await this.db();
    const existing = await db.get('memories', id);
    if (!existing || existing.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '记忆不存在。');
    if (!canEditMemory(context.viewer, existing)) throw new AppError('FORBIDDEN', '只能编辑自己写下的记忆。');

    const parsed = memoryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));

    const currentAttachments = await this.attachmentsFor(id);
    const removeIds = new Set(input.removeAttachmentIds ?? []);
    const remaining = currentAttachments.filter((attachment) => !removeIds.has(attachment.id));
    const uploads = await this.prepareUploads(context, id, input.addFiles ?? [], remaining);

    const now = nowIso(this.clock);
    const next: MemoryRecord = {
      ...existing,
      title: parsed.data.title,
      bodyMd: parsed.data.bodyMd,
      occurredOn: parsed.data.occurredOn,
      occurredTime: parsed.data.occurredTime,
      occurredAt: toIsoTimestamp(parsed.data.occurredOn, parsed.data.occurredTime),
      visibility: parsed.data.visibility,
      locationLabel: parsed.data.locationLabel ?? null,
      tags: parsed.data.tags,
      updatedAt: now,
    };

    try {
      const tx = db.transaction(['memories', 'attachments', 'activity'], 'readwrite');
      await tx.objectStore('memories').put(next);
      for (const attachmentId of removeIds) {
        const target = currentAttachments.find((attachment) => attachment.id === attachmentId);
        if (target) await tx.objectStore('attachments').delete(attachmentId);
      }
      for (const upload of uploads) {
        await tx.objectStore('attachments').put({ ...upload.record, blob: upload.blob } satisfies AttachmentRecord);
      }
      await tx.objectStore('activity').put({
        id: newId('activity'),
        spaceId: context.space.id,
        actorId: context.user.id,
        action: 'memory.updated',
        targetId: id,
        createdAt: now,
      } satisfies ActivityRecord);
      await tx.done;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new AppError('STORAGE_LIMIT', '浏览器存储空间不足，请清理空间后重试。', { cause: error });
      }
      throw error;
    }

    const attachments = await this.attachmentsFor(id);
    return this.toMemory(next, attachments, context.user);
  }

  async removeMemory(id: string): Promise<void> {
    const context = await this.requireContext();
    const db = await this.db();
    const existing = await db.get('memories', id);
    if (!existing || existing.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '记忆不存在。');
    if (!canEditMemory(context.viewer, existing)) throw new AppError('FORBIDDEN', '只能删除自己写下的记忆。');
    const now = nowIso(this.clock);
    const tx = db.transaction(['memories', 'activity'], 'readwrite');
    await tx.objectStore('memories').put({ ...existing, deletedAt: now, updatedAt: now });
    await tx.objectStore('activity').put({
      id: newId('activity'),
      spaceId: context.space.id,
      actorId: context.user.id,
      action: 'memory.deleted',
      targetId: id,
      createdAt: now,
    } satisfies ActivityRecord);
    await tx.done;
  }

  // ── attachments ──────────────────────────────────────────────────────────

  private async accessibleAttachment(attachmentId: string): Promise<AttachmentRecord> {
    const context = await this.requireContext();
    const db = await this.db();
    const attachment = await db.get('attachments', attachmentId);
    if (!attachment || attachment.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '附件不存在。');
    const memory = await db.get('memories', attachment.memoryId);
    if (!memory || !canViewMemory(context.viewer, memory)) throw new AppError('NOT_FOUND', '附件不存在。');
    return attachment;
  }

  async getAttachmentUrl(attachmentId: string): Promise<string> {
    const cached = this.objectUrls.get(attachmentId);
    if (cached) return cached;
    const attachment = await this.accessibleAttachment(attachmentId);
    try {
      const url = URL.createObjectURL(attachment.blob);
      this.objectUrls.set(attachmentId, url);
      return url;
    } catch {
      throw new AppError('UNKNOWN', '当前浏览器无法预览这个附件。');
    }
  }

  async getAttachmentBytes(attachmentId: string): Promise<Blob> {
    const attachment = await this.accessibleAttachment(attachmentId);
    return attachment.blob;
  }

  // ── anniversaries ────────────────────────────────────────────────────────

  private async anniversaryRecords(): Promise<AnniversaryRecord[]> {
    const { space, viewer } = await this.requireContext();
    const db = await this.db();
    const records = await db.getAllFromIndex('anniversaries', 'by-space', space.id);
    return records.filter((record) => canViewAnniversary(viewer, record));
  }

  async listAnniversaries(): Promise<Anniversary[]> {
    return this.anniversaryRecords();
  }

  async createAnniversary(input: CreateAnniversaryInput): Promise<Anniversary> {
    const context = await this.requireContext();
    const parsed = anniversaryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const db = await this.db();
    const now = nowIso(this.clock);
    const record: AnniversaryRecord = {
      id: newId('anniversary'),
      spaceId: context.space.id,
      authorId: context.user.id,
      name: parsed.data.name,
      date: parsed.data.date,
      repeat: parsed.data.repeat,
      visibility: parsed.data.visibility,
      note: parsed.data.note ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.put('anniversaries', record);
    return record;
  }

  async updateAnniversary(id: string, input: CreateAnniversaryInput): Promise<Anniversary> {
    const context = await this.requireContext();
    const db = await this.db();
    const existing = await db.get('anniversaries', id);
    if (!existing || existing.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '纪念日不存在。');
    if (!canEditAnniversary(context.viewer, existing)) throw new AppError('FORBIDDEN', '只能编辑自己创建的纪念日。');
    const parsed = anniversaryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const next: AnniversaryRecord = {
      ...existing,
      name: parsed.data.name,
      date: parsed.data.date,
      repeat: parsed.data.repeat,
      visibility: parsed.data.visibility,
      note: parsed.data.note ?? null,
      updatedAt: nowIso(this.clock),
    };
    await db.put('anniversaries', next);
    return next;
  }

  async removeAnniversary(id: string): Promise<void> {
    const context = await this.requireContext();
    const db = await this.db();
    const existing = await db.get('anniversaries', id);
    if (!existing || existing.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '纪念日不存在。');
    if (!canEditAnniversary(context.viewer, existing)) throw new AppError('FORBIDDEN', '只能删除自己创建的纪念日。');
    await db.delete('anniversaries', id);
  }

  // ── capsules ─────────────────────────────────────────────────────────────

  async listCapsules(): Promise<Capsule[]> {
    const { space, viewer } = await this.requireContext();
    const db = await this.db();
    const records = await db.getAllFromIndex('capsules', 'by-space', space.id);
    const now = this.clock.now();
    return records
      .filter((record) => canViewCapsuleMetadata(viewer, record))
      .sort((a, b) => (a.opensAt < b.opensAt ? -1 : 1))
      .map((record) => asCapsule(record, now));
  }

  async getCapsule(id: string): Promise<Capsule | null> {
    const { space, viewer } = await this.requireContext();
    const db = await this.db();
    const record = await db.get('capsules', id);
    if (!record || record.spaceId !== space.id) return null;
    if (!canViewCapsuleMetadata(viewer, record)) return null;
    return asCapsule(record, this.clock.now());
  }

  async createCapsule(input: CreateCapsuleInput): Promise<Capsule> {
    const context = await this.requireContext();
    const parsed = capsuleInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const opensAt = new Date(input.opensAt);
    if (Number.isNaN(opensAt.getTime())) throw new AppError('VALIDATION', '请选择有效的开启时间。');
    if (opensAt.getTime() <= this.clock.now().getTime()) {
      throw new AppError('VALIDATION', '开启时间必须在未来。');
    }
    const db = await this.db();
    const now = nowIso(this.clock);
    const record: CapsuleRecord = {
      id: newId('capsule'),
      spaceId: context.space.id,
      authorId: context.user.id,
      title: parsed.data.title,
      opensAt: opensAt.toISOString(),
      visibility: parsed.data.visibility,
      createdAt: now,
      updatedAt: now,
    };
    const tx = db.transaction(['capsules', 'capsuleContents', 'activity'], 'readwrite');
    await tx.objectStore('capsules').put(record);
    await tx.objectStore('capsuleContents').put({
      capsuleId: record.id,
      bodyMd: parsed.data.bodyMd,
      bodyLength: parsed.data.bodyMd.length,
      createdAt: now,
    });
    await tx.objectStore('activity').put({
      id: newId('activity'),
      spaceId: context.space.id,
      actorId: context.user.id,
      action: 'capsule.created',
      targetId: record.id,
      createdAt: now,
    } satisfies ActivityRecord);
    await tx.done;
    return asCapsule(record, this.clock.now());
  }

  async updateCapsule(id: string, input: UpdateCapsuleInput): Promise<Capsule> {
    const context = await this.requireContext();
    const db = await this.db();
    const existing = await db.get('capsules', id);
    if (!existing || existing.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '时间胶囊不存在。');
    if (!canEditCapsule(context.viewer, existing)) throw new AppError('FORBIDDEN', '只能编辑自己创建的时间胶囊。');
    if (this.clock.now().getTime() >= Date.parse(existing.opensAt)) {
      throw new AppError('CONFLICT', '胶囊已经开启，内容与设定已封存，不能再修改。');
    }
    const parsed = capsuleInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const next: CapsuleRecord = {
      ...existing,
      title: parsed.data.title,
      visibility: parsed.data.visibility,
      updatedAt: nowIso(this.clock),
    };
    const content = await db.get('capsuleContents', id);
    const tx = db.transaction(['capsules', 'capsuleContents'], 'readwrite');
    await tx.objectStore('capsules').put(next);
    await tx.objectStore('capsuleContents').put({
      capsuleId: id,
      bodyMd: parsed.data.bodyMd,
      bodyLength: parsed.data.bodyMd.length,
      createdAt: content?.createdAt ?? nowIso(this.clock),
    });
    await tx.done;
    return asCapsule(next, this.clock.now());
  }

  async removeCapsule(id: string): Promise<void> {
    const context = await this.requireContext();
    const db = await this.db();
    const existing = await db.get('capsules', id);
    if (!existing || existing.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '时间胶囊不存在。');
    if (!canEditCapsule(context.viewer, existing)) throw new AppError('FORBIDDEN', '只能删除自己创建的时间胶囊。');
    const tx = db.transaction(['capsules', 'capsuleContents'], 'readwrite');
    await tx.objectStore('capsules').delete(id);
    await tx.objectStore('capsuleContents').delete(id);
    await tx.done;
  }

  async readCapsuleBody(id: string): Promise<CapsuleContent> {
    const context = await this.requireContext();
    const db = await this.db();
    const existing = await db.get('capsules', id);
    if (!existing || existing.spaceId !== context.space.id) throw new AppError('NOT_FOUND', '时间胶囊不存在。');
    if (!canViewCapsuleMetadata(context.viewer, existing)) throw new AppError('NOT_FOUND', '时间胶囊不存在。');
    const now = this.clock.now();
    if (now.getTime() < Date.parse(existing.opensAt)) {
      // Mirrors the server-side RPC: content is refused before the open time.
      throw new CapsuleLockedError(existing.opensAt);
    }
    const content = await db.get('capsuleContents', id);
    if (!content) throw new AppError('NOT_FOUND', '胶囊内容缺失。');

    const alreadyLogged = (await db.getAllFromIndex('activity', 'by-space', existing.spaceId)).some(
      (entry) => entry.action === 'capsule.opened' && entry.targetId === id && entry.actorId === context.user.id,
    );
    if (!alreadyLogged) {
      await db.put('activity', {
        id: newId('activity'),
        spaceId: existing.spaceId,
        actorId: context.user.id,
        action: 'capsule.opened',
        targetId: id,
        createdAt: now.toISOString(),
      } satisfies ActivityRecord);
    }

    return { capsuleId: id, bodyMd: content.bodyMd, openedAt: now.toISOString() };
  }

  // ── preferences & activity ───────────────────────────────────────────────

  async getAiPreference(): Promise<AiPreference> {
    const user = await this.requireUser();
    const db = await this.db();
    const record = await db.get('preferences', user.id);
    return { enabled: record?.aiEnabled ?? false, consentAt: record?.consentAt ?? null };
  }

  async setAiPreference(enabled: boolean): Promise<AiPreference> {
    const user = await this.requireUser();
    const db = await this.db();
    const existing = await db.get('preferences', user.id);
    const now = nowIso(this.clock);
    const consentAt = enabled ? (existing?.consentAt ?? now) : null;
    await db.put('preferences', {
      userId: user.id,
      aiEnabled: enabled,
      consentAt,
      updatedAt: now,
    });
    return { enabled, consentAt };
  }

  async listActivity(limit = 20): Promise<ActivityEntry[]> {
    const { space } = await this.requireContext();
    const db = await this.db();
    const records = await db.getAllFromIndex('activity', 'by-space', space.id);
    return records
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map(({ id, spaceId, actorId, action, targetId, createdAt }) => ({
        id,
        spaceId,
        actorId,
        action,
        targetId,
        createdAt,
      }));
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async resetDemoData(): Promise<void> {
    const db = await this.db();
    await this.clearAllStores(db);
    let assets = new Map<string, Blob>();
    if (this.options.assetLoader) {
      try {
        assets = await this.options.assetLoader();
      } catch {
        // text-only fallback
      }
    }
    await writeDemoSeed(db, this.clock.now(), assets);
    await this.notifyAuth();
  }

  async destroyDatabase(): Promise<void> {
    this.dispose();
    await deleteDB(this.dbName);
  }

  dispose(): void {
    for (const url of this.objectUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    this.objectUrls.clear();
    const pending = this.dbPromise;
    this.dbPromise = null;
    void pending?.then((db) => db.close()).catch(() => undefined);
  }
}
