import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { LocalRepository } from '@/data/local/local-repository';
import type { OurverseDB } from '@/data/local/db';
import { DEMO_SPACE_ID, DEMO_USER_IDS } from '@/domain/types';
import { isAppError } from '@/domain/errors';
import { sha256Hex } from '@/lib/crypto';
import { PNG_BYTES } from '../helpers/fixtures';

const MIME_BY_KEY: Record<string, string> = {
  'sea-sunset.jpg': 'image/jpeg',
  'rain-street.webp': 'image/webp',
  'mountain-stars.png': 'image/png',
  'night-train.jpg': 'image/jpeg',
  'room-tone.mp3': 'audio/mpeg',
  'balcony-moon.webm': 'video/webm',
};

function seedAssets(): Map<string, Blob> {
  const map = new Map<string, Blob>();
  for (const [key, mime] of Object.entries(MIME_BY_KEY)) {
    map.set(key, new Blob([new Uint8Array([...PNG_BYTES, ...new TextEncoder().encode(key)])], { type: mime }));
  }
  return map;
}

let counter = 0;
let repo: LocalRepository;
let dbName: string;

async function makeRepository(): Promise<{ repo: LocalRepository; dbName: string }> {
  counter += 1;
  dbName = `ourverse-test-${Date.now()}-${counter}`;
  repo = new LocalRepository({
    dbName,
    sessionKey: `ourverse-test-session-${counter}`,
    assetLoader: async () => seedAssets(),
  });
  await repo.auth.getState();
  return { repo, dbName };
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error), 'expected a typed AppError').toBe(true);
    expect(isAppError(error) ? error.code : 'none').toBe(code);
    return;
  }
  throw new Error(`Expected AppError(${code}) but the promise resolved.`);
}

async function openTestDb() {
  return openDB<OurverseDB>(dbName);
}

beforeEach(async () => {
  await makeRepository();
});

afterEach(async () => {
  repo.dispose();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await deleteDB(dbName);
});

async function asA() {
  await repo.auth.signInDemo?.(DEMO_USER_IDS.a);
}
async function asB() {
  await repo.auth.signInDemo?.(DEMO_USER_IDS.b);
}
async function asThird() {
  await repo.auth.signInDemo?.(DEMO_USER_IDS.third);
}

function png(name = 'photo.png', size = 0): File {
  const bytes = new Uint8Array(PNG_BYTES.length + size);
  bytes.set(PNG_BYTES);
  return new File([bytes], name, { type: 'image/png' });
}

const baseMemory = {
  title: '测试记忆',
  bodyMd: '一段正文',
  occurredOn: '2026-01-15',
  occurredTime: '20:30' as string | null,
  locationLabel: null,
  tags: ['测试'],
};

describe('demo seed and session', () => {
  it('seeds a fictional two-person space with 13 memories and 6 attachments', async () => {
    await asA();
    const memories = await repo.listMemories();
    expect(memories).toHaveLength(12); // 13 total minus B's private row
    expect(memories.flatMap((memory) => memory.attachments)).toHaveLength(6);
    expect(memories.every((memory) => memory.spaceId === DEMO_SPACE_ID)).toBe(true);
    expect(memories.some((memory) => memory.visibility === 'private')).toBe(true);
  });

  it('returns the owner first and exactly two members', async () => {
    await asA();
    const session = await repo.getSession();
    expect(session?.space?.displayName).toBe('双人星球');
    expect(session?.members).toHaveLength(2);
    expect(session?.members[0]?.role).toBe('owner');
    expect(session?.members[0]?.userId).toBe(DEMO_USER_IDS.a);
  });

  it('rejects anonymous reads', async () => {
    expect(await repo.getSession()).toBeNull();
    await expectAppError(repo.listMemories(), 'UNAUTHENTICATED');
  });

  it('denies an authenticated user who has no space', async () => {
    await asThird();
    expect(await repo.getSession()).toMatchObject({ space: null });
    await expectAppError(repo.listMemories(), 'FORBIDDEN');
    await expectAppError(repo.createMemory({ ...baseMemory, visibility: 'shared' }), 'FORBIDDEN');
  });
});

