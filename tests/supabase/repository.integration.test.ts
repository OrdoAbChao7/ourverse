import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Repository } from '@/data/repository';
import { createSupabaseRepository } from '@/data/supabase/supabase-repository';
import { AppError, CapsuleLockedError } from '@/domain/errors';
import type { MemoryWithAuthor, Space } from '@/domain/types';

/**
 * Real integration suite against the local Supabase stack.
 *
 * It is skipped unless both SUPABASE_LOCAL_URL and SUPABASE_LOCAL_ANON_KEY are
 * present. Obtain them for a local run with:
 *
 *   npx supabase status -o env
 *
 * SUPABASE_LOCAL_SERVICE_ROLE_KEY is optional and used only for test setup
 * verification and best-effort cleanup — never by application code.
 */

const url = process.env.SUPABASE_LOCAL_URL ?? '';
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY ?? '';
const serviceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ?? '';
const enabled = url.length > 0 && anonKey.length > 0;

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const password = 'ourverse-integration-password-1';

// A real 1x1 PNG. Enough for the magic-byte check and the storage MIME allowlist.
const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function pngFile(name: string): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

interface TestUser {
  id: string;
  email: string;
}

interface TestState {
  repoA: Repository;
  repoB: Repository;
  repoC: Repository;
  userA: TestUser;
  userB: TestUser;
  userC: TestUser;
  space: Space;
  privateMemory: MemoryWithAuthor;
  sharedMemory: MemoryWithAuthor;
  deletableMemory: MemoryWithAuthor;
  inviteToken: string;
}

const service: SupabaseClient | null =
  enabled && serviceRoleKey.length > 0
    ? createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

const createdUserIds: string[] = [];
const createdSpaceIds: string[] = [];
const createdStoragePaths: string[] = [];

let state: TestState | null = null;

function ctx(): TestState {
  if (!state) throw new Error('integration setup did not complete');
  return state;
}

async function signUp(repo: Repository, label: string, displayName: string): Promise<TestUser> {
  const email = `ourverse.int.${runId}.${label}@example.com`;
  const result = await repo.auth.signUp(email, password, displayName);
  expect(result.needsEmailConfirmation).toBe(false);
  const authState = await repo.auth.getState();
  expect(authState.status).toBe('authenticated');
  expect(authState.backend).toBe('supabase');
  expect(authState.isDemo).toBe(false);
  const id = authState.user?.id;
  if (!id) throw new Error(`sign-up failed for ${label}`);
  createdUserIds.push(id);
  return { id, email };
}

