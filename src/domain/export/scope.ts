import { canViewMemory, type Viewer } from '../permissions';
import type { MemoryWithAuthor } from '../types';

/**
 * Export scopes. The private content of the *other* person can never be
 * selected, no matter which scope is chosen — that rule is enforced twice:
 * here and again by the Supabase RLS SELECT policy.
 */
export const EXPORT_SCOPES = ['mine', 'shared', 'all'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export const EXPORT_SCOPE_LABELS: Record<ExportScope, { title: string; description: string }> = {
  mine: {
    title: '只导出自我的记录',
    description: '包含你写的所有记录（共同可见 + 仅自己可见），不含对方的任何内容。',
  },
  shared: {
    title: '只导出共同记录',
    description: '双方可见的记录，以及在其中的照片、声音和影像。',
  },
  all: {
    title: '导出我能访问的全部',
    description: '共同记录 + 你自己的私密记录。永远不会包含对方仅自己可见的内容。',
  },
};

export function selectExportMemories<T extends Pick<MemoryWithAuthor, 'visibility' | 'authorId' | 'deletedAt'>>(
  viewer: Viewer,
  memories: T[],
  scope: ExportScope,
): T[] {
  if (!viewer.userId || !viewer.isMemberOfSpace) return [];
  const visible = memories.filter((memory) => canViewMemory(viewer, memory));
  switch (scope) {
    case 'mine':
      return visible.filter((memory) => memory.authorId === viewer.userId);
    case 'shared':
      return visible.filter((memory) => memory.visibility === 'shared');
    case 'all':
      return visible;
    default:
      return [];
  }
}

export interface ExportSummary {
  memoryCount: number;
  attachmentCount: number;
  totalBytes: number;
}

export function summarizeExport(
  memories: { attachments: { byteSize: number }[] }[],
): ExportSummary {
  let attachmentCount = 0;
  let totalBytes = 0;
  for (const memory of memories) {
    attachmentCount += memory.attachments.length;
    for (const attachment of memory.attachments) totalBytes += attachment.byteSize;
  }
  return { memoryCount: memories.length, attachmentCount, totalBytes };
}

/** Estimated ZIP size: media is stored (not deflated) + small text overhead. */
export function estimateExportBytes(summary: ExportSummary): number {
  const textOverhead = summary.memoryCount * 2_400 + 40_000;
  return Math.round(summary.totalBytes * 0.999 + textOverhead);
}
