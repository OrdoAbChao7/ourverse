import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type {
  AcceptInviteInput,
  AiPreference,
  AuthApi,
  InvitePreview,
  Repository,
  SignUpResult,
} from '@/data/repository';
import { AppError, CapsuleLockedError } from '@/domain/errors';
import {
  anniversaryInputSchema,
  capsuleInputSchema,
  firstZodMessage,
  memoryInputSchema,
  spaceProfileSchema,
} from '@/domain/schemas';
import { searchMemories } from '@/domain/search';
import type {
  ActivityAction,
  ActivityEntry,
  Anniversary,
  Attachment,
  AttachmentKind,
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
  SpaceRole,
  UpdateCapsuleInput,
  UpdateMemoryInput,
  UserProfile,
  Visibility,
} from '@/domain/types';
import { buildStoragePath, validateFileMeta, validateFileSet, validateFileSignature } from '@/domain/uploads';
import { isValidDateString, toIsoTimestamp } from '@/lib/date';
import { sha256Hex } from '@/lib/crypto';
import { createSupabaseClient, type SupabaseRepositoryOptions } from './client';

const MEMORY_BUCKET = 'memories';
const SIGNED_URL_TTL_SECONDS = 120;
const SIGNED_URL_SAFETY_MS = 10_000;
const CLOCK_REFRESH_MS = 5 * 60_000;

// ── PostgREST row shapes (snake_case, exactly as the migrations define them) ──

interface SpaceRow {
  id: string;
  display_name: string;
  created_by: string | null;
  created_at: string;
  relationship_start_at: string | null;
  motto: string;
  accent: string;
}

interface MemberRpcRow {
  id: string;
  space_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  email: string | null;
  display_name: string | null;
}

interface InviteRow {
  id: string;
  space_id: string;
  invited_email: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
}

interface InviteRpcRow {
  invite_id: string;
  space_id: string;
  token: string;
  expires_at: string;
}

interface InvitePreviewRpcRow {
  space_display_name: string | null;
  expires_at: string | null;
  valid: boolean;
  reason: string | null;
}

interface AttachmentRow {
  id: string;
  space_id: string;
  memory_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string | null;
  kind: string;
  created_at: string;
}

interface MemoryRow {
  id: string;
  space_id: string;
  author_id: string;
  title: string;
  body_md: string;
  occurred_on: string;
  occurred_time: string | null;
  occurred_at: string;
  visibility: string;
  location_label: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  attachments?: AttachmentRow[] | null;
}

interface AnniversaryRow {
  id: string;
  space_id: string;
  author_id: string;
  name: string;
  date: string;
  repeat: string;
  visibility: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface CapsuleRow {
  id: string;
  space_id: string;
  author_id: string;
  title: string;
  opens_at: string;
  visibility: string;
  created_at: string;
  updated_at: string;
}

interface CapsuleContentRow {
  capsule_id: string;
  body_md: string;
  created_at: string;
}

interface ActivityRow {
  id: string;
  space_id: string;
  actor_id: string;
  action: string;
  target_id: string | null;
  created_at: string;
}

interface PreferenceRow {
  user_id: string;
  enabled: boolean;
  consent_at: string | null;
}

interface AttachmentInsert {
  id: string;
  space_id: string;
  memory_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string | null;
  kind: AttachmentKind;
}

interface MemoryInsert {
  space_id: string;
  author_id: string;
  title: string;
  body_md: string;
  occurred_on: string;
  occurred_time: string | null;
  occurred_at: string;
  visibility: Visibility;
  location_label: string | null;
  tags: string[];
}

interface MemoryUpdateRow {
  title: string;
  body_md: string;
  occurred_on: string;
  occurred_time: string | null;
  occurred_at: string;
  visibility: Visibility;
  location_label: string | null;
  tags: string[];
}

interface AnniversaryUpdateRow {
  name: string;
  date: string;
  repeat: string;
  visibility: Visibility;
  note: string | null;
}

interface CapsuleUpdateRow {
  title: string;
  visibility: Visibility;
}

interface SpaceUpdateRow {
  display_name?: string;
  motto?: string;
  accent?: string;
  relationship_start_at?: string | null;
}

interface PreparedFile {
  file: File;
  kind: AttachmentKind;
  safeName: string;
  mimeType: string;
  byteSize: number;
  sha256: string | null;
}

interface CachedSignedUrl {
  url: string;
  expiresAt: number;
}

interface ActiveContext {
  user: User;
  space: Space;
}

// ── small mapping + error helpers ────────────────────────────────────────────

function asVisibility(value: string): Visibility {
  return value === 'private' ? 'private' : 'shared';
}

function asRole(value: string): SpaceRole {
  return value === 'owner' ? 'owner' : 'member';
}

function asAttachmentKind(value: string): AttachmentKind {
  return value === 'video' || value === 'audio' ? value : 'image';
}

function asAccent(value: string): Space['settings']['accent'] {
  return value === 'gold' || value === 'cyan' ? value : 'violet';
}

/** Postgres `time` comes back as 'HH:MM:SS'; the domain uses 'HH:MM'. */
function normalizeTime(value: string | null): string | null {
  if (!value) return null;
  return /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : value;
}

function defaultMimeFor(kind: AttachmentKind): string {
  if (kind === 'image') return 'image/jpeg';
  if (kind === 'video') return 'video/mp4';
  return 'audio/mpeg';
}

function displayNameOf(user: User): string {
  const meta: unknown = user.user_metadata;
  if (meta && typeof meta === 'object') {
    const value = (meta as Record<string, unknown>).display_name;
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 60);
  }
  const email = user.email ?? '';
  const local = email.split('@')[0];
  return local && local.length > 0 ? local : '成员';
}

function asUserProfile(user: User): UserProfile {
  return { id: user.id, email: user.email ?? '', displayName: displayNameOf(user) };
}

function asSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    displayName: row.display_name,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at,
    relationshipStartAt: row.relationship_start_at,
    settings: { motto: row.motto, accent: asAccent(row.accent) },
  };
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === 'object') return data as T;
  return null;
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? (error as ErrorLike) : {};
}

interface KnownError {
  needle: string;
  code: AppError['code'];
  message: string;
}

