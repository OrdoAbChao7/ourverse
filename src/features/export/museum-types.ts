import type { ExportScope, ExportSummary } from '@/domain/export/scope';
import type { Viewer } from '@/domain/permissions';
import type { Repository } from '@/data/repository';

export interface MuseumAttachment {
  id: string;
  /** Path inside the package, always relative (for example `assets/0001-sea.jpg`). */
  path: string;
  /** Original display name, kept verbatim for download labels. */
  fileName: string;
  mimeType: string;
  kind: 'image' | 'video' | 'audio';
  byteSize: number;
  sha256: string | null;
}

export interface MuseumMemory {
  id: string;
  title: string;
  bodyMd: string;
  occurredOn: string;
  occurredTime: string | null;
  occurredAt: string;
  visibility: 'shared' | 'private';
  locationLabel: string | null;
  tags: string[];
  authorName: string;
  attachments: MuseumAttachment[];
}

export interface MuseumCounts {
  memories: number;
  attachments: number;
  anniversaries: number;
  /** Total bytes of the media files that are actually inside the package. */
  bytes: number;
}

export interface MuseumMeta {
  formatVersion: 1;
  app: 'OURVERSE';
  appVersion: string;
  generatedAt: string;
  demo: boolean;
  scope: 'mine' | 'shared' | 'all';
  space: { name: string; motto: string } | null;
  members: string[];
  viewerName: string;
  memories: MuseumMemory[];
  anniversaries: { name: string; date: string; repeat: 'yearly' | 'once'; note: string | null }[];
  counts: MuseumCounts;
}

export interface MuseumManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

export interface MuseumManifest {
  formatVersion: 1;
  app: 'OURVERSE';
  appVersion: string;
  generatedAt: string;
  scope: string;
  demo: boolean;
  counts: MuseumCounts;
  /**
   * Covers every file in the package except `manifest.json` (which cannot
   * contain its own hash) and `SHA256SUMS.txt` (which covers the manifest).
   */
  files: MuseumManifestFile[];
}

export interface MuseumFile {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  sha256: string;
}

export interface BuiltMuseum {
  files: MuseumFile[];
  meta: MuseumMeta;
  manifest: MuseumManifest;
  /** Full text of `SHA256SUMS.txt`, sorted by path, newline-terminated. */
  sha256Sums: string;
  summary: ExportSummary;
}

export interface BuildMuseumInput {
  repo: Repository;
  viewer: Viewer;
  scope: ExportScope;
  now: Date;
  appVersion?: string;
}

export type MuseumBuildErrorCode =
  | 'not-member'
  | 'hashing-unavailable'
  | 'attachment-unreadable'
  | 'invalid-input';

/** Typed failure so the UI can explain exactly why an export was refused. */
export class MuseumBuildError extends Error {
  readonly code: MuseumBuildErrorCode;

  constructor(code: MuseumBuildErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MuseumBuildError';
    this.code = code;
  }
}
