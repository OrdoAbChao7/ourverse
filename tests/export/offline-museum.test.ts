import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Repository } from '@/data/repository';
import type { ExportScope } from '@/domain/export/scope';
import type { Viewer } from '@/domain/permissions';
import type {
  Anniversary,
  Attachment,
  MemoryWithAuthor,
  Space,
  SpaceMember,
  Visibility,
} from '@/domain/types';
import { buildOfflineMuseum, museumFileName } from '@/features/export/build-museum';
import {
  MuseumBuildError,
  type BuiltMuseum,
  type MuseumFile,
  type MuseumManifest,
  type MuseumMeta,
} from '@/features/export/museum-types';
import {
  IN_MEMORY_LIMIT_BYTES,
  MuseumSaveError,
  saveMuseum,
  streamMuseumZip,
  type WritableSink,
} from '@/features/export/save-file';
import { createMuseumZip } from '@/features/export/zip';

type JsdomWindow = Window;
interface JsdomInstance {
  window: JsdomWindow;
}
type JsdomConstructor = new (
  html?: string,
  options?: { runScripts?: 'dangerously' | 'outside-only'; url?: string },
) => JsdomInstance;

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: JsdomConstructor };

const SPACE_ID = 'space-observatory';
const NOW = new Date(2026, 9, 26, 14, 30, 0);
const NOW_ISO = NOW.toISOString();
const PRIVATE_A_TITLE = '只给 Aster 的悄悄话';
const PRIVATE_B_TITLE = 'Birch 的私密日记';

const VIEWER_A: Viewer = { userId: 'user-a', isMemberOfSpace: true };
const VIEWER_B: Viewer = { userId: 'user-b', isMemberOfSpace: true };

const PNG_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1Z8AAAAASUVORK5CYII=',
    'base64',
  ),
);
const WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d,
  0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f, 0x00, 0x00,
  0x80, 0x3e, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00,
  0x00, 0x00,
]);
const MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00,
  0x00, 0x00, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
]);

const MEDIA_BYTES: Record<string, { bytes: Uint8Array; mimeType: string }> = {
  'att-sea': { bytes: PNG_BYTES, mimeType: 'image/png' },
  'att-radio': { bytes: WAV_BYTES, mimeType: 'audio/wav' },
  'att-tide': { bytes: MP4_BYTES, mimeType: 'video/mp4' },
  'att-window': { bytes: PNG_BYTES, mimeType: 'image/png' },
  'att-secret-a': { bytes: PNG_BYTES, mimeType: 'image/png' },
  'att-secret-b': { bytes: WAV_BYTES, mimeType: 'audio/wav' },
};

const SPACE: Space = {
  id: SPACE_ID,
  displayName: '星海小屋',
  createdBy: 'user-a',
  createdAt: '2025-01-01T00:00:00.000Z',
  relationshipStartAt: '2024-02-14',
  settings: { motto: '把故事留在星光里。', accent: 'violet' },
};

const MEMBERS: SpaceMember[] = [
  {
    id: 'member-a',
    spaceId: SPACE_ID,
    userId: 'user-a',
    role: 'owner',
    joinedAt: '2025-01-01T00:00:00.000Z',
    profile: { id: 'user-a', email: 'aster@example.test', displayName: 'Aster' },
  },
  {
    id: 'member-b',
    spaceId: SPACE_ID,
    userId: 'user-b',
    role: 'member',
    joinedAt: '2025-01-02T00:00:00.000Z',
    profile: { id: 'user-b', email: 'birch@example.test', displayName: 'Birch' },
  },
];