const KNOWN_DB_ERRORS: KnownError[] = [
  { needle: 'SPACE_FULL', code: 'SPACE_FULL', message: '这个空间已经有两位成员了。' },
  { needle: 'INVITE_REVOKED', code: 'INVITE_INVALID', message: '邀请已被撤销。' },
  { needle: 'INVITE_USED', code: 'INVITE_USED', message: '邀请已被使用。' },
  { needle: 'INVITE_EXPIRED', code: 'INVITE_EXPIRED', message: '邀请已过期，请联系空间创建者重新生成。' },
  { needle: 'INVITE_ALREADY_MEMBER', code: 'CONFLICT', message: '你已经是这个空间的成员。' },
  { needle: 'INVALID_INVITE', code: 'INVITE_INVALID', message: '邀请链接无效。' },
  { needle: 'INVITE_INVALID', code: 'INVITE_INVALID', message: '邀请链接无效。' },
  { needle: 'INVITE_NOT_FOUND', code: 'NOT_FOUND', message: '邀请不存在。' },
  { needle: 'USER_ALREADY_IN_SPACE', code: 'CONFLICT', message: '你已经属于一个空间。' },
  { needle: 'NOT_SPACE_OWNER', code: 'FORBIDDEN', message: '只有空间创建者可以执行这个操作。' },
  { needle: 'INVALID_DISPLAY_NAME', code: 'VALIDATION', message: '空间名称需要 1–40 个字符。' },
  { needle: 'INVALID_MOTTO', code: 'VALIDATION', message: '这句话最多 60 个字符。' },
  { needle: 'INVALID_TTL', code: 'VALIDATION', message: '邀请有效期不正确。' },
  { needle: 'INVALID_EMAIL', code: 'VALIDATION', message: '请输入有效的邮箱地址。' },
  { needle: 'INVALID_INPUT', code: 'VALIDATION', message: '输入内容不完整。' },
  { needle: 'AUTH_REQUIRED', code: 'UNAUTHENTICATED', message: '请先登录。' },
  { needle: 'CAPSULE_ALREADY_OPEN', code: 'CONFLICT', message: '胶囊已经开启，内容与设定已封存，不能再修改。' },
  { needle: 'CAPSULE_SEALED', code: 'CONFLICT', message: '胶囊已经封存，不能再写入内容。' },
  { needle: 'CAPSULE_OPEN_TIME_MUST_BE_FUTURE', code: 'VALIDATION', message: '开启时间必须在未来。' },
  { needle: 'CAPSULE_OPEN_TIME_IMMUTABLE', code: 'CONFLICT', message: '胶囊的开启时间不能修改。' },
  { needle: 'CAPSULE_OWNER_IMMUTABLE', code: 'FORBIDDEN', message: '不能更改时间胶囊的归属。' },
  { needle: 'CAPSULE_CONTENT_IMMUTABLE', code: 'FORBIDDEN', message: '胶囊内容不能转移到另一颗胶囊。' },
  { needle: 'CAPSULE_NOT_FOUND', code: 'NOT_FOUND', message: '时间胶囊不存在。' },
  { needle: 'ATTACHMENT_MEMORY_NOT_FOUND', code: 'VALIDATION', message: '附件对应的记忆不存在。' },
  { needle: 'ATTACHMENT_SPACE_MISMATCH', code: 'VALIDATION', message: '附件与空间不匹配。' },
  { needle: 'ATTACHMENT_PATH_MISMATCH', code: 'VALIDATION', message: '附件路径不正确。' },
  { needle: 'ATTACHMENT_PATH_INVALID', code: 'VALIDATION', message: '附件路径不正确。' },
  { needle: 'MEMORY_OWNER_IMMUTABLE', code: 'FORBIDDEN', message: '不能更改记忆的归属。' },
  { needle: 'MEMORY_NOT_FOUND', code: 'NOT_FOUND', message: '记忆不存在。' },
  { needle: 'ANNIVERSARY_OWNER_IMMUTABLE', code: 'FORBIDDEN', message: '不能更改纪念日的归属。' },
  { needle: 'SPACE_NOT_FOUND', code: 'NOT_FOUND', message: '空间不存在。' },
  { needle: 'MEMBER_NOT_FOUND', code: 'NOT_FOUND', message: '成员不存在。' },
  { needle: 'CANNOT_REMOVE_OWNER', code: 'FORBIDDEN', message: '不能移除空间创建者。' },
];

function isNetworkMessage(message: string): boolean {
  return /fetch failed|failed to fetch|networkerror|network error|load failed/i.test(message);
}

function mapDbError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const err = asErrorLike(error);
  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';
  const token = message.toUpperCase();

  for (const known of KNOWN_DB_ERRORS) {
    if (token.includes(known.needle)) {
      return new AppError(known.code, known.message, { cause: error });
    }
  }

  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return new AppError('FORBIDDEN', '你没有权限执行这个操作。', { cause: error });
  }
  if (code === 'PGRST116') {
    return new AppError('NOT_FOUND', '记录不存在。', { cause: error });
  }
  if (code === '23505') {
    return new AppError('CONFLICT', '这条记录已经存在。', { cause: error });
  }
  if (code === '23503' || code === '23502' || code === '23514' || code === '22P02' || code === '22007' || code === '22001') {
    return new AppError('VALIDATION', '输入内容不符合要求。', { cause: error });
  }
  if (code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') {
    return new AppError('UNAUTHENTICATED', '登录状态已失效，请重新登录。', { cause: error });
  }
  if (isNetworkMessage(message)) {
    return new AppError('NETWORK', '网络连接失败，请稍后重试。', { cause: error });
  }
  return new AppError('UNKNOWN', '操作失败，请稍后重试。', { cause: error });
}

