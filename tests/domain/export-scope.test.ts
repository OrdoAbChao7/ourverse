import { describe, expect, it } from 'vitest';
import {
  estimateExportBytes,
  selectExportMemories,
  summarizeExport,
  EXPORT_SCOPES,
} from '@/domain/export/scope';
import type { Viewer } from '@/domain/permissions';
import { attachment, memory } from '../helpers/fixtures';

const viewerA: Viewer = { userId: 'user-a', isMemberOfSpace: true };
const viewerB: Viewer = { userId: 'user-b', isMemberOfSpace: true };
const outsider: Viewer = { userId: 'user-c', isMemberOfSpace: false };

const memories = [
  memory({ id: 'shared-a', authorId: 'user-a', visibility: 'shared', attachments: [attachment({ id: 'att-1', byteSize: 100 })] }),
  memory({ id: 'shared-b', authorId: 'user-b', visibility: 'shared', attachments: [attachment({ id: 'att-2', byteSize: 200 })] }),
  memory({ id: 'private-a', authorId: 'user-a', visibility: 'private', attachments: [attachment({ id: 'att-3', byteSize: 300 })] }),
  memory({ id: 'private-b', authorId: 'user-b', visibility: 'private' }),
  memory({ id: 'deleted', authorId: 'user-a', visibility: 'shared', deletedAt: '2025-01-01T00:00:00.000Z' }),
];

describe('selectExportMemories', () => {
  it('never exports the other person’s private memories in any scope', () => {
    for (const scope of EXPORT_SCOPES) {
      const selected = selectExportMemories(viewerA, memories, scope).map((item) => item.id);
      expect(selected).not.toContain('private-b');
      expect(selectExportMemories(viewerB, memories, scope).map((item) => item.id)).not.toContain('private-a');
    }
  });

  it('mine exports only the viewer’s own records (shared and private)', () => {
    expect(selectExportMemories(viewerA, memories, 'mine').map((item) => item.id).sort()).toEqual([
      'private-a',
      'shared-a',
    ]);
  });

  it('shared exports shared records from both people', () => {
    expect(selectExportMemories(viewerA, memories, 'shared').map((item) => item.id).sort()).toEqual([
      'shared-a',
      'shared-b',
    ]);
  });

  it('all exports everything visible, excluding deleted rows', () => {
    expect(selectExportMemories(viewerA, memories, 'all').map((item) => item.id).sort()).toEqual([
      'private-a',
      'shared-a',
      'shared-b',
    ]);
  });

  it('returns nothing to an outsider or anonymous viewer', () => {
    for (const scope of EXPORT_SCOPES) {
      expect(selectExportMemories(outsider, memories, scope)).toEqual([]);
      expect(selectExportMemories({ userId: null, isMemberOfSpace: true }, memories, scope)).toEqual([]);
    }
  });
});

describe('export estimates', () => {
  it('counts attachments and bytes for the selected scope', () => {
    const selected = selectExportMemories(viewerA, memories, 'all');
    const summary = summarizeExport(selected);
    expect(summary).toEqual({ memoryCount: 3, attachmentCount: 3, totalBytes: 600 });
    expect(estimateExportBytes(summary)).toBeGreaterThan(600);
  });
});