const ANNIVERSARIES: Anniversary[] = [
  {
    id: 'ann-shared',
    spaceId: SPACE_ID,
    authorId: 'user-b',
    name: '第一次一起看海',
    date: '2025-06-18',
    repeat: 'yearly',
    visibility: 'shared',
    note: '那天风很大。',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: 'ann-a-private',
    spaceId: SPACE_ID,
    authorId: 'user-a',
    name: '我自己的纪念日',
    date: '2024-02-14',
    repeat: 'yearly',
    visibility: 'private',
    note: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: 'ann-b-private',
    spaceId: SPACE_ID,
    authorId: 'user-b',
    name: 'Birch 的纪念日',
    date: '2023-10-01',
    repeat: 'once',
    visibility: 'private',
    note: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
];

interface Fixture {
  space: Space;
  members: SpaceMember[];
  anniversaries: Anniversary[];
  memories: MemoryWithAuthor[];
  attachments: Map<string, { bytes: Uint8Array; mimeType: string }>;
}

interface MemorySeed {
  id: string;
  title: string;
  body: string;
  date: string;
  time?: string | null;
  visibility?: Visibility;
  authorId?: string;
  tags?: string[];
  location?: string | null;
  attachments?: Attachment[];
}

function makeAttachment(id: string, memoryId: string, fileName: string): Attachment {
  const media = MEDIA_BYTES[id];
  if (!media) throw new Error(`测试媒体不存在：${id}`);
  const kind: Attachment['kind'] = media.mimeType.startsWith('image/')
    ? 'image'
    : media.mimeType.startsWith('video/')
      ? 'video'
      : 'audio';
  return {
    id,
    spaceId: SPACE_ID,
    memoryId,
    storagePath: `${SPACE_ID}/${memoryId}/${id}`,
    fileName,
    mimeType: media.mimeType,
    byteSize: media.bytes.byteLength,
    sha256: null,
    kind,
    createdAt: NOW_ISO,
  };
}

function makeMemory(seed: MemorySeed): MemoryWithAuthor {
  const authorId = seed.authorId ?? 'user-a';
  const time = seed.time ?? null;
  const occurredAt = `${seed.date}T${time ? `${time}:00` : '12:00:00'}.000Z`;
  return {
    id: seed.id,
    spaceId: SPACE_ID,
    authorId,
    title: seed.title,
    bodyMd: seed.body,
    occurredOn: seed.date,
    occurredTime: time,
    occurredAt,
    visibility: seed.visibility ?? 'shared',
    locationLabel: seed.location ?? null,
    tags: seed.tags ?? [],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    deletedAt: null,
    attachments: seed.attachments ?? [],
    author: {
      id: authorId,
      displayName: authorId === 'user-a' ? 'Aster' : 'Birch',
    },
  };
}

function createFixture(): Fixture {
  const sea = makeAttachment('att-sea', 'm01', 'sea.png');
  const radio = makeAttachment('att-radio', 'm02', 'radio.wav');
  const tide = makeAttachment('att-tide', 'm03', 'tide.mp4');
  const window = makeAttachment('att-window', 'm04', 'window.png');
  const secretA = makeAttachment('att-secret-a', 'm11', 'secret-a.png');
  const secretB = makeAttachment('att-secret-b', 'm12', 'secret-b.wav');

  const memories = [
    makeMemory({
      id: 'm01',
      title: '六月海风',
      body: '六月的海风把盐味吹进窗子。\n\n我们在防波堤上坐到天黑。',
      date: '2026-06-18',
      time: '19:20',
      authorId: 'user-a',
      tags: ['海', '夏天'],
      location: '旧码头',
      attachments: [sea],
    }),
    makeMemory({
      id: 'm02',
      title: '雨夜电台',
      body: '深夜电台放了一首没听过的歌。',
      date: '2026-06-02',
      time: '23:10',
      authorId: 'user-a',
      tags: ['电台', '夜晚'],
      attachments: [radio],
    }),
    makeMemory({
      id: 'm03',
      title: '潮汐线',
      body: '潮汐退得很远，沙地上有两只脚印。',
      date: '2026-05-21',
      time: '16:05',
      authorId: 'user-b',
      tags: ['潮汐'],
      attachments: [tide],
    }),
    makeMemory({
      id: 'm04',
      title: '窗边的光',
      body: '窗边的光落在旧相册上。',
      date: '2026-05-09',
      authorId: 'user-b',
      attachments: [window],
    }),
    makeMemory({
      id: 'm05',
      title: '四月的信',
      body: '四月的风把信纸吹得沙沙响。',
      date: '2026-04-30',
      time: '09:40',
      authorId: 'user-a',
      tags: ['信'],
    }),
    makeMemory({
      id: 'm06',
      title: '旧唱片',
      body: '旧唱片转了三圈才找到那一首。',
      date: '2026-04-11',
      time: '21:15',
      authorId: 'user-b',
      tags: ['唱片'],
    }),
    makeMemory({
      id: 'm07',
      title: '山顶的风',
      body: '山顶的风很大，我们把外套裹紧。',
      date: '2026-03-26',
      time: '14:00',
      authorId: 'user-a',
      tags: ['山'],
    }),
    makeMemory({
      id: 'm08',
      title: '三月的雪',
      body: '三月的雪只下了一个下午。',
      date: '2026-03-08',
      time: '11:30',
      authorId: 'user-b',
      tags: ['雪'],
    }),
    makeMemory({
      id: 'm09',
      title: '夜航',
      body: '夜航的飞机从屋顶上经过。',
      date: '2026-02-14',
      time: '22:45',
      authorId: 'user-a',
      tags: ['夜航'],
    }),
    makeMemory({
      id: 'm10',
      title: '冬日的汤',
      body: '冬日的汤在锅里慢慢冒泡。',
      date: '2026-01-19',
      time: '18:10',
      authorId: 'user-b',
      tags: ['冬天'],
    }),
    makeMemory({
      id: 'm11',
      title: PRIVATE_A_TITLE,
      body: '只有 Aster 能读到的悄悄话。',
      date: '2026-01-05',
      time: '20:00',
      visibility: 'private',
      authorId: 'user-a',
      tags: ['秘密'],
      attachments: [secretA],
    }),
    makeMemory({
      id: 'm12',
      title: PRIVATE_B_TITLE,
      body: '只有 Birch 能读到的内容。',
      date: '2025-12-31',
      time: '23:55',
      visibility: 'private',
      authorId: 'user-b',
      tags: ['秘密'],
      attachments: [secretB],
    }),
  ];

  return {
    space: SPACE,
    members: MEMBERS,
    anniversaries: ANNIVERSARIES,
    memories,
    attachments: new Map(Object.entries(MEDIA_BYTES)),
  };
}

function createRepo(fixture: Fixture = createFixture()) {
  const getAttachmentBytes = vi.fn(async (attachmentId: string): Promise<Blob> => {
    const media = fixture.attachments.get(attachmentId);
    if (!media) throw new Error(`未知附件：${attachmentId}`);
    const copy = new Uint8Array(media.bytes.byteLength);
    copy.set(media.bytes);
    return new Blob([copy.buffer], { type: media.mimeType });
  });

  const repo = {
    kind: 'local',
    isDemo: true,
    now: async () => NOW,
    getCurrentSpace: async () => fixture.space,
    listMembers: async () => fixture.members,
    listAnniversaries: async () => fixture.anniversaries,
    listMemories: async () => fixture.memories,
    getAttachmentBytes,
  } as unknown as Repository;

  return { repo, getAttachmentBytes, fixture };
}

function build(
  repo: Repository,
  viewer: Viewer,
  scope: ExportScope,
  now: Date = NOW,
): Promise<BuiltMuseum> {
  return buildOfflineMuseum({ repo, viewer, scope, now, appVersion: '9.9.9-test' });
}

function fileAt(museum: BuiltMuseum, path: string): MuseumFile {
  const file = museum.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`缺少文件：${path}`);
  return file;
}

