import { strToU8 } from 'fflate';
import type { Repository } from '@/data/repository';
import {
  EXPORT_SCOPE_LABELS,
  selectExportMemories,
  summarizeExport,
  type ExportScope,
} from '@/domain/export/scope';
import { canViewAnniversary, canViewMemory } from '@/domain/permissions';
import type { Attachment, MemoryWithAuthor, SpaceMember } from '@/domain/types';
import { sanitizeFileName } from '@/domain/uploads';
import { sha256Hex } from '@/lib/crypto';
import { formatDateTime, formatIsoForFilename } from '@/lib/date';
import viewerTemplate from './offline-viewer.template.html?raw';
import {
  MuseumBuildError,
  type BuiltMuseum,
  type BuildMuseumInput,
  type MuseumAttachment,
  type MuseumCounts,
  type MuseumFile,
  type MuseumManifest,
  type MuseumManifestFile,
  type MuseumMemory,
  type MuseumMeta,
} from './museum-types';

const DEFAULT_APP_VERSION = '0.1.0';
const HTML_MIME = 'text/html; charset=utf-8';
const JSON_MIME = 'application/json';
const TEXT_MIME = 'text/plain; charset=utf-8';
const MARKDOWN_MIME = 'text/markdown; charset=utf-8';

/** `ourverse-museum-20261026-1430-all.zip` */
export function museumFileName(now: Date, scope: ExportScope): string {
  return `ourverse-museum-${formatIsoForFilename(now)}-${scope}.zip`;
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function byOccurredAtDesc(a: MemoryWithAuthor, b: MemoryWithAuthor): number {
  const aKey = a.occurredAt || a.occurredOn;
  const bKey = b.occurredAt || b.occurredOn;
  if (aKey === bKey) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  return aKey < bKey ? 1 : -1;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function requireHash(bytes: Uint8Array, path: string): Promise<string> {
  const hash = await sha256Hex(bytes);
  if (!hash) {
    throw new MuseumBuildError(
      'hashing-unavailable',
      `当前环境无法为「${path}」计算 SHA-256。请在 HTTPS 或 localhost 安全上下文中重新导出，未校验的文件不会被写入。`,
    );
  }
  return hash;
}

async function textFile(path: string, content: string, mimeType: string): Promise<MuseumFile> {
  const bytes = strToU8(content);
  return { path, bytes, mimeType, sha256: await requireHash(bytes, path) };
}

function sanitizeSegment(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function createSlugger(): (memory: MemoryWithAuthor) => string {
  const used = new Set<string>();
  return (memory) => {
    const base = sanitizeSegment(memory.title) || sanitizeSegment(memory.id) || 'memory';
    const datePrefix = /^\d{4}-\d{2}-\d{2}$/.test(memory.occurredOn) ? memory.occurredOn : 'undated';
    let candidate = `${datePrefix}-${base}`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${datePrefix}-${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  };
}

function yamlValue(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}

function renderMemoryMarkdown(
  memory: MuseumMemory,
  path: string,
): string {
  const lines = [
    '---',
    `id: ${yamlValue(memory.id)}`,
    `title: ${yamlValue(memory.title)}`,
    `occurred_on: ${yamlValue(memory.occurredOn)}`,
    `occurred_time: ${yamlValue(memory.occurredTime)}`,
    `visibility: ${memory.visibility}`,
    `author: ${yamlValue(memory.authorName)}`,
    `tags: ${JSON.stringify(memory.tags)}`,
    `location: ${yamlValue(memory.locationLabel)}`,
  ];
  if (memory.attachments.length === 0) {
    lines.push('attachments: []');
  } else {
    lines.push('attachments:');
    for (const attachment of memory.attachments) {
      lines.push(`  - path: ${yamlValue(attachment.path)}`);
      lines.push(`    fileName: ${yamlValue(attachment.fileName)}`);
      lines.push(`    mimeType: ${yamlValue(attachment.mimeType)}`);
    }
  }
  const body = memory.bodyMd.replace(/\r\n?/g, '\n');
  const trimmed = body.endsWith('\n') ? body : `${body}\n`;
  return `${lines.join('\n')}\n---\n\n<!-- 源文件：${path} -->\n\n${trimmed}`;
}

function buildReadme(meta: MuseumMeta, packageName: string): string {
  const scope = EXPORT_SCOPE_LABELS[meta.scope];
  const lines = [
    'OURVERSE 离线数字博物馆',
    '========================',
    '',
    `包名：${packageName}`,
    `生成时间：${formatDateTime(meta.generatedAt)}`,
    `应用版本：${meta.appVersion}`,
    `导出范围：${scope.title}`,
    `范围说明：${scope.description}`,
    `空间：${meta.space ? meta.space.name : '未命名空间'}`,
    `成员：${meta.members.length > 0 ? meta.members.join('、') : '—'}`,
    `内容：${meta.counts.memories} 条记忆 / ${meta.counts.attachments} 个媒体文件 / ${meta.counts.anniversaries} 个纪念日`,
    `媒体总大小：${formatBytesText(meta.counts.bytes)}`,
    '',
    '如何离线打开',
    '------------',
    '1. 将本 ZIP 解压到一个独立目录。',
    '2. 直接双击解压目录中的 index.html（file:// 方式）。',
    '3. 页面不需要网络、不需要数据库、不需要本地服务；时间线、文字、照片、声音与影像都使用包内相对路径。',
    '   个别浏览器在 file:// 下会限制本地音视频的播放。如果遇到这种情况，',
    '   可以使用任意本地静态文件服务器打开本目录（全程不需要联网），或换用 Chrome / Edge。',
    '',
    '包含内容',
    '--------',
    '- index.html：自包含的离线浏览界面（内联数据、样式与原生脚本）。',
    '- assets/：导出的原始媒体文件，按 4 位序号与文件名保存，未转码。',
    '- memories.json：机器可读的记忆与附件索引，路径均为相对路径。',
    '- memories/*.md：每条记忆一个 Markdown 源文件，含 YAML 风格 frontmatter。',
    '- meta.json：空间、成员、纪念日与计数的完整元数据。',
    '- manifest.json：除自身与 SHA256SUMS.txt 外，所有文件的 SHA-256 清单。',
    '- SHA256SUMS.txt：除自身外，所有文件的 sha256sum 兼容校验清单。',
    '- README.txt：本说明。',
    '',
    '不包含内容',
    '----------',
    '- 对方仅自己可见的记忆、附件与纪念日（导出范围只包含当前导出者可访问的内容）。',
    '- 时间胶囊中尚未到开启时间的密封正文。',
    '- AI 索引、检索日志、会话、令牌、API Key、上传签名链接或任何远程地址。',
    '- 已软删除的记忆。',
    '',
    '隐私说明',
    '--------',
    '这是一份私人的离线副本。包内没有上传能力，也不会主动联网。',
    '但它默认未加密：任何拿到 ZIP 或解压目录的人都可以读取全部内容。',
    '请只保存在你信任的设备与备份介质中，不要上传到公开网盘、代码仓库或聊天群。',
    '若需要加密备份，请在导出后使用你自己信任的加密工具另行处理本 ZIP。',
    '',
    '完整性校验',
    '----------',
    'SHA256SUMS.txt 覆盖除自身以外的全部文件，按路径排序。',
    '在当前解压目录执行（Linux / macOS / Git Bash）：',
    '',
    '    sha256sum -c SHA256SUMS.txt',
    '',
    'macOS 也可以使用：',
    '',
    '    shasum -a 256 -c SHA256SUMS.txt',
    '',
    'Windows PowerShell 可以使用：',
    '',
    '    Get-FileHash -Algorithm SHA256 <文件路径>',
    '',
    '或在 OURVERSE 项目仓库中执行：',
    '',
    '    node scripts/verify-export.mjs <本目录或 ZIP 路径>',
    '',
    'manifest.json 覆盖除 manifest.json 与 SHA256SUMS.txt 以外的全部文件；',
    '两个清单结合即可校验整个包。只要有一个字节被篡改，校验就会失败。',
    '',
    '还原与迁移',
    '----------',
    '- 文字：memories/*.md 可直接被 Obsidian、VS Code 或任意 Markdown 编辑器打开。',
    '- 结构化数据：memories.json 与 meta.json 为 UTF-8 JSON，可导入自建工具或迁移到新系统。',
    '- 媒体：assets/ 中的文件保留原始格式与字节，未做压缩转码。',
    '- 重新导入 OURVERSE 时，请以 memories.json 的 id / 标题 / 日期 / 可见性为准，',
    '  以 memories/*.md 的 frontmatter 与正文作为可读副本，附件路径按相对路径解析。',
    '',
    '长期保存提醒',
    '------------',
    '- ZIP 默认不加密，也不是长期存储的保证。',
    '- 请至少保留两份相互独立的备份（不同设备或不同介质），并定期抽查哈希。',
    '- U 盘、移动硬盘与云盘都可能损坏、丢失或停止服务；不要把唯一副本放在单一介质上。',
    '- 建议每次系统或应用大版本升级后重新导出一份，并保留旧副本直到新副本校验通过。',
    '',
    '格式版本',
    '--------',
    `formatVersion = ${meta.formatVersion}（OURVERSE 离线博物馆）`,
    '',
  ];
  return lines.join('\n');
}

function formatBytesText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildSums(files: MuseumFile[]): string {
  return files
    .slice()
    .sort(byPath)
    .map((file) => `${file.sha256}  ${file.path}`)
    .join('\n') + '\n';
}

function toManifestFile(file: MuseumFile): MuseumManifestFile {
  return {
    path: file.path,
    bytes: file.bytes.byteLength,
    sha256: file.sha256,
    mimeType: file.mimeType,
  };
}

function renderIndex(meta: MuseumMeta, title: string): string {
  const generatedLabel = formatDateTime(meta.generatedAt);
  const scopeLabel = EXPORT_SCOPE_LABELS[meta.scope].title;
  const demoBadge = meta.demo
    ? '<span class="badge badge-demo">DEMO · 虚构演示数据</span>'
    : '';
  const dataJson = JSON.stringify(meta).replace(/</g, '\\u003c');
  const replacements: Record<string, string> = {
    __TITLE__: escapeHtml(title),
    __GENERATED_AT__: escapeHtml(generatedLabel),
    __SCOPE_LABEL__: escapeHtml(scopeLabel),
    __DEMO_BADGE__: demoBadge,
    '/*__MUSEUM_DATA__*/null': dataJson,
  };
  return viewerTemplate.replace(
    /__TITLE__|__GENERATED_AT__|__SCOPE_LABEL__|__DEMO_BADGE__|\/\*__MUSEUM_DATA__\*\/null/g,
    (token) => replacements[token] ?? token,
  );
}

interface BuiltAttachments {
  attachment: MuseumAttachment;
  file: MuseumFile;
}

async function readAttachment(
  repo: Repository,
  attachment: Attachment,
  path: string,
): Promise<BuiltAttachments> {
  let bytes: Uint8Array;
  try {
    const blob = await repo.getAttachmentBytes(attachment.id);
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    throw new MuseumBuildError(
      'attachment-unreadable',
      `附件「${attachment.fileName}」无法读取，导出已中止，以免生成残缺的博物馆。`,
      { cause: error },
    );
  }
  if (bytes.byteLength === 0) {
    throw new MuseumBuildError(
      'attachment-unreadable',
      `附件「${attachment.fileName}」为空，导出已中止。`,
    );
  }
  const sha256 = await requireHash(bytes, path);
  return {
    attachment: {
      id: attachment.id,
      path,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      byteSize: bytes.byteLength,
      sha256,
    },
    file: {
      path,
      bytes,
      mimeType: attachment.mimeType || 'application/octet-stream',
      sha256,
    },
  };
}

/**
 * Builds a complete, self-contained offline museum in memory. The caller can
 * stream it to disk with `saveMuseum` or inspect the files directly.
 *
 * Privacy contract: a non-member is refused outright; every selected memory is
 * re-checked with `canViewMemory`, and attachments are fetched *only* for those
 * memories, so another person's private rows never reach the package even if a
 * repository misbehaves.
 */
export async function buildOfflineMuseum(input: BuildMuseumInput): Promise<BuiltMuseum> {
  const { repo, viewer, scope, now } = input;
  if (Number.isNaN(now.getTime())) {
    throw new MuseumBuildError('invalid-input', '导出时间无效，无法生成离线博物馆。');
  }
  if (!viewer.userId || !viewer.isMemberOfSpace) {
    throw new MuseumBuildError('not-member', '只有当前空间的成员可以导出离线博物馆。');
  }

  const [space, members, anniversaries, rawMemories] = await Promise.all([
    repo.getCurrentSpace(),
    repo.listMembers(),
    repo.listAnniversaries(),
    repo.listMemories(),
  ]);

  const selected = selectExportMemories(viewer, rawMemories, scope).filter((memory) =>
    canViewMemory(viewer, memory),
  );
  const seen = new Set<string>();
  const sortedMemories = selected
    .filter((memory) => {
      if (seen.has(memory.id)) return false;
      seen.add(memory.id);
      return true;
    })
    .sort(byOccurredAtDesc);

  const appVersion = input.appVersion ?? DEFAULT_APP_VERSION;
  const generatedAt = now.toISOString();
  const slugFor = createSlugger();
  const markdownPaths = new Map<string, string>();
  const museumMemories: MuseumMemory[] = [];
  const assetFiles: MuseumFile[] = [];
  let sequence = 0;

  for (const memory of sortedMemories) {
    markdownPaths.set(memory.id, `memories/${slugFor(memory)}.md`);
    const memoryAttachments: MuseumAttachment[] = [];
    for (const attachment of memory.attachments) {
      sequence += 1;
      const safeName = sanitizeFileName(attachment.fileName || `file-${sequence}`);
      const path = `assets/${String(sequence).padStart(4, '0')}-${safeName}`;
      const built = await readAttachment(repo, attachment, path);
      memoryAttachments.push(built.attachment);
      assetFiles.push(built.file);
    }
    museumMemories.push({
      id: memory.id,
      title: memory.title,
      bodyMd: memory.bodyMd,
      occurredOn: memory.occurredOn,
      occurredTime: memory.occurredTime,
      occurredAt: memory.occurredAt,
      visibility: memory.visibility,
      locationLabel: memory.locationLabel,
      tags: [...memory.tags],
      authorName: memory.author.displayName,
      attachments: memoryAttachments,
    });
  }

  const summary = summarizeExport(museumMemories);
  const counts: MuseumCounts = {
    memories: museumMemories.length,
    attachments: summary.attachmentCount,
    anniversaries: 0,
    bytes: summary.totalBytes,
  };

  const visibleAnniversaries = anniversaries
    .filter((anniversary) => canViewAnniversary(viewer, anniversary))
    .map((anniversary) => ({
      name: anniversary.name,
      date: anniversary.date,
      repeat: anniversary.repeat,
      note: anniversary.note,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  counts.anniversaries = visibleAnniversaries.length;

  const memberNames = members
    .map((member: SpaceMember) => member.profile.displayName.trim())
    .filter((name) => name.length > 0);
  const viewerMember = members.find((member) => member.userId === viewer.userId);
  const viewerName = viewerMember?.profile.displayName.trim() || '你';

  const meta: MuseumMeta = {
    formatVersion: 1,
    app: 'OURVERSE',
    appVersion,
    generatedAt,
    demo: repo.isDemo,
    scope,
    space: space ? { name: space.displayName, motto: space.settings.motto } : null,
    members: memberNames,
    viewerName,
    memories: museumMemories,
    anniversaries: visibleAnniversaries,
    counts,
  };

  const packageName = museumFileName(now, scope);
  const title = meta.space ? `${meta.space.name} · OURVERSE 数字博物馆` : 'OURVERSE 数字博物馆';
  const indexHtml = renderIndex(meta, title);
  const memoriesDocument = {
    formatVersion: 1,
    generatedAt,
    memories: museumMemories,
  };
  const readme = buildReadme(meta, packageName);

  const memoryMarkdownFiles: MuseumFile[] = [];
  for (const memory of museumMemories) {
    const path = markdownPaths.get(memory.id);
    if (!path) continue;
    memoryMarkdownFiles.push(
      await textFile(path, renderMemoryMarkdown(memory, path), MARKDOWN_MIME),
    );
  }
  memoryMarkdownFiles.sort(byPath);

  const contentFiles: MuseumFile[] = [
    await textFile('index.html', indexHtml, HTML_MIME),
    await textFile('meta.json', jsonText(meta), JSON_MIME),
    await textFile('memories.json', jsonText(memoriesDocument), JSON_MIME),
    ...memoryMarkdownFiles,
    await textFile('README.txt', readme, TEXT_MIME),
  ];

  const manifest: MuseumManifest = {
    formatVersion: 1,
    app: 'OURVERSE',
    appVersion,
    generatedAt,
    scope,
    demo: meta.demo,
    counts,
    files: [...contentFiles, ...assetFiles].sort(byPath).map(toManifestFile),
  };

  const files: MuseumFile[] = [...contentFiles, ...assetFiles];
  const manifestFile = await textFile('manifest.json', jsonText(manifest), JSON_MIME);
  files.push(manifestFile);
  const sha256Sums = buildSums(files);
  files.push(await textFile('SHA256SUMS.txt', sha256Sums, TEXT_MIME));

  return {
    files,
    meta,
    manifest,
    sha256Sums,
    summary,
  };
}