function mapStorageError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const err = asErrorLike(error);
  const message = typeof err.message === 'string' ? err.message : '';
  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : typeof err.status === 'number' ? err.status : 0;
  const lower = message.toLowerCase();

  if (lower.includes('bucket not found')) {
    return new AppError('NOT_FOUND', '附件存储空间不存在。', { cause: error });
  }
  if (lower.includes('already exists')) {
    return new AppError('CONFLICT', '附件已经存在。', { cause: error });
  }
  if (statusCode === 413 || lower.includes('payload too large') || lower.includes('too large')) {
    return new AppError('STORAGE_LIMIT', '文件超过了存储空间的上限。', { cause: error });
  }
  if (lower.includes('mime') || statusCode === 415) {
    return new AppError('UPLOAD_REJECTED', '文件类型不被存储空间接受。', { cause: error });
  }
  if (statusCode === 401) {
    return new AppError('UNAUTHENTICATED', '登录状态已失效，请重新登录。', { cause: error });
  }
  if (statusCode === 403 || lower.includes('row-level security') || lower.includes('permission')) {
    return new AppError('FORBIDDEN', '你没有权限上传或读取这个附件。', { cause: error });
  }
  if (isNetworkMessage(message)) {
    return new AppError('NETWORK', '网络连接失败，请稍后重试。', { cause: error });
  }
  return new AppError('UNKNOWN', '附件上传失败，请稍后重试。', { cause: error });
}

function mapAuthError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const err = asErrorLike(error);
  const name = typeof err.name === 'string' ? err.name : '';
  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';

  if (name === 'AuthSessionMissingError' || /session missing/i.test(message)) {
    return new AppError('UNAUTHENTICATED', '请先登录。', { cause: error });
  }
  switch (code) {
    case 'invalid_credentials':
      return new AppError('VALIDATION', '邮箱或密码不正确。', { cause: error });
    case 'user_already_exists':
    case 'email_exists':
      return new AppError('CONFLICT', '这个邮箱已经注册过了。', { cause: error });
    case 'weak_password':
      return new AppError('VALIDATION', message || '密码强度不足。', { cause: error });
    case 'email_not_confirmed':
      return new AppError('VALIDATION', '请先完成邮箱验证。', { cause: error });
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new AppError('CONFLICT', '操作太频繁，请稍后再试。', { cause: error });
    case 'signup_disabled':
      return new AppError('FORBIDDEN', '注册功能已经关闭。', { cause: error });
    default:
      break;
  }
  if (/invalid login credentials/i.test(message)) {
    return new AppError('VALIDATION', '邮箱或密码不正确。', { cause: error });
  }
  if (isNetworkMessage(message)) {
    return new AppError('NETWORK', '网络连接失败，请稍后重试。', { cause: error });
  }
  return new AppError('VALIDATION', message || '登录失败，请检查邮箱和密码。', { cause: error });
}

function previewReason(reason: string | null): string | undefined {
  switch (reason) {
    case 'invite_revoked':
      return '邀请已被撤销。';
    case 'invite_used':
      return '邀请已被使用。';
    case 'invite_expired':
      return '邀请已过期。';
    case 'space_full':
      return '空间已满员。';
    case 'invite_invalid':
      return '邀请链接无效。';
    default:
      return undefined;
  }
}

// ── repository ───────────────────────────────────────────────────────────────