function textAt(museum: BuiltMuseum, path: string): string {
  return strFromU8(fileAt(museum, path).bytes);
}

function extractMuseumData(html: string): MuseumMeta {
  const marker = '<script type="application/json" id="museum-data">';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('index.html 中没有 museum-data');
  const end = html.indexOf('</script>', start + marker.length);
  if (end < 0) throw new Error('museum-data 没有闭合的 script 标签');
  return JSON.parse(html.slice(start + marker.length, end)) as MuseumMeta;
}

function attachmentIds(museum: BuiltMuseum): string[] {
  return museum.meta.memories.flatMap((memory) => memory.attachments.map((attachment) => attachment.id));
}

const tempDirectories: string[] = [];

function writeMuseum(museum: BuiltMuseum): string {
  const directory = mkdtempSync(join(tmpdir(), 'ourverse-museum-'));
  tempDirectories.push(directory);
  for (const file of museum.files) {
    const fullPath = join(directory, ...file.path.split('/'));
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.bytes);
  }
  return directory;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

afterAll(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('buildOfflineMuseum', () => {
  it('produces the fixed package layout and correct metadata for all scopes', async () => {
    const { repo } = createRepo();
    const all = await build(repo, VIEWER_A, 'all');
    const paths = all.files.map((file) => file.path);

    for (const required of [
      'index.html',
      'meta.json',
      'memories.json',
      'manifest.json',
      'SHA256SUMS.txt',
      'README.txt',
    ]) {
      expect(paths).toContain(required);
    }
    expect(paths.filter((path) => path.startsWith('memories/'))).toHaveLength(11);
    expect(paths.filter((path) => path.startsWith('assets/'))).toHaveLength(5);
    expect(new Set(paths).size).toBe(paths.length);

    const expectedBytes = ['att-sea', 'att-radio', 'att-tide', 'att-window', 'att-secret-a'].reduce(
      (sum, id) => sum + (MEDIA_BYTES[id]?.bytes.byteLength ?? 0),
      0,
    );
    expect(all.summary).toEqual({
      memoryCount: 11,
      attachmentCount: 5,
      totalBytes: expectedBytes,
    });
    expect(all.meta.counts).toEqual({
      memories: 11,
      attachments: 5,
      anniversaries: 2,
      bytes: expectedBytes,
    });
    expect(all.meta.app).toBe('OURVERSE');
    expect(all.meta.appVersion).toBe('9.9.9-test');
    expect(all.meta.demo).toBe(true);
    expect(all.meta.scope).toBe('all');
    expect(all.meta.space).toEqual({ name: '星海小屋', motto: '把故事留在星光里。' });
    expect(all.meta.members).toEqual(['Aster', 'Birch']);
    expect(all.meta.viewerName).toBe('Aster');
    expect(all.meta.memories[0]?.id).toBe('m01');
    expect(all.meta.anniversaries.map((item) => item.name)).toEqual([
      '我自己的纪念日',
      '第一次一起看海',
    ]);

    expect(JSON.parse(textAt(all, 'meta.json'))).toEqual(all.meta);
    const memoriesDocument = JSON.parse(textAt(all, 'memories.json')) as {
      formatVersion: number;
      generatedAt: string;
      memories: unknown[];
    };
    expect(memoriesDocument.formatVersion).toBe(1);
    expect(memoriesDocument.generatedAt).toBe(NOW_ISO);
    expect(memoriesDocument.memories).toHaveLength(11);

    const manifestPaths = new Set(all.manifest.files.map((file) => file.path));
    const expectedManifestPaths = new Set(
      all.files
        .map((file) => file.path)
        .filter((path) => path !== 'manifest.json' && path !== 'SHA256SUMS.txt'),
    );
    expect(manifestPaths).toEqual(expectedManifestPaths);
    for (const entry of all.manifest.files) {
      const actual = fileAt(all, entry.path);
      expect(entry.sha256).toBe(actual.sha256);
      expect(entry.bytes).toBe(actual.bytes.byteLength);
    }

    const markdownPath = all.files.find(
      (file) => file.path.startsWith('memories/') && strFromU8(file.bytes).includes('id: "m01"'),
    )?.path;
    expect(markdownPath).toMatch(/^memories\/2026-06-18-/);
    const markdown = markdownPath ? textAt(all, markdownPath) : '';
    expect(markdown.startsWith('---\n')).toBe(true);
    expect(markdown).toContain('occurred_on: "2026-06-18"');
    expect(markdown).toContain('occurred_time: "19:20"');
    expect(markdown).toContain('visibility: shared');
    expect(markdown).toContain('tags: ["海","夏天"]');
    expect(markdown).toContain('六月的海风');
    expect(markdown).toContain('<!-- 源文件：');

    const readme = textAt(all, 'README.txt');
    expect(readme).toContain('sha256sum -c SHA256SUMS.txt');
    expect(readme).toContain('node scripts/verify-export.mjs');
    expect(readme).toContain('默认未加密');
    expect(readme).toContain('两份相互独立的备份');

    const mine = await build(createRepo().repo, VIEWER_A, 'mine');
    expect(mine.meta.counts).toMatchObject({ memories: 6, attachments: 3, anniversaries: 2 });
    const shared = await build(createRepo().repo, VIEWER_A, 'shared');
    expect(shared.meta.counts).toMatchObject({ memories: 10, attachments: 4, anniversaries: 2 });
    const bAll = await build(createRepo().repo, VIEWER_B, 'all');
    expect(bAll.meta.counts).toMatchObject({ memories: 11, attachments: 5 });
  });

  it('uses the documented file name format', () => {
    expect(museumFileName(new Date(2026, 9, 26, 14, 30), 'all')).toBe(
      'ourverse-museum-20261026-1430-all.zip',
    );
  });
});

describe('scope isolation', () => {
  it("never fetches another person's private attachments for viewer B", async () => {
    const { repo, getAttachmentBytes } = createRepo();
    const all = await build(repo, VIEWER_B, 'all');

    expect(all.meta.memories.map((memory) => memory.id)).not.toContain('m11');
    expect(all.meta.memories.map((memory) => memory.title)).not.toContain(PRIVATE_A_TITLE);
    expect(attachmentIds(all)).not.toContain('att-secret-a');
    expect(attachmentIds(all)).toContain('att-secret-b');

    const fetched = getAttachmentBytes.mock.calls.map(([id]) => id);
    expect(fetched).not.toContain('att-secret-a');
    expect(fetched).toEqual(expect.arrayContaining(['att-sea', 'att-radio', 'att-tide', 'att-window', 'att-secret-b']));
    expect(getAttachmentBytes).toHaveBeenCalledTimes(5);

    const mineRepo = createRepo();
    const mine = await build(mineRepo.repo, VIEWER_B, 'mine');
    expect(mine.meta.memories.map((memory) => memory.id)).not.toContain('m11');
    expect(attachmentIds(mine)).not.toContain('att-secret-a');
    expect(mineRepo.getAttachmentBytes.mock.calls.map(([id]) => id)).not.toContain('att-secret-a');
    expect(mine.meta.anniversaries.map((item) => item.name)).not.toContain('我自己的纪念日');

    const shared = await build(createRepo().repo, VIEWER_B, 'shared');
    expect(shared.meta.memories.map((memory) => memory.id)).not.toContain('m11');
    expect(shared.meta.memories.map((memory) => memory.id)).toContain('m03');
  });

  it("never includes another person's private memory in any viewer A scope", async () => {
    for (const scope of ['mine', 'shared', 'all'] as const) {
      const { repo, getAttachmentBytes } = createRepo();
      const museum = await build(repo, VIEWER_A, scope);

      expect(museum.meta.memories.map((memory) => memory.id)).not.toContain('m12');
      expect(museum.meta.memories.map((memory) => memory.title)).not.toContain(PRIVATE_B_TITLE);
      expect(attachmentIds(museum)).not.toContain('att-secret-b');
      expect(getAttachmentBytes.mock.calls.map(([id]) => id)).not.toContain('att-secret-b');
      expect(extractMuseumData(textAt(museum, 'index.html')).memories.map((memory) => memory.title)).not.toContain(
        PRIVATE_B_TITLE,
      );
    }
  });

  it('refuses a viewer who is not a member of the space', async () => {
    const { repo, getAttachmentBytes } = createRepo();
    await expect(
      build(repo, { userId: 'stranger', isMemberOfSpace: false }, 'all'),
    ).rejects.toBeInstanceOf(MuseumBuildError);
    await expect(
      build(repo, { userId: 'stranger', isMemberOfSpace: false }, 'all'),
    ).rejects.toMatchObject({ code: 'not-member' });
    await expect(
      build(repo, { userId: null, isMemberOfSpace: true }, 'all'),
    ).rejects.toMatchObject({ code: 'not-member' });
    expect(getAttachmentBytes).not.toHaveBeenCalled();
  });
});

describe('offline viewer and package integrity', () => {
  it('embeds data without remote resources or module scripts', async () => {
    const all = await build(createRepo().repo, VIEWER_A, 'all');
    const index = textAt(all, 'index.html');

    expect(index).not.toContain('http://');
    expect(index).not.toContain('https://');
    expect(index).not.toContain('fetch(');
    expect(index).not.toContain('type="module"');
    expect(index).not.toMatch(/<script[^>]*\ssrc\s*=/i);
    expect(index).not.toMatch(/<link\b/i);

    const embedded = extractMuseumData(index);
    expect(embedded.memories).toHaveLength(11);
    expect(embedded.memories.map((memory) => memory.title)).toContain('六月海风');
    expect(embedded.memories.map((memory) => memory.title)).not.toContain(PRIVATE_B_TITLE);
    expect(index).toContain('assets/0001-sea.png');
  });

  it('writes SHA256SUMS for every file except itself and detects tampering', async () => {
    const { repo } = createRepo();
    const all = await build(repo, VIEWER_A, 'all');
    const lines = all.sha256Sums.trimEnd().split('\n');
    const checksumFiles = all.files.filter((file) => file.path !== 'SHA256SUMS.txt');

    expect(lines).toHaveLength(checksumFiles.length);
    const listedPaths = new Set<string>();
    for (const line of lines) {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      expect(match, `SHA256SUMS 行格式：${line}`).not.toBeNull();
      const hash = match?.[1] ?? '';
      const path = match?.[2] ?? '';
      listedPaths.add(path);
      const actual = fileAt(all, path);
      expect(createHash('sha256').update(actual.bytes).digest('hex')).toBe(hash);
    }
    expect(listedPaths).not.toContain('SHA256SUMS.txt');
    for (const file of checksumFiles) expect(listedPaths).toContain(file.path);

    const directory = writeMuseum(all);
    const script = resolve(process.cwd(), 'scripts', 'verify-export.mjs');
    const successOutput = execFileSync(process.execPath, [script, directory, '--strict'], {
      encoding: 'utf8',
    });
    expect(successOutput).toContain(`共 ${checksumFiles.length} 个文件`);
    expect(successOutput).toContain('[OK]      index.html');
    expect(successOutput).toContain('校验通过');
    expect(successOutput).toContain('严格模式：未发现远程引用或模块脚本');

    const zipPath = join(mkdtempSync(join(tmpdir(), 'ourverse-zip-')), 'museum.zip');
    tempDirectories.push(dirname(zipPath));
    writeFileSync(zipPath, await createMuseumZip(all));
    const zipOutput = execFileSync(process.execPath, [script, zipPath, '--strict'], {
      encoding: 'utf8',
    });
    expect(zipOutput).toContain('类型：ZIP');
    expect(zipOutput).toContain('校验通过');

    const markdownFile = all.files.find((file) => file.path.startsWith('memories/'));
    if (!markdownFile) throw new Error('测试包缺少 Markdown 文件');
    const markdownPath = join(directory, ...markdownFile.path.split('/'));
    const bytes = new Uint8Array(readFileSync(markdownPath));
    bytes[0] = bytes[0] === 0x2d ? 0x2e : 0x2d;
    writeFileSync(markdownPath, bytes);

    let failedStatus = 0;
    let failedOutput = '';
    try {
      failedOutput = execFileSync(process.execPath, [script, directory], { encoding: 'utf8' });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      failedStatus = failure.status ?? 0;
      failedOutput = failure.stdout ?? '';
    }
    expect(failedStatus).toBe(1);
    expect(failedOutput).toContain(`[FAIL]    ${markdownFile.path}`);
    expect(failedOutput).toContain('哈希不匹配');
    expect(failedOutput).toContain('校验失败');
  });
});

describe('ZIP output', () => {
  it('round-trips through fflate with the expected paths and valid embedded JSON', async () => {
    const all = await build(createRepo().repo, VIEWER_A, 'all');
    const zip = await createMuseumZip(all);
    const entries = unzipSync(zip);
    const paths = Object.keys(entries);

    expect(paths).toHaveLength(all.files.length);
    for (const file of all.files) expect(entries[file.path]).toBeDefined();

    const assetPaths = paths.filter((path) => path.startsWith('assets/'));
    expect(assetPaths).toHaveLength(5);
    for (const path of assetPaths) expect(path).toMatch(/^assets\/\d{4}-[^/]+$/);
    expect(assetPaths).toContain('assets/0001-sea.png');

    const indexBytes = entries['index.html'];
    if (!indexBytes) throw new Error('ZIP 缺少 index.html');
    const indexHtml = strFromU8(indexBytes);
    const dom = new JSDOM('', { url: 'file:///museum/index.html' });
    const document = new DOMParser().parseFromString(indexHtml, 'text/html');
    const dataScript = document.getElementById('museum-data');
    expect(dataScript).not.toBeNull();
    expect(dataScript?.getAttribute('type')).toBe('application/json');
    const embedded = JSON.parse(dataScript?.textContent ?? 'null') as MuseumMeta;
    expect(embedded).toEqual(all.meta);
    dom.window.close();

    const manifest = JSON.parse(textAt(all, 'manifest.json')) as MuseumManifest;
    expect(manifest.files).toHaveLength(all.files.length - 2);
    expect(manifest.files.map((file) => file.path)).not.toContain('manifest.json');
    expect(manifest.files.map((file) => file.path)).not.toContain('SHA256SUMS.txt');
    expect(manifest.counts).toEqual(all.meta.counts);

    const memoriesDocument = JSON.parse(textAt(all, 'memories.json')) as {
      memories: { attachments: unknown[] }[];
    };
    expect(memoriesDocument.memories).toHaveLength(11);
    expect(memoriesDocument.memories.flatMap((memory) => memory.attachments)).toHaveLength(5);

    const readme = textAt(all, 'README.txt');
    expect(readme).toContain('memories/*.md');
    expect(readme).toContain('SHA256SUMS.txt');
    expect(readme).toContain('默认未加密');
  });
});

describe('Markdown rendering security', () => {
  it('escapes raw HTML from memory bodies and still renders safe Markdown', async () => {
    const fixture = createFixture();
    const memory = fixture.memories.find((candidate) => candidate.id === 'm01');
    if (!memory) throw new Error('测试记忆不存在');
    memory.bodyMd = [
      '<img src=x onerror=alert(1)>',
      '',
      '## 小标题',
      '',
      '**粗体** 和 *斜体* 和 `代码`',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '> 引用',
      '',
      '---',
      '',
      '[示例](https://example.com)',
    ].join('\n');

    const built = await build(createRepo(fixture).repo, VIEWER_A, 'all');
    const dom = new JSDOM(textAt(built, 'index.html'), {
      runScripts: 'dangerously',
      url: 'file:///museum/index.html',
    });
    const document = dom.window.document;
    const firstCard = document.querySelector('.memory-card') as HTMLElement | null;
    expect(firstCard).not.toBeNull();
    firstCard?.click();

    const prose = document.querySelector('#detail-content .prose');
    expect(prose).not.toBeNull();
    expect(prose?.querySelector('img')).toBeNull();
    expect(prose?.querySelector('[onerror]')).toBeNull();
    expect(prose?.innerHTML).toContain('&lt;img');
    expect(prose?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(prose?.querySelector('h2')?.textContent).toBe('小标题');
    expect(prose?.querySelector('strong')?.textContent).toBe('粗体');
    expect(prose?.querySelector('em')?.textContent).toBe('斜体');
    expect(prose?.querySelector('code')?.textContent).toBe('代码');
    expect(prose?.querySelectorAll('li')).toHaveLength(2);
    expect(prose?.querySelector('blockquote')?.textContent).toContain('引用');
    expect(prose?.querySelector('hr')).not.toBeNull();

    const link = prose?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    dom.window.close();
  });
});

describe('save-file helpers', () => {
  it('streams a complete ZIP to a writable sink', async () => {
    const built = await build(createRepo().repo, VIEWER_A, 'all');
    const chunks: Uint8Array[] = [];
    const sink: WritableSink = {
      write: vi.fn(async (chunk: Uint8Array) => {
        chunks.push(new Uint8Array(chunk));
      }),
      close: vi.fn(async () => undefined),
    };
    const progress: number[] = [];
    await streamMuseumZip(built, sink, (value) => progress.push(value));

    const entries = unzipSync(concatChunks(chunks));
    expect(entries['index.html']).toBeDefined();
    expect(entries['SHA256SUMS.txt']).toBeDefined();
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('saves through the File System Access API when available', async () => {
    const built = await build(createRepo().repo, VIEWER_A, 'all');
    const chunks: Uint8Array[] = [];
    const sink: WritableSink = {
      write: vi.fn(async (chunk: Uint8Array) => {
        chunks.push(new Uint8Array(chunk));
      }),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => ({ createWritable: async () => sink })),
    });

    const result = await saveMuseum(built, { fileName: 'picker.zip' });
    expect(result).toEqual({ method: 'file-system', fileName: 'picker.zip' });
    expect(sink.close).toHaveBeenCalled();
    expect(chunks.length).toBeGreaterThan(0);
    expect(unzipSync(concatChunks(chunks))['index.html']).toBeDefined();

    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });

  it('falls back to a Blob download and reports progress', async () => {
    const built = await build(createRepo().repo, VIEWER_A, 'all');
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
    const createObjectURL = vi.fn(() => 'blob:museum');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const progress: number[] = [];
      const result = await saveMuseum(built, {
        fileName: 'museum-copy.zip',
        onProgress: (value) => progress.push(value),
      });
      expect(result).toEqual({ method: 'download', fileName: 'museum-copy.zip' });
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(progress).toEqual([0, 1]);
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:museum');
    } finally {
      vi.useRealTimers();
      click.mockRestore();
    }
  });

  it('surfaces storage quota failures as a readable Chinese error', async () => {
    const built = await build(createRepo().repo, VIEWER_A, 'all');
    const sink: WritableSink = {
      write: vi.fn(async () => {
        throw new DOMException('disk full', 'QuotaExceededError');
      }),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => ({ createWritable: async () => sink })),
    });

    let caught: unknown = null;
    try {
      await saveMuseum(built);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MuseumSaveError);
    expect((caught as MuseumSaveError).code).toBe('quota');
    expect((caught as MuseumSaveError).message).toContain('存储空间不足');
    expect(sink.abort).toHaveBeenCalled();

    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });

  it('refuses the in-memory fallback above 300 MB', async () => {
    const built = await build(createRepo().repo, VIEWER_A, 'all');
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
    const huge = {
      ...built,
      files: [
        {
          path: 'oversize.bin',
          bytes: { byteLength: IN_MEMORY_LIMIT_BYTES + 1 },
          mimeType: 'application/octet-stream',
          sha256: '0'.repeat(64),
        },
      ],
    } as unknown as BuiltMuseum;

    await expect(saveMuseum(huge)).rejects.toMatchObject({ code: 'too-large' });
  });
});