describe.skipIf(!enabled)('Supabase repository (integration)', () => {
  beforeAll(async () => {
    const repoA = createSupabaseRepository({ url, anonKey, storageKey: `ourverse-int-a-${runId}` });
    const repoB = createSupabaseRepository({ url, anonKey, storageKey: `ourverse-int-b-${runId}` });
    const repoC = createSupabaseRepository({ url, anonKey, storageKey: `ourverse-int-c-${runId}` });

    const userA = await signUp(repoA, 'a', 'Alice测试');
    const userB = await signUp(repoB, 'b', 'Bob测试');
    const userC = await signUp(repoC, 'c', 'Carol测试');

    const space = await repoA.createSpace({ displayName: '星光测试空间', motto: '只属于测试的晚安。' });
    createdSpaceIds.push(space.id);
    expect(space.displayName).toBe('星光测试空间');
    expect(space.settings.motto).toBe('只属于测试的晚安。');
    expect(space.relationshipStartAt).toBeNull();

    const privateMemory = await repoA.createMemory({
      title: '私密记忆',
      bodyMd: '只有作者能看到。',
      occurredOn: '2026-01-02',
      occurredTime: '09:30',
      visibility: 'private',
      locationLabel: null,
      tags: ['私密'],
      files: [pngFile('private.png')],
    });
    const sharedMemory = await repoA.createMemory({
      title: '共享记忆',
      bodyMd: '两个人都能看到。',
      occurredOn: '2026-01-03',
      occurredTime: null,
      visibility: 'shared',
      locationLabel: '海边',
      tags: ['旅行'],
      files: [pngFile('shared.png')],
    });
    const deletableMemory = await repoA.createMemory({
      title: '稍后删除',
      bodyMd: '软删除测试。',
      occurredOn: '2026-01-04',
      occurredTime: null,
      visibility: 'shared',
      locationLabel: null,
      tags: [],
    });

    expect(privateMemory.attachments).toHaveLength(1);
    expect(privateMemory.attachments[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sharedMemory.attachments).toHaveLength(1);
    if (privateMemory.attachments[0]) createdStoragePaths.push(privateMemory.attachments[0].storagePath);
    if (sharedMemory.attachments[0]) createdStoragePaths.push(sharedMemory.attachments[0].storagePath);

    const invite = await repoA.createInvite({ invitedEmail: userB.email, ttlHours: 24 });
    expect(invite.token).toHaveLength(64);
    expect(invite.url).toContain(`/login?invite=${invite.token}`);

    const preview = await repoB.previewInvite(invite.token);
    expect(preview.valid).toBe(true);
    expect(preview.spaceName).toBe('星光测试空间');

    await repoB.auth.acceptInvite({ token: invite.token });

    state = {
      repoA,
      repoB,
      repoC,
      userA,
      userB,
      userC,
      space,
      privateMemory,
      sharedMemory,
      deletableMemory,
      inviteToken: invite.token,
    };
  }, 60_000);

  afterAll(async () => {
    if (service) {
      try {
        if (createdStoragePaths.length > 0) {
          await service.storage.from('memories').remove(createdStoragePaths);
        }
      } catch {
        // Best effort.
      }
      for (const spaceId of createdSpaceIds) {
        try {
          await service.from('spaces').delete().eq('id', spaceId);
        } catch {
          // Best effort.
        }
      }
      for (const userId of createdUserIds) {
        try {
          await service.auth.admin.deleteUser(userId);
        } catch {
          // Best effort.
        }
      }
    }
    state?.repoA.dispose?.();
    state?.repoB.dispose?.();
    state?.repoC.dispose?.();
  }, 30_000);

  it('maps the Supabase auth session and shared space', async () => {
    const { repoA, userA, userB, space } = ctx();
    const authState = await repoA.auth.getState();
    expect(authState.status).toBe('authenticated');
    expect(authState.user).toEqual({
      id: userA.id,
      email: userA.email,
      displayName: 'Alice测试',
    });

    const session = await repoA.getSession();
    expect(session?.space?.id).toBe(space.id);
    const memberIds = (session?.members ?? []).map((member) => member.userId).sort();
    expect(memberIds).toEqual([userA.id, userB.id].sort());
    expect(session?.members.find((member) => member.userId === userB.id)?.profile.displayName).toBe('Bob测试');
  });

  it('enforces memory visibility for a co-member', async () => {
    const { repoA, repoB, privateMemory, sharedMemory } = ctx();

    const bMemories = await repoB.listMemories();
    const bIds = bMemories.map((memory) => memory.id);
    expect(bIds).toContain(sharedMemory.id);
    expect(bIds).not.toContain(privateMemory.id);

    expect(await repoB.getMemory(privateMemory.id)).toBeNull();

    const sharedForB = await repoB.getMemory(sharedMemory.id);
    expect(sharedForB?.author.displayName).toBe('Alice测试');
    expect(sharedForB?.attachments).toHaveLength(1);

    // Postgres `time` ('HH:MM:SS') is normalised to the domain's 'HH:MM'.
    const privateForA = await repoA.getMemory(privateMemory.id);
    expect(privateForA?.occurredTime).toBe('09:30');
  });

  it('refuses cross-author updates and deletes', async () => {
    const { repoB, sharedMemory } = ctx();
    const update = {
      title: 'B 的改动',
      bodyMd: '不应成功',
      occurredOn: '2026-01-03',
      occurredTime: null,
      visibility: 'shared' as const,
      locationLabel: null,
      tags: [],
    };

    await expect(repoB.updateMemory(sharedMemory.id, update)).rejects.toBeInstanceOf(AppError);
    await expect(repoB.updateMemory(sharedMemory.id, update)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(repoB.removeMemory(sharedMemory.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await repoB.getMemory(sharedMemory.id)).not.toBeNull();
  });

  it('soft-deletes a memory instead of removing the row', async () => {
    const { repoA, repoB, deletableMemory } = ctx();

    await repoA.removeMemory(deletableMemory.id);

    expect((await repoA.listMemories()).map((memory) => memory.id)).not.toContain(deletableMemory.id);
    expect((await repoB.listMemories()).map((memory) => memory.id)).not.toContain(deletableMemory.id);
    expect(await repoA.getMemory(deletableMemory.id)).toBeNull();

    if (service) {
      const { data, error } = await service
        .from('memories')
        .select('id, deleted_at')
        .eq('id', deletableMemory.id)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.deleted_at).toBeTruthy();
    }
  });

  it('serves attachments only to viewers of their memory', async () => {
    const { repoA, repoB, sharedMemory, privateMemory } = ctx();
    const sharedAttachmentId = sharedMemory.attachments[0]?.id;
    expect(sharedAttachmentId).toBeTruthy();
    if (!sharedAttachmentId) return;

    const signedUrl = await repoA.getAttachmentUrl(sharedAttachmentId);
    expect(signedUrl).toContain('/storage/v1/');
    // Cached until shortly before expiry: the same URL is returned again.
    expect(await repoA.getAttachmentUrl(sharedAttachmentId)).toBe(signedUrl);

    const response = await fetch(signedUrl);
    expect(response.ok).toBe(true);
    const served = new Uint8Array(await response.arrayBuffer());
    expect(served[0]).toBe(0x89);
    expect(served[1]).toBe(0x50);

    const blob = await repoA.getAttachmentBytes(sharedAttachmentId);
    expect(blob.size).toBe(PNG_BYTES.length);

    const bUrl = await repoB.getAttachmentUrl(sharedAttachmentId);
    expect(bUrl).toContain('/storage/v1/');

    const privateAttachmentId = privateMemory.attachments[0]?.id;
    if (privateAttachmentId) {
      await expect(repoB.getAttachmentUrl(privateAttachmentId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('uploads, serves and deletes a 5MB image through private storage', async () => {
    const { repoA, repoB } = ctx();
    const big = new Uint8Array(5 * 1024 * 1024);
    big.set(PNG_BYTES);
    const file = new File([big], 'five-megabytes.png', { type: 'image/png' });

    const memory = await repoA.createMemory({
      title: '五兆图片',
      bodyMd: 'S1 验收要求的 5MB 图片。',
      occurredOn: '2026-01-05',
      occurredTime: null,
      visibility: 'shared',
      locationLabel: null,
      tags: ['验收'],
      files: [file],
    });
    const attachmentId = memory.attachments[0]?.id;
    expect(memory.attachments[0]?.byteSize).toBe(5 * 1024 * 1024);
    if (memory.attachments[0]) createdStoragePaths.push(memory.attachments[0].storagePath);
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) return;

    const blob = await repoA.getAttachmentBytes(attachmentId);
    expect(blob.size).toBe(5 * 1024 * 1024);

    const signed = await repoA.getAttachmentUrl(attachmentId);
    const response = await fetch(signed);
    expect(response.ok).toBe(true);
    const served = new Uint8Array(await response.arrayBuffer());
    expect(served.length).toBe(5 * 1024 * 1024);
    expect(served[0]).toBe(0x89);
    expect(served[1]).toBe(0x50);

    // The co-member can read it because the parent memory is shared.
    expect((await repoB.getAttachmentBytes(attachmentId)).size).toBe(5 * 1024 * 1024);

    await repoA.removeMemory(memory.id);
    await expect(repoA.getAttachmentBytes(attachmentId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repoB.getMemory(memory.id)).resolves.toBeNull();
  });

  it('keeps capsule bodies sealed until the authoritative open time', async () => {
    const { repoA, repoB } = ctx();
    const now = await repoA.now();
    const opensAt = new Date(now.getTime() + 3_000).toISOString();
    const capsule = await repoA.createCapsule({
      title: '给未来的信',
      bodyMd: '封存的内容。',
      opensAt,
      visibility: 'shared',
    });
    expect(capsule.state).toBe('locked');

    await expect(repoA.readCapsuleBody(capsule.id)).rejects.toBeInstanceOf(CapsuleLockedError);
    await expect(repoB.readCapsuleBody(capsule.id)).rejects.toMatchObject({ code: 'CAPSULE_LOCKED' });

    await new Promise((resolve) => setTimeout(resolve, 4_000));

    const content = await repoA.readCapsuleBody(capsule.id);
    expect(content.bodyMd).toBe('封存的内容。');
    const bContent = await repoB.readCapsuleBody(capsule.id);
    expect(bContent.bodyMd).toBe('封存的内容。');

    const opened = await repoA.getCapsule(capsule.id);
    expect(opened?.state).toBe('open');
    await expect(
      repoA.updateCapsule(capsule.id, { title: '改标题', bodyMd: '改内容', visibility: 'shared' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  }, 20_000);

  it('supports anniversary CRUD', async () => {
    const { repoA, repoB } = ctx();
    const created = await repoA.createAnniversary({
      name: '初遇',
      date: '2024-05-20',
      repeat: 'yearly',
      visibility: 'shared',
      note: '纪念日',
    });
    expect(created.name).toBe('初遇');
    expect((await repoB.listAnniversaries()).map((entry) => entry.id)).toContain(created.id);

    const updated = await repoA.updateAnniversary(created.id, {
      name: '初遇纪念',
      date: '2024-05-20',
      repeat: 'yearly',
      visibility: 'shared',
      note: null,
    });
    expect(updated.name).toBe('初遇纪念');

    await repoA.removeAnniversary(created.id);
    expect((await repoA.listAnniversaries()).map((entry) => entry.id)).not.toContain(created.id);
  });

  it('reports a consumed invite as invalid', async () => {
    const { repoA, inviteToken } = ctx();
    const preview = await repoA.previewInvite(inviteToken);
    expect(preview.valid).toBe(false);
    expect(preview.reason).toBe('邀请已被使用。');
  });

  it('stores AI consent per user', async () => {
    const { repoA, repoB } = ctx();

    const aBefore = await repoA.getAiPreference();
    expect(aBefore.enabled).toBe(false);

    const aEnabled = await repoA.setAiPreference(true);
    expect(aEnabled.enabled).toBe(true);
    expect(aEnabled.consentAt).toBeTruthy();

    const bBefore = await repoB.getAiPreference();
    expect(bBefore.enabled).toBe(false);

    await repoB.setAiPreference(true);
    expect((await repoB.getAiPreference()).enabled).toBe(true);
    expect((await repoA.getAiPreference()).enabled).toBe(true);
  });

  it('records activity for space membership and memory changes', async () => {
    const { repoA } = ctx();
    const entries = await repoA.listActivity(50);
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('space.created');
    expect(actions).toContain('member.joined');
    expect(actions).toContain('memory.created');
    expect(actions).toContain('memory.deleted');
  });

  it('blocks anonymous tables and outsider writes through raw supabase-js', async () => {
    const { space, userC } = ctx();

    const anon = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `ourverse-int-anon-${runId}`,
      },
    });
    const anonSpaces = await anon.from('spaces').select('id');
    expect(anonSpaces.data ?? []).toHaveLength(0);
    const anonMemories = await anon.from('memories').select('id');
    expect(anonMemories.data ?? []).toHaveLength(0);

    const anonInsert = await anon.from('memories').insert({
      space_id: space.id,
      author_id: userC.id,
      title: '匿名写入',
      occurred_on: '2026-01-01',
      occurred_at: new Date().toISOString(),
      visibility: 'shared',
    });
    expect(anonInsert.error).not.toBeNull();

    const outsider = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `ourverse-int-outsider-${runId}`,
      },
    });
    const { error: signInError } = await outsider.auth.signInWithPassword({
      email: userC.email,
      password,
    });
    expect(signInError).toBeNull();

    const cMemories = await outsider.from('memories').select('id');
    expect(cMemories.error).toBeNull();
    expect(cMemories.data ?? []).toHaveLength(0);

    const cInsert = await outsider.from('memories').insert({
      space_id: space.id,
      author_id: userC.id,
      title: '越权写入',
      occurred_on: '2026-01-01',
      occurred_at: new Date().toISOString(),
      visibility: 'shared',
    });
    expect(cInsert.error).not.toBeNull();

    await expect(ctx().repoC.listMemories()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