describe('memory CRUD and validation', () => {
  it('creates, reads, searches, updates and soft-deletes a memory', async () => {
    await asA();
    const created = await repo.createMemory({ ...baseMemory, visibility: 'shared', files: [png()] });
    expect(created.title).toBe('测试记忆');
    expect(created.attachments).toHaveLength(1);
    expect(created.attachments[0]?.storagePath.startsWith(`${DEMO_SPACE_ID}/`)).toBe(true);
    expect(created.attachments[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const fetched = await repo.getMemory(created.id);
    expect(fetched?.bodyMd).toBe('一段正文');

    const searched = await repo.listMemories({ query: '正文' });
    expect(searched.map((memory) => memory.id)).toContain(created.id);

    const updated = await repo.updateMemory(created.id, {
      ...baseMemory,
      title: '更新后的标题',
      visibility: 'private',
      removeAttachmentIds: [created.attachments[0]!.id],
      addFiles: [],
    });
    expect(updated.title).toBe('更新后的标题');
    expect(updated.attachments).toHaveLength(0);

    await repo.removeMemory(created.id);
    expect(await repo.getMemory(created.id)).toBeNull();
    expect((await repo.listMemories()).some((memory) => memory.id === created.id)).toBe(false);
  });

  it('rejects uploads whose bytes do not match the extension', async () => {
    await asA();
    const fake = new File([new TextEncoder().encode('MZ not an image')], 'fake.png', { type: 'image/png' });
    await expectAppError(repo.createMemory({ ...baseMemory, visibility: 'shared', files: [fake] }), 'UPLOAD_REJECTED');
  });

  it('rejects unsupported MIME types and empty titles', async () => {
    await asA();
    const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
    await expectAppError(repo.createMemory({ ...baseMemory, visibility: 'shared', files: [text] }), 'UPLOAD_REJECTED');
    await expectAppError(
      repo.createMemory({ ...baseMemory, title: '', visibility: 'shared' }),
      'VALIDATION',
    );
  });

  it('accepts a 5MB image and a valid MP3', async () => {
    await asA();
    const big = png('big.png', 5 * 1024 * 1024);
    const mp3 = new File([new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0]), ], 'sound.mp3', { type: 'audio/mpeg' });
    const created = await repo.createMemory({ ...baseMemory, visibility: 'shared', files: [big, mp3] });
    expect(created.attachments).toHaveLength(2);
    const bytes = await repo.getAttachmentBytes(created.attachments[0]!.id);
    expect(bytes.size).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('enforces the per-memory attachment limit', async () => {
    await asA();
    const files = Array.from({ length: 9 }, (_, index) => png(`p${index}.png`));
    await expectAppError(repo.createMemory({ ...baseMemory, visibility: 'shared', files }), 'UPLOAD_REJECTED');
  });
});

describe('two-person isolation (negative tests)', () => {
  it('hides A’s private memory and its attachment from B and the third account', async () => {
    await asA();
    const created = await repo.createMemory({
      ...baseMemory,
      title: 'A 的私密记录',
      bodyMd: '只属于A的暗号：紫色潜水艇',
      visibility: 'private',
      files: [png('secret.png')],
    });
    const attachmentId = created.attachments[0]!.id;

    await asB();
    expect(await repo.getMemory(created.id)).toBeNull();
    expect((await repo.listMemories()).some((memory) => memory.id === created.id)).toBe(false);
    expect((await repo.listMemories({ query: '潜水艇' })).some((memory) => memory.id === created.id)).toBe(false);
    await expectAppError(repo.getAttachmentBytes(attachmentId), 'NOT_FOUND');

    await asThird();
    await expectAppError(repo.listMemories(), 'FORBIDDEN');

    await asA();
    expect((await repo.listMemories({ query: '潜水艇' })).some((memory) => memory.id === created.id)).toBe(true);
    expect((await repo.getAttachmentBytes(attachmentId)).size).toBeGreaterThan(0);
  });

  it('prevents B from editing or deleting A’s shared memory', async () => {
    await asA();
    const created = await repo.createMemory({ ...baseMemory, visibility: 'shared' });
    await asB();
    expect(await repo.getMemory(created.id)).not.toBeNull();
    await expectAppError(
      repo.updateMemory(created.id, { ...baseMemory, title: '被篡改', visibility: 'shared', addFiles: [] }),
      'FORBIDDEN',
    );
    await expectAppError(repo.removeMemory(created.id), 'FORBIDDEN');
  });

  it('prevents A from editing B’s shared memory', async () => {
    await asB();
    const created = await repo.createMemory({ ...baseMemory, title: 'B 写的', visibility: 'shared' });
    await asA();
    expect(await repo.getMemory(created.id)).not.toBeNull();
    await expectAppError(
      repo.updateMemory(created.id, { ...baseMemory, visibility: 'shared', addFiles: [] }),
      'FORBIDDEN',
    );
    await expectAppError(repo.removeMemory(created.id), 'FORBIDDEN');
  });

  it('makes attachments unreadable after the memory is deleted', async () => {
    await asA();
    const created = await repo.createMemory({ ...baseMemory, visibility: 'private', files: [png()] });
    const attachmentId = created.attachments[0]!.id;
    await repo.removeMemory(created.id);
    await expectAppError(repo.getAttachmentBytes(attachmentId), 'NOT_FOUND');
  });

  it('keeps private anniversaries and capsules invisible to the other member', async () => {
    await asA();
    const anniversary = await repo.createAnniversary({
      name: '私密纪念日',
      date: '2026-03-02',
      repeat: 'yearly',
      visibility: 'private',
      note: null,
    });
    const capsule = await repo.createCapsule({
      title: '私密胶囊',
      bodyMd: '只有A能看到的正文',
      visibility: 'private',
      opensAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await asB();
    expect((await repo.listAnniversaries()).some((item) => item.id === anniversary.id)).toBe(false);
    expect((await repo.listCapsules()).some((item) => item.id === capsule.id)).toBe(false);
    await expectAppError(repo.updateAnniversary(anniversary.id, {
      name: 'x',
      date: '2026-03-02',
      repeat: 'yearly',
      visibility: 'private',
      note: null,
    }), 'FORBIDDEN');
    await expectAppError(repo.readCapsuleBody(capsule.id), 'NOT_FOUND');
  });
});

describe('invitations', () => {
  async function removeBMembership(): Promise<void> {
    const db = await openTestDb();
    const members = await db.getAll('members');
    const target = members.find((member) => member.userId === DEMO_USER_IDS.b);
    expect(target).toBeDefined();
    await db.delete('members', target!.id);
    db.close();
  }

  it('creates a hashed one-time invite and lets B join', async () => {
    await removeBMembership();
    await asA();
    const created = await repo.createInvite({ ttlHours: 72 });
    expect(created.token).toHaveLength(43);
    expect(created.url).toContain(`invite=${encodeURIComponent(created.token)}`);

    const db = await openTestDb();
    const stored = await db.getAll('invites');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toContain(created.token);
    expect(stored[0]?.tokenHash).toBe(await sha256Hex(new TextEncoder().encode(created.token)));
    db.close();

    const preview = await repo.previewInvite(created.token);
    expect(preview.valid).toBe(true);
    expect(preview.spaceName).toBe('双人星球');

    await asB();
    await repo.auth.acceptInvite({ token: created.token });
    expect((await repo.getSession())?.space?.id).toBe(DEMO_SPACE_ID);
    expect(await repo.listMemories()).toHaveLength(12);

    await asThird();
    await expectAppError(repo.auth.acceptInvite({ token: created.token }), 'INVITE_USED');
  });

  it('rejects revoked and expired invites, and fills the space only once', async () => {
    await removeBMembership();
    await asA();
    const revoked = await repo.createInvite();
    await repo.revokeInvite(revoked.invite.id);
    await asB();
    await expectAppError(repo.auth.acceptInvite({ token: revoked.token }), 'INVITE_INVALID');

    await asA();
    const expired = await repo.createInvite();
    const db = await openTestDb();
    const rows = await db.getAll('invites');
    const target = rows.find((row) => row.revokedAt === null);
    await db.put('invites', { ...target!, expiresAt: new Date(Date.now() - 1000).toISOString() });
    db.close();
    await asB();
    await expectAppError(repo.auth.acceptInvite({ token: expired.token }), 'INVITE_EXPIRED');
  });

  it('rejects a third member even with a valid invite', async () => {
    await asA();
    const token = 'manual-capacity-token';
    const tokenHash = await sha256Hex(new TextEncoder().encode(token));
    const db = await openTestDb();
    await db.put('invites', {
      id: 'invite-capacity',
      spaceId: DEMO_SPACE_ID,
      tokenHash: tokenHash!,
      invitedEmail: null,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      usedAt: null,
      revokedAt: null,
      createdBy: DEMO_USER_IDS.a,
      createdAt: new Date().toISOString(),
    });
    db.close();

    await asThird();
    await expectAppError(repo.auth.acceptInvite({ token }), 'SPACE_FULL');
    await asA();
    await expectAppError(repo.createInvite(), 'SPACE_FULL');
  });

  it('refuses invite creation for non-owners and an invalid token', async () => {
    await asB();
    await expectAppError(repo.createInvite(), 'FORBIDDEN');
    const preview = await repo.previewInvite('not-a-real-token');
    expect(preview.valid).toBe(false);
  });
});

describe('time capsule clock enforcement', () => {
  it('refuses the sealed body before opensAt and allows it afterwards', async () => {
    await asA();
    const capsule = await repo.createCapsule({
      title: '未来才开启',
      bodyMd: '密封的正文',
      visibility: 'shared',
      opensAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(capsule.state).toBe('locked');
    await expectAppError(repo.readCapsuleBody(capsule.id), 'CAPSULE_LOCKED');

    await asB();
    const list = await repo.listCapsules();
    expect(list.find((item) => item.id === capsule.id)?.state).toBe('locked');
    await expectAppError(repo.readCapsuleBody(capsule.id), 'CAPSULE_LOCKED');

    const db = await openTestDb();
    const stored = await db.get('capsules', capsule.id);
    await db.put('capsules', { ...stored!, opensAt: new Date(Date.now() - 1000).toISOString() });
    db.close();

    const opened = await repo.readCapsuleBody(capsule.id);
    expect(opened.bodyMd).toBe('密封的正文');
    expect((await repo.listCapsules()).find((item) => item.id === capsule.id)?.state).toBe('open');
  });

  it('rejects scheduling in the past and editing after opening', async () => {
    await asA();
    await expectAppError(
      repo.createCapsule({
        title: '过去的胶囊',
        bodyMd: '正文',
        visibility: 'shared',
        opensAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      'VALIDATION',
    );

    const capsule = await repo.createCapsule({
      title: '可编辑',
      bodyMd: '正文',
      visibility: 'shared',
      opensAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const updated = await repo.updateCapsule(capsule.id, { title: '已改名', bodyMd: '新正文', visibility: 'shared' });
    expect(updated.title).toBe('已改名');

    const db = await openTestDb();
    const stored = await db.get('capsules', capsule.id);
    await db.put('capsules', { ...stored!, opensAt: new Date(Date.now() - 1000).toISOString() });
    db.close();

    await expectAppError(
      repo.updateCapsule(capsule.id, { title: '再改', bodyMd: '再改', visibility: 'shared' }),
      'CONFLICT',
    );
  });
});

describe('preferences, activity and reset', () => {
  it('keeps AI consent per user', async () => {
    await asA();
    expect((await repo.getAiPreference()).enabled).toBe(false);
    const enabled = await repo.setAiPreference(true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.consentAt).not.toBeNull();
    await asB();
    expect((await repo.getAiPreference()).enabled).toBe(false);
  });

  it('records activity without storing sensitive bodies', async () => {
    await asA();
    await repo.createMemory({ ...baseMemory, bodyMd: '敏感正文不应出现在日志', visibility: 'shared' });
    const activity = await repo.listActivity(10);
    expect(activity.some((entry) => entry.action === 'memory.created')).toBe(true);
    expect(JSON.stringify(activity)).not.toContain('敏感正文');
  });

  it('resets and reseeds the demo world', async () => {
    await asA();
    await repo.createMemory({ ...baseMemory, title: '临时记录', visibility: 'shared' });
    expect((await repo.listMemories()).length).toBe(13);
    await repo.resetDemoData?.();
    await asA();
    expect((await repo.listMemories()).length).toBe(12);
    expect((await repo.listMemories()).some((memory) => memory.title === '临时记录')).toBe(false);
  });

  it('rejects unknown demo identities', async () => {
    await expectAppError(repo.auth.signInDemo?.('not-a-real-user') ?? Promise.reject(new Error('missing')), 'NOT_FOUND');
  });
});
