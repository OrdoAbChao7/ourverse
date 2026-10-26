import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorNotice } from '@/components/ui/Primitives';
import { EXPORT_SCOPE_LABELS, EXPORT_SCOPES, estimateExportBytes, selectExportMemories, summarizeExport, type ExportScope } from '@/domain/export/scope';
import { errorMessage } from '@/domain/errors';
import { formatBytes } from '@/lib/date';
import { cn } from '@/lib/cn';
import { buildOfflineMuseum } from './build-museum';
import type { BuiltMuseum } from './museum-types';
import { saveMuseum, MuseumSaveError, IN_MEMORY_LIMIT_BYTES } from './save-file';
import { IconArchive, IconDownload, IconRefresh, IconShield } from '@/components/icons';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

export function ExportPanel() {
  const repo = useRepository();
  const { session } = useAuth();
  const { toast } = useToast();
  const [scope, setScope] = useState<ExportScope>('all');
  const [built, setBuilt] = useState<BuiltMuseum | null>(null);
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const data = useAsync(() => repo.listMemories(), []);
  const memories = useMemo(() => data.data ?? [], [data.data]);
  const viewer = { userId: session?.user.id ?? null, isMemberOfSpace: Boolean(session?.space) };

  const perScope = useMemo(
    () =>
      EXPORT_SCOPES.map((key) => {
        const selected = selectExportMemories(viewer, memories, key);
        return { key, summary: summarizeExport(selected) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memories, session?.user.id, session?.space],
  );

  const current = perScope.find((entry) => entry.key === scope)?.summary ?? {
    memoryCount: 0,
    attachmentCount: 0,
    totalBytes: 0,
  };
  const estimate = estimateExportBytes(current);

  useEffect(() => {
    setBuilt(null);
    setSavedAs(null);
    setError(null);
  }, [scope]);

  async function onBuild() {
    setBuilding(true);
    setError(null);
    setSavedAs(null);
    setBuilt(null);
    try {
      const now = await repo.now();
      const museum = await buildOfflineMuseum({
        repo,
        viewer,
        scope,
        now,
        appVersion: APP_VERSION,
      });
      setBuilt(museum);
      toast({
        title: '离线博物馆已生成',
        description: `${museum.summary.memoryCount} 条记录 · ${museum.summary.attachmentCount} 个附件 · ${museum.files.length} 个文件，已计算校验和。`,
        tone: 'success',
      });
    } catch (buildError) {
      setError(errorMessage(buildError, '生成离线包失败。'));
    } finally {
      setBuilding(false);
    }
  }

  async function onSave() {
    if (!built) return;
    setSaving(true);
    setProgress(0);
    setError(null);
    try {
      const result = await saveMuseum(built, { onProgress: setProgress });
      setSavedAs(result.fileName);
      toast({
        title: result.method === 'file-system' ? '已写入磁盘' : '已开始下载',
        description:
          result.method === 'file-system'
            ? '解压后用浏览器打开 index.html，断网也能浏览。'
            : '浏览器不支持流式保存，已使用内存打包下载。',
        tone: 'success',
      });
    } catch (saveError) {
      if (saveError instanceof MuseumSaveError && saveError.code === 'aborted') {
        toast({ title: '已取消保存', description: '离线包仍保留在本页，可以再次保存。' });
      } else {
        setError(errorMessage(saveError, '保存离线包失败。'));
      }
    } finally {
      setSaving(false);
    }
  }

  const fsAccess = hasFileSystemAccess();

  return (
    <div className="space-y-5">
      <div className="grid gap-2.5 md:grid-cols-3">
        {EXPORT_SCOPES.map((key) => {
          const entry = perScope.find((item) => item.key === key);
          const summary = entry?.summary ?? { memoryCount: 0, attachmentCount: 0, totalBytes: 0 };
          const active = scope === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              aria-pressed={active}
              className={cn(
                'rounded-xl border p-3.5 text-left transition-colors duration-200',
                active
                  ? 'border-violet/40 bg-violet/[0.07]'
                  : 'border-white/8 bg-white/[0.02] hover:border-white/15',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-ink">{EXPORT_SCOPE_LABELS[key].title}</span>
                {active && <Badge tone="violet">已选</Badge>}
              </span>
              <span className="mt-1.5 block text-[10.5px] leading-relaxed text-dim">
                {EXPORT_SCOPE_LABELS[key].description}
              </span>
              <span className="num mt-2.5 block text-[10.5px] text-mist/70">
                {summary.memoryCount} 条 · {summary.attachmentCount} 个附件 · {formatBytes(summary.totalBytes)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-[11.5px] text-dim">
        <span>
          预计体积约 <span className="num text-mist">{formatBytes(estimate)}</span>
          {!fsAccess && estimate > IN_MEMORY_LIMIT_BYTES && (
            <span className="text-[#f2e0b9]"> · 当前浏览器不支持流式保存，超过 300MB 将拒绝导出</span>
          )}
        </span>
        <span className="text-[10.5px] text-dim/70">
          {fsAccess ? '支持流式写入磁盘（File System Access）' : '将使用内存打包下载'}
        </span>
      </div>

      {error && <ErrorNotice title="导出没有完成" message={error} />}

      {!built ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] px-4 py-4">
          <div>
            <p className="text-[13px] text-ink">生成离线数字博物馆</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-dim">
              包含 index.html、memories.json、Markdown 副本、原始媒体、manifest 与 SHA256SUMS。
              生成的包会先在本机完成哈希校验。
            </p>
          </div>
          <Button
            variant="primary"
            icon={<IconArchive size={15} />}
            loading={building}
            onClick={() => void onBuild()}
            disabled={current.memoryCount === 0}
          >
            {building ? '正在打包…' : '生成离线包'}
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-cyan/20 bg-cyan/[0.04] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[13px] text-ink">
                <IconShield size={14} className="text-cyan" />
                已生成并计算 {built.files.length} 个文件的 SHA-256
              </p>
              <p className="num mt-1 text-[11px] text-dim">
                {built.summary.memoryCount} 条记录 · {built.summary.attachmentCount} 个附件 ·{' '}
                {formatBytes(built.summary.totalBytes)} 原始媒体
              </p>
              {savedAs && <p className="mt-1.5 text-[11px] text-cyan/90">已保存：{savedAs}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="quiet" size="sm" icon={<IconRefresh size={13} />} onClick={() => void onBuild()} loading={building}>
                重新生成
              </Button>
              <Button variant="primary" size="sm" icon={<IconDownload size={14} />} loading={saving} onClick={() => void onSave()}>
                {saving ? `保存中 ${Math.round(progress * 100)}%` : '保存 ZIP'}
              </Button>
            </div>
          </div>
          {saving && (
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="导出进度">
              <div
                className="h-full rounded-full bg-cyan/70 transition-[width] duration-200"
                style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }}
              />
            </div>
          )}
          <ul className="mt-3 grid gap-1 text-[10.5px] text-dim sm:grid-cols-2">
            <li>· index.html 为自包含离线页，双击即可浏览</li>
            <li>· 资源使用相对路径，不依赖网络与 CDN</li>
            <li>· memories.json / memories/*.md 可迁移</li>
            <li>· SHA256SUMS.txt 可离线校验收据</li>
          </ul>
        </div>
      )}

      <div className="space-y-1.5 text-[10.5px] leading-relaxed text-dim/80">
        <p>ZIP 默认不加密。请至少保存两份独立备份，并定期检查能否打开；任何单块硬盘都不是长期保存方案。</p>
        <p>
          解压后可运行 <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px] text-mist">node scripts/verify-export.mjs &lt;目录或zip&gt; --strict</code>{' '}
          校验完整性；任意一个文件被篡改都会失败。
        </p>
        <p>导出永远不会包含对方仅自己可见的记录；共同记录双方都可以各自导出。</p>
      </div>
    </div>
  );
}