export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const;
  readonly isDemo = false;

  readonly auth: AuthApi;

  private readonly url: string;
  private readonly anonKey: string;
  private readonly client: SupabaseClient;
  private readonly authUnsubscribes = new Set<() => void>();
  private readonly signedUrls = new Map<string, CachedSignedUrl>();
  private clockOffsetMs: number | null = null;
  private clockSampleAt = 0;

  constructor(options: SupabaseRepositoryOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.anonKey = options.anonKey;
    this.client = createSupabaseClient({ ...options, url: this.url });

    this.auth = {
      getState: () => this.getAuthState(),
      subscribe: (listener) => this.subscribeAuth(listener),
      signInWithPassword: (email, password) => this.signInWithPassword(email, password),
      signUp: (email, password, displayName) => this.signUp(email, password, displayName),
      signOut: () => this.signOut(),
      acceptInvite: (input) => this.acceptInvite(input),
    };
  }

  // ── clock ──────────────────────────────────────────────────────────────────

  async now(): Promise<Date> {
    const current = this.monotonicNow();
    if (this.clockOffsetMs === null || current - this.clockSampleAt > CLOCK_REFRESH_MS) {
      const serverMs = await this.fetchServerTimeMs();
      const sample = this.monotonicNow();
      this.clockOffsetMs = serverMs - sample;
      this.clockSampleAt = sample;
    }
    return new Date(this.monotonicNow() + (this.clockOffsetMs ?? 0));
  }

  private monotonicNow(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  private async fetchServerTimeMs(): Promise<number> {
    try {
      const { data, error } = await this.client.rpc('server_now');
      if (!error && typeof data === 'string') {
        const parsed = Date.parse(data);
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch {
      // Fall through to the HTTP Date header.
    }
    try {
      const response = await fetch(`${this.url}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: this.anonKey },
      });
      const header = response.headers.get('date');
      if (header) {
        const parsed = Date.parse(header);
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch {
      // Fall through to the device clock as a last resort.
    }
    return Date.now();
  }

  // ── auth ───────────────────────────────────────────────────────────────────

  private authStateFrom(session: Session | null): AuthState {
    return {
      status: session?.user ? 'authenticated' : 'anonymous',
      user: session?.user ? asUserProfile(session.user) : null,
      backend: 'supabase',
      isDemo: false,
    };
  }

  private async getAuthState(): Promise<AuthState> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw mapAuthError(error);
    return this.authStateFrom(data.session);
  }

  private subscribeAuth(listener: (state: AuthState) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(this.authStateFrom(session));
    });
    const unsubscribe = () => {
      data.subscription.unsubscribe();
    };
    this.authUnsubscribes.add(unsubscribe);
    return () => {
      this.authUnsubscribes.delete(unsubscribe);
      unsubscribe();
    };
  }

  private async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw mapAuthError(error);
  }

  private async signUp(email: string, password: string, displayName: string): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw mapAuthError(error);
    return { needsEmailConfirmation: !data.session };
  }

  private async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error && error.name !== 'AuthSessionMissingError') throw mapAuthError(error);
  }

  private async acceptInvite(input: AcceptInviteInput): Promise<void> {
    await this.requireUser();
    const { error } = await this.client.rpc('accept_space_invite', { p_token: input.token });
    if (error) throw mapDbError(error);
  }

  private async sessionUser(): Promise<User | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw mapAuthError(error);
    return data.session?.user ?? null;
  }

  private async requireUser(): Promise<User> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw mapAuthError(error);
    if (!data.user) throw new AppError('UNAUTHENTICATED', '请先登录。');
    return data.user;
  }

  // ── session + spaces ───────────────────────────────────────────────────────

  async getSession(): Promise<SessionSnapshot | null> {
    const user = await this.sessionUser();
    if (!user) return null;
    const profile = asUserProfile(user);
    const { data, error } = await this.client.from('spaces').select('*').limit(1).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return { user: profile, space: null, members: [] };
    const space = asSpace(data as SpaceRow);
    const members = await this.loadMembers();
    return { user: profile, space, members };
  }

  private async requireContext(): Promise<ActiveContext> {
    const user = await this.requireUser();
    const { data, error } = await this.client.from('spaces').select('*').limit(1).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('FORBIDDEN', '你还没有加入任何空间。');
    return { user, space: asSpace(data as SpaceRow) };
  }

  private async loadMemberRows(): Promise<MemberRpcRow[]> {
    const { data, error } = await this.client.rpc('list_space_members');
    if (error) throw mapDbError(error);
    return Array.isArray(data) ? (data as MemberRpcRow[]) : [];
  }

  private mapMember(row: MemberRpcRow): SpaceMember {
    return {
      id: row.id,
      spaceId: row.space_id,
      userId: row.user_id,
      role: asRole(row.role),
      joinedAt: row.joined_at,
      profile: {
        id: row.user_id,
        email: row.email ?? '',
        displayName: row.display_name?.trim() || '成员',
      },
    };
  }

  private async loadMembers(): Promise<SpaceMember[]> {
    const rows = await this.loadMemberRows();
    return rows.map((row) => this.mapMember(row));
  }

  private async loadAuthorNames(): Promise<Map<string, string>> {
    const rows = await this.loadMemberRows();
    return new Map(rows.map((row) => [row.user_id, row.display_name?.trim() || '成员']));
  }

  async getCurrentSpace(): Promise<Space | null> {
    const user = await this.sessionUser();
    if (!user) return null;
    const { data, error } = await this.client.from('spaces').select('*').limit(1).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? asSpace(data as SpaceRow) : null;
  }

  async createSpace(input: { displayName: string; motto?: string }): Promise<Space> {
    await this.requireUser();
    const parsed = spaceProfileSchema.safeParse({ displayName: input.displayName, motto: input.motto ?? '' });
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const { data, error } = await this.client.rpc('create_space', {
      p_display_name: parsed.data.displayName,
      p_motto: parsed.data.motto || null,
    });
    if (error) throw mapDbError(error);
    const row = firstRow<SpaceRow>(data);
    if (!row) throw new AppError('UNKNOWN', '空间创建失败，请稍后重试。');
    return asSpace(row);
  }

  async updateSpace(
    patch: Partial<Pick<Space, 'displayName' | 'relationshipStartAt'>> & {
      motto?: string;
      accent?: Space['settings']['accent'];
    },
  ): Promise<Space> {
    const { space } = await this.requireContext();
    const row: SpaceUpdateRow = {};
    if (patch.displayName !== undefined) {
      const value = patch.displayName.trim();
      if (!value || value.length > 40) throw new AppError('VALIDATION', '空间名称需要 1–40 个字符。');
      row.display_name = value;
    }
    if (patch.motto !== undefined) row.motto = patch.motto.trim().slice(0, 60);
    if (patch.accent !== undefined) {
      if (patch.accent !== 'violet' && patch.accent !== 'gold' && patch.accent !== 'cyan') {
        throw new AppError('VALIDATION', '未知的主题色。');
      }
      row.accent = patch.accent;
    }
    if (patch.relationshipStartAt !== undefined) {
      if (patch.relationshipStartAt !== null && !isValidDateString(patch.relationshipStartAt)) {
        throw new AppError('VALIDATION', '请选择有效的纪念日日期。');
      }
      row.relationship_start_at = patch.relationshipStartAt;
    }
    if (Object.keys(row).length === 0) return space;

    const { data, error } = await this.client
      .from('spaces')
      .update(row)
      .eq('id', space.id)
      .select('*')
      .single();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('NOT_FOUND', '空间不存在。');
    return asSpace(data as SpaceRow);
  }

  async listMembers(): Promise<SpaceMember[]> {
    await this.requireContext();
    return this.loadMembers();
  }

  // ── invites ────────────────────────────────────────────────────────────────

  async createInvite(input: { invitedEmail?: string | null; ttlHours?: number } = {}): Promise<CreatedInvite> {
    const { user, space } = await this.requireContext();
    const ttlHours = Math.min(168, Math.max(1, input.ttlHours ?? 72));
    const invitedEmail = input.invitedEmail?.trim() || null;
    const { data, error } = await this.client.rpc('create_space_invite', {
      p_invited_email: invitedEmail,
      p_ttl_hours: ttlHours,
    });
    if (error) throw mapDbError(error);
    const rpcRow = firstRow<InviteRpcRow>(data);
    if (!rpcRow) throw new AppError('UNKNOWN', '邀请创建失败，请稍后重试。');

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { data: stored } = await this.client
      .from('space_invites')
      .select('*')
      .eq('id', rpcRow.invite_id)
      .maybeSingle();
    const storedRow = (stored as InviteRow | null) ?? null;
    const createdAt = storedRow?.created_at ?? (await this.now()).toISOString();

    return {
      invite: {
        id: rpcRow.invite_id,
        spaceId: rpcRow.space_id || space.id,
        invitedEmail: storedRow?.invited_email ?? invitedEmail,
        expiresAt: storedRow?.expires_at ?? rpcRow.expires_at,
        usedAt: storedRow?.used_at ?? null,
        revokedAt: storedRow?.revoked_at ?? null,
        createdBy: storedRow?.created_by ?? user.id,
        createdAt,
      },
      token: rpcRow.token,
      url: `${origin}/login?invite=${encodeURIComponent(rpcRow.token)}`,
    };
  }

  async listInvites(): Promise<SpaceInvite[]> {
    await this.requireContext();
    const { data, error } = await this.client
      .from('space_invites')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw mapDbError(error);
    return (Array.isArray(data) ? (data as InviteRow[]) : []).map((row) => ({
      id: row.id,
      spaceId: row.space_id,
      invitedEmail: row.invited_email,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
      createdBy: row.created_by ?? '',
      createdAt: row.created_at,
    }));
  }

  async revokeInvite(inviteId: string): Promise<void> {
    await this.requireContext();
    const { error } = await this.client.rpc('revoke_space_invite', { p_invite_id: inviteId });
    if (error) throw mapDbError(error);
  }

  async previewInvite(token: string): Promise<InvitePreview> {
    const { data, error } = await this.client.rpc('preview_space_invite', { p_token: token });
    if (error) throw mapDbError(error);
    const row = firstRow<InvitePreviewRpcRow>(data);
    if (!row) return { spaceName: '', expiresAt: '', valid: false, reason: '邀请链接无效。' };
    const preview: InvitePreview = {
      spaceName: row.space_display_name ?? '',
      expiresAt: row.expires_at ?? '',
      valid: row.valid,
    };
    const reason = previewReason(row.reason);
    if (reason) preview.reason = reason;
    return preview;
  }

  // ── memories ───────────────────────────────────────────────────────────────

  private toAttachment(row: AttachmentRow): Attachment {
    return {
      id: row.id,
      spaceId: row.space_id,
      memoryId: row.memory_id,
      storagePath: row.storage_path,
      fileName: row.file_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      sha256: row.sha256,
      kind: asAttachmentKind(row.kind),
      createdAt: row.created_at,
    };
  }

  private toMemory(row: MemoryRow, authorNames: Map<string, string>): MemoryWithAuthor {
    const attachments = (row.attachments ?? [])
      .map((attachment) => this.toAttachment(attachment))
      .sort((a, b) => {
        if (a.createdAt < b.createdAt) return -1;
        if (a.createdAt > b.createdAt) return 1;
        return a.fileName.localeCompare(b.fileName);
      });
    return {
      id: row.id,
      spaceId: row.space_id,
      authorId: row.author_id,
      title: row.title,
      bodyMd: row.body_md,
      occurredOn: row.occurred_on,
      occurredTime: normalizeTime(row.occurred_time),
      occurredAt: row.occurred_at,
      visibility: asVisibility(row.visibility),
      locationLabel: row.location_label,
      tags: row.tags ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      attachments,
      author: {
        id: row.author_id,
        displayName: authorNames.get(row.author_id) ?? '未知作者',
      },
    };
  }

  private async fetchMemoryById(id: string): Promise<MemoryWithAuthor | null> {
    const { data, error } = await this.client
      .from('memories')
      .select('*, attachments(*)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return null;
    const authors = await this.loadAuthorNames();
    return this.toMemory(data as MemoryRow, authors);
  }

  async listMemories(filter: MemoryFilter = {}): Promise<MemoryWithAuthor[]> {
    const { space } = await this.requireContext();
    let query = this.client
      .from('memories')
      .select('*, attachments(*)')
      .eq('space_id', space.id)
      .is('deleted_at', null);

    if (filter.authorId) query = query.eq('author_id', filter.authorId);
    if (filter.visibility) query = query.eq('visibility', filter.visibility);
    if (filter.from) query = query.gte('occurred_on', filter.from);
    if (filter.to) query = query.lte('occurred_on', filter.to);
    if (filter.tags?.length) query = query.contains('tags', filter.tags);

    const { data, error } = await query.order('occurred_at', { ascending: false });
    if (error) throw mapDbError(error);

    const authors = await this.loadAuthorNames();
    const memories = (Array.isArray(data) ? (data as MemoryRow[]) : []).map((row) => this.toMemory(row, authors));

    if (filter.query?.trim()) {
      const now = await this.now();
      return searchMemories(memories, filter.query.trim(), { now }).map((entry) => entry.memory);
    }
    return memories;
  }

  async getMemory(id: string): Promise<MemoryWithAuthor | null> {
    await this.requireContext();
    return this.fetchMemoryById(id);
  }

  // Upload validation happens before any bytes leave the browser; the server
  // bucket repeats the MIME/size limits independently.
  private async prepareFiles(files: File[]): Promise<PreparedFile[]> {
    if (files.length === 0) return [];
    const problem = validateFileSet(files);
    if (problem) throw new AppError('UPLOAD_REJECTED', problem);

    const prepared: PreparedFile[] = [];
    for (const file of files) {
      const meta = validateFileMeta(file);
      if (!meta.ok) throw new AppError('UPLOAD_REJECTED', meta.reason);
      const signatureOk = await validateFileSignature(file);
      if (!signatureOk) {
        throw new AppError('UPLOAD_REJECTED', `文件「${file.name}」的内容与扩展名不符，已拒绝保存。`);
      }
      prepared.push({
        file,
        kind: meta.kind,
        safeName: meta.safeName,
        mimeType: file.type || defaultMimeFor(meta.kind),
        byteSize: file.size,
        sha256: await sha256Hex(file),
      });
    }
    return prepared;
  }

  private async uploadFiles(
    spaceId: string,
    memoryId: string,
    prepared: PreparedFile[],
    uploadedPaths: string[],
  ): Promise<AttachmentInsert[]> {
    const rows: AttachmentInsert[] = [];
    for (const item of prepared) {
      const attachmentId = newUuid();
      const storagePath = buildStoragePath(spaceId, memoryId, attachmentId, item.safeName);
      const bytes = await item.file.arrayBuffer();
      const { error } = await this.client.storage.from(MEMORY_BUCKET).upload(storagePath, bytes, {
        contentType: item.mimeType,
        upsert: false,
      });
      if (error) throw mapStorageError(error);
      uploadedPaths.push(storagePath);
      rows.push({
        id: attachmentId,
        space_id: spaceId,
        memory_id: memoryId,
        storage_path: storagePath,
        file_name: item.safeName,
        mime_type: item.mimeType,
        byte_size: item.byteSize,
        sha256: item.sha256,
        kind: item.kind,
      });
    }
    return rows;
  }

  private async removeObjects(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    try {
      await this.client.storage.from(MEMORY_BUCKET).remove(paths);
    } catch {
      // Best effort: the author may already have lost access to the object.
    }
  }

  private async insertAttachments(rows: AttachmentInsert[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client.from('attachments').insert(rows);
    if (error) throw mapDbError(error);
  }

  async createMemory(input: CreateMemoryInput): Promise<MemoryWithAuthor> {
    const parsed = memoryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const { user, space } = await this.requireContext();
    const files = input.files ?? [];
    const prepared = await this.prepareFiles(files);
    const occurredAt = toIsoTimestamp(parsed.data.occurredOn, parsed.data.occurredTime);

    const insert: MemoryInsert = {
      space_id: space.id,
      author_id: user.id,
      title: parsed.data.title,
      body_md: parsed.data.bodyMd,
      occurred_on: parsed.data.occurredOn,
      occurred_time: parsed.data.occurredTime,
      occurred_at: occurredAt,
      visibility: parsed.data.visibility,
      location_label: parsed.data.locationLabel ?? null,
      tags: parsed.data.tags,
    };

    const { data, error } = await this.client.from('memories').insert(insert).select('*').single();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('UNKNOWN', '记忆保存失败，请稍后重试。');
    const memoryRow = data as MemoryRow;

    const uploadedPaths: string[] = [];
    try {
      const attachmentRows = await this.uploadFiles(space.id, memoryRow.id, prepared, uploadedPaths);
      await this.insertAttachments(attachmentRows);
    } catch (uploadError) {
      await this.removeObjects(uploadedPaths);
      try {
        await this.client.from('memories').delete().eq('id', memoryRow.id);
      } catch {
        // The cleanup itself is best effort.
      }
      throw uploadError instanceof AppError ? uploadError : mapStorageError(uploadError);
    }

    await this.logActivity(space.id, user.id, 'memory.created', memoryRow.id);
    const saved = await this.fetchMemoryById(memoryRow.id);
    if (!saved) throw new AppError('UNKNOWN', '记忆保存后无法读取，请刷新后重试。');
    return saved;
  }

  async updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryWithAuthor> {
    const { user, space } = await this.requireContext();
    const { data: existingData, error: existingError } = await this.client
      .from('memories')
      .select('*, attachments(*)')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw mapDbError(existingError);
    if (!existingData) throw new AppError('NOT_FOUND', '记忆不存在。');
    const existing = existingData as MemoryRow;
    if (existing.deleted_at) throw new AppError('NOT_FOUND', '记忆不存在。');
    if (existing.author_id !== user.id) throw new AppError('FORBIDDEN', '只能编辑自己写下的记忆。');

    const parsed = memoryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));

    const currentAttachments = existing.attachments ?? [];
    const removeIds = new Set(input.removeAttachmentIds ?? []);
    const removeTargets = currentAttachments.filter((attachment) => removeIds.has(attachment.id));
    const remaining = currentAttachments.filter((attachment) => !removeIds.has(attachment.id));
    const addFiles = input.addFiles ?? [];

    const setProblem = validateFileSet([
      ...remaining.map((attachment) => ({
        name: attachment.file_name,
        type: attachment.mime_type,
        size: attachment.byte_size,
      })),
      ...addFiles,
    ]);
    if (setProblem) throw new AppError('UPLOAD_REJECTED', setProblem);
    const prepared = await this.prepareFiles(addFiles);

    const patch: MemoryUpdateRow = {
      title: parsed.data.title,
      body_md: parsed.data.bodyMd,
      occurred_on: parsed.data.occurredOn,
      occurred_time: parsed.data.occurredTime,
      occurred_at: toIsoTimestamp(parsed.data.occurredOn, parsed.data.occurredTime),
      visibility: parsed.data.visibility,
      location_label: parsed.data.locationLabel ?? null,
      tags: parsed.data.tags,
    };

    const { error: updateError } = await this.client.from('memories').update(patch).eq('id', id);
    if (updateError) throw mapDbError(updateError);

    const uploadedPaths: string[] = [];
    try {
      const attachmentRows = await this.uploadFiles(space.id, id, prepared, uploadedPaths);
      await this.insertAttachments(attachmentRows);
    } catch (uploadError) {
      await this.removeObjects(uploadedPaths);
      throw uploadError instanceof AppError ? uploadError : mapStorageError(uploadError);
    }

    if (removeTargets.length > 0) {
      // Storage objects first, then the rows that authorise their read policy.
      await this.removeObjects(removeTargets.map((attachment) => attachment.storage_path));
      const { error: deleteError } = await this.client
        .from('attachments')
        .delete()
        .in('id', removeTargets.map((attachment) => attachment.id));
      if (deleteError) throw mapDbError(deleteError);
    }

    await this.logActivity(space.id, user.id, 'memory.updated', id);
    const saved = await this.fetchMemoryById(id);
    if (!saved) throw new AppError('UNKNOWN', '记忆更新后无法读取，请刷新后重试。');
    return saved;
  }

  async removeMemory(id: string): Promise<void> {
    const { user, space } = await this.requireContext();
    const { data, error } = await this.client
      .from('memories')
      .select('id, author_id, deleted_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('NOT_FOUND', '记忆不存在。');
    const row = data as Pick<MemoryRow, 'id' | 'author_id' | 'deleted_at'>;
    if (row.deleted_at) throw new AppError('NOT_FOUND', '记忆不存在。');
    if (row.author_id !== user.id) throw new AppError('FORBIDDEN', '只能删除自己写下的记忆。');

    // A direct UPDATE of `deleted_at` is impossible here: the SELECT policy
    // hides soft-deleted rows and PostgreSQL requires the updated row to stay
    // visible, so the RPC performs the soft delete and stamps server time.
    const { error: deleteError } = await this.client.rpc('soft_delete_memory', {
      p_memory_id: id,
    });
    if (deleteError) throw mapDbError(deleteError);
    await this.logActivity(space.id, user.id, 'memory.deleted', id);
  }

  // ── attachments ────────────────────────────────────────────────────────────

  private async accessibleAttachment(attachmentId: string): Promise<AttachmentRow> {
    await this.requireUser();
    const { data, error } = await this.client
      .from('attachments')
      .select('*')
      .eq('id', attachmentId)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('NOT_FOUND', '附件不存在。');
    return data as AttachmentRow;
  }

  async getAttachmentUrl(attachmentId: string): Promise<string> {
    // Re-authorise on every call before reusing a cached signature. A memory
    // can be (soft) deleted or a membership revoked while the URL is still
    // inside its TTL; the database check makes the app refuse immediately
    // instead of serving a stale signed link.
    const attachment = await this.accessibleAttachment(attachmentId);

    const cached = this.signedUrls.get(attachmentId);
    if (cached && Date.now() < cached.expiresAt) return cached.url;

    const { data, error } = await this.client.storage
      .from(MEMORY_BUCKET)
      .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw mapStorageError(error);
    this.signedUrls.set(attachmentId, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 - SIGNED_URL_SAFETY_MS,
    });
    return data.signedUrl;
  }

  async getAttachmentBytes(attachmentId: string): Promise<Blob> {
    const url = await this.getAttachmentUrl(attachmentId);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new AppError('NOT_FOUND', '附件不存在。');
      return await response.blob();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('NOT_FOUND', '附件不存在。', { cause: error });
    }
  }

  // ── anniversaries ──────────────────────────────────────────────────────────

  private toAnniversary(row: AnniversaryRow): Anniversary {
    return {
      id: row.id,
      spaceId: row.space_id,
      authorId: row.author_id,
      name: row.name,
      date: row.date,
      repeat: row.repeat === 'once' ? 'once' : 'yearly',
      visibility: asVisibility(row.visibility),
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listAnniversaries(): Promise<Anniversary[]> {
    const { space } = await this.requireContext();
    const { data, error } = await this.client
      .from('anniversaries')
      .select('*')
      .eq('space_id', space.id)
      .order('date', { ascending: false });
    if (error) throw mapDbError(error);
    return (Array.isArray(data) ? (data as AnniversaryRow[]) : []).map((row) => this.toAnniversary(row));
  }

  async createAnniversary(input: CreateAnniversaryInput): Promise<Anniversary> {
    const parsed = anniversaryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const { user, space } = await this.requireContext();
    const { data, error } = await this.client
      .from('anniversaries')
      .insert({
        space_id: space.id,
        author_id: user.id,
        name: parsed.data.name,
        date: parsed.data.date,
        repeat: parsed.data.repeat,
        visibility: parsed.data.visibility,
        note: parsed.data.note ?? null,
      })
      .select('*')
      .single();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('UNKNOWN', '纪念日保存失败，请稍后重试。');
    return this.toAnniversary(data as AnniversaryRow);
  }

  async updateAnniversary(id: string, input: CreateAnniversaryInput): Promise<Anniversary> {
    const { user } = await this.requireContext();
    const { data: existingData, error: existingError } = await this.client
      .from('anniversaries')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw mapDbError(existingError);
    if (!existingData) throw new AppError('NOT_FOUND', '纪念日不存在。');
    const existing = existingData as AnniversaryRow;
    if (existing.author_id !== user.id) throw new AppError('FORBIDDEN', '只能编辑自己创建的纪念日。');

    const parsed = anniversaryInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const patch: AnniversaryUpdateRow = {
      name: parsed.data.name,
      date: parsed.data.date,
      repeat: parsed.data.repeat,
      visibility: parsed.data.visibility,
      note: parsed.data.note ?? null,
    };
    const { data, error } = await this.client
      .from('anniversaries')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('UNKNOWN', '纪念日更新失败，请稍后重试。');
    return this.toAnniversary(data as AnniversaryRow);
  }

  async removeAnniversary(id: string): Promise<void> {
    const { user } = await this.requireContext();
    const { data, error } = await this.client
      .from('anniversaries')
      .select('id, author_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('NOT_FOUND', '纪念日不存在。');
    const row = data as Pick<AnniversaryRow, 'id' | 'author_id'>;
    if (row.author_id !== user.id) throw new AppError('FORBIDDEN', '只能删除自己创建的纪念日。');
    const { error: deleteError } = await this.client.from('anniversaries').delete().eq('id', id);
    if (deleteError) throw mapDbError(deleteError);
  }

  // ── capsules ───────────────────────────────────────────────────────────────

  private toCapsule(row: CapsuleRow, now: Date): Capsule {
    return {
      id: row.id,
      spaceId: row.space_id,
      authorId: row.author_id,
      title: row.title,
      opensAt: row.opens_at,
      visibility: asVisibility(row.visibility),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      state: now.getTime() >= Date.parse(row.opens_at) ? 'open' : 'locked',
    };
  }

  async listCapsules(): Promise<Capsule[]> {
    const { space } = await this.requireContext();
    const { data, error } = await this.client
      .from('capsules')
      .select('*')
      .eq('space_id', space.id)
      .order('opens_at', { ascending: true });
    if (error) throw mapDbError(error);
    const now = await this.now();
    return (Array.isArray(data) ? (data as CapsuleRow[]) : []).map((row) => this.toCapsule(row, now));
  }

  async getCapsule(id: string): Promise<Capsule | null> {
    await this.requireContext();
    const { data, error } = await this.client.from('capsules').select('*').eq('id', id).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return null;
    const now = await this.now();
    return this.toCapsule(data as CapsuleRow, now);
  }

  async createCapsule(input: CreateCapsuleInput): Promise<Capsule> {
    const parsed = capsuleInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const opensAt = new Date(input.opensAt);
    if (Number.isNaN(opensAt.getTime())) throw new AppError('VALIDATION', '请选择有效的开启时间。');
    const { user, space } = await this.requireContext();
    const now = await this.now();
    if (opensAt.getTime() <= now.getTime()) throw new AppError('VALIDATION', '开启时间必须在未来。');

    const { data, error } = await this.client
      .from('capsules')
      .insert({
        space_id: space.id,
        author_id: user.id,
        title: parsed.data.title,
        opens_at: opensAt.toISOString(),
        visibility: parsed.data.visibility,
      })
      .select('*')
      .single();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('UNKNOWN', '时间胶囊保存失败，请稍后重试。');
    const capsuleRow = data as CapsuleRow;

    const { error: contentError } = await this.client
      .from('capsule_contents')
      .insert({ capsule_id: capsuleRow.id, body_md: parsed.data.bodyMd });
    if (contentError) {
      try {
        await this.client.from('capsules').delete().eq('id', capsuleRow.id);
      } catch {
        // Best effort cleanup of the metadata row.
      }
      throw mapDbError(contentError);
    }

    await this.logActivity(space.id, user.id, 'capsule.created', capsuleRow.id);
    return this.toCapsule(capsuleRow, now);
  }

  async updateCapsule(id: string, input: UpdateCapsuleInput): Promise<Capsule> {
    const { user } = await this.requireContext();
    const { data: existingData, error: existingError } = await this.client
      .from('capsules')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw mapDbError(existingError);
    if (!existingData) throw new AppError('NOT_FOUND', '时间胶囊不存在。');
    const existing = existingData as CapsuleRow;
    if (existing.author_id !== user.id) throw new AppError('FORBIDDEN', '只能编辑自己创建的时间胶囊。');
    const now = await this.now();
    if (now.getTime() >= Date.parse(existing.opens_at)) {
      throw new AppError('CONFLICT', '胶囊已经开启，内容与设定已封存，不能再修改。');
    }

    const parsed = capsuleInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION', firstZodMessage(parsed.error));
    const patch: CapsuleUpdateRow = { title: parsed.data.title, visibility: parsed.data.visibility };

    const { data, error } = await this.client
      .from('capsules')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('UNKNOWN', '时间胶囊更新失败，请稍后重试。');

    const { error: contentError } = await this.client
      .from('capsule_contents')
      .update({ body_md: parsed.data.bodyMd })
      .eq('capsule_id', id);
    if (contentError) throw mapDbError(contentError);

    return this.toCapsule(data as CapsuleRow, now);
  }

  async removeCapsule(id: string): Promise<void> {
    const { user } = await this.requireContext();
    const { data, error } = await this.client
      .from('capsules')
      .select('id, author_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('NOT_FOUND', '时间胶囊不存在。');
    const row = data as Pick<CapsuleRow, 'id' | 'author_id'>;
    if (row.author_id !== user.id) throw new AppError('FORBIDDEN', '只能删除自己创建的时间胶囊。');
    const { error: deleteError } = await this.client.from('capsules').delete().eq('id', id);
    if (deleteError) throw mapDbError(deleteError);
  }

  async readCapsuleBody(id: string): Promise<CapsuleContent> {
    const { user, space } = await this.requireContext();
    const { data, error } = await this.client.from('capsules').select('*').eq('id', id).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new AppError('NOT_FOUND', '时间胶囊不存在。');
    const capsule = data as CapsuleRow;

    const now = await this.now();
    if (now.getTime() < Date.parse(capsule.opens_at)) {
      throw new CapsuleLockedError(capsule.opens_at);
    }

    // The RLS policy returns zero rows before open even for the author. The
    // additional check keeps the failure typed if the row is absent for any
    // reason — content is never fabricated.
    const { data: contentData, error: contentError } = await this.client
      .from('capsule_contents')
      .select('capsule_id, body_md, created_at')
      .eq('capsule_id', id)
      .maybeSingle();
    if (contentError) throw mapDbError(contentError);
    if (!contentData) throw new CapsuleLockedError(capsule.opens_at);
    const content = contentData as CapsuleContentRow;

    await this.logCapsuleOpened(space.id, user.id, id, now);
    return { capsuleId: content.capsule_id, bodyMd: content.body_md, openedAt: now.toISOString() };
  }

  // ── AI preference + activity ───────────────────────────────────────────────

  async getAiPreference(): Promise<AiPreference> {
    const user = await this.requireUser();
    const { data, error } = await this.client
      .from('user_ai_preferences')
      .select('user_id, enabled, consent_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw mapDbError(error);
    const row = (data as PreferenceRow | null) ?? null;
    return { enabled: row?.enabled ?? false, consentAt: row?.consent_at ?? null };
  }

  async setAiPreference(enabled: boolean): Promise<AiPreference> {
    const user = await this.requireUser();
    // Explicit select-then-write behaves as an upsert while respecting the
    // column-level grants (only `enabled` is updateable).
    const { data: existing, error: lookupError } = await this.client
      .from('user_ai_preferences')
      .select('user_id, enabled, consent_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (lookupError) throw mapDbError(lookupError);

    if (existing) {
      const { error } = await this.client
        .from('user_ai_preferences')
        .update({ enabled })
        .eq('user_id', user.id);
      if (error) throw mapDbError(error);
    } else {
      const { error } = await this.client
        .from('user_ai_preferences')
        .insert({ user_id: user.id, enabled });
      if (error) throw mapDbError(error);
    }

    const { data, error } = await this.client
      .from('user_ai_preferences')
      .select('user_id, enabled, consent_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw mapDbError(error);
    const row = (data as PreferenceRow | null) ?? null;
    return { enabled: row?.enabled ?? enabled, consentAt: row?.consent_at ?? null };
  }

  async listActivity(limit = 20): Promise<ActivityEntry[]> {
    const { space } = await this.requireContext();
    const { data, error } = await this.client
      .from('activity_logs')
      .select('*')
      .eq('space_id', space.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw mapDbError(error);
    return (Array.isArray(data) ? (data as ActivityRow[]) : []).map((row) => ({
      id: row.id,
      spaceId: row.space_id,
      actorId: row.actor_id,
      action: row.action as ActivityAction,
      targetId: row.target_id,
      createdAt: row.created_at,
    }));
  }

  private async logActivity(
    spaceId: string,
    actorId: string,
    action: ActivityAction,
    targetId: string | null,
  ): Promise<void> {
    // Audit entries are ancillary: failing to write one must not undo the
    // content operation. RLS still constrains them to the caller's space.
    try {
      await this.client.from('activity_logs').insert({
        space_id: spaceId,
        actor_id: actorId,
        action,
        target_id: targetId,
      });
    } catch {
      // Best effort.
    }
  }

  private async logCapsuleOpened(
    spaceId: string,
    actorId: string,
    capsuleId: string,
    now: Date,
  ): Promise<void> {
    try {
      const { data } = await this.client
        .from('activity_logs')
        .select('id')
        .eq('action', 'capsule.opened')
        .eq('target_id', capsuleId)
        .eq('actor_id', actorId)
        .limit(1)
        .maybeSingle();
      if (data) return;
      await this.client.from('activity_logs').insert({
        space_id: spaceId,
        actor_id: actorId,
        action: 'capsule.opened',
        target_id: capsuleId,
        created_at: now.toISOString(),
      });
    } catch {
      // Best effort.
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  dispose(): void {
    for (const unsubscribe of this.authUnsubscribes) {
      try {
        unsubscribe();
      } catch {
        // Ignore a listener that was already removed.
      }
    }
    this.authUnsubscribes.clear();
    this.signedUrls.clear();
    try {
      void this.client.auth.stopAutoRefresh();
    } catch {
      // Some environments do not run the refresh timer at all.
    }
  }
}

export function createSupabaseRepository(options: SupabaseRepositoryOptions): Repository {
  return new SupabaseRepository(options);
}
