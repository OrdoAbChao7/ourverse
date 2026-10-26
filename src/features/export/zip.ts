import { zipSync, type ZipOptions, type Zippable } from 'fflate';
import type { BuiltMuseum, MuseumFile } from './museum-types';

/** Media already has its own compression; text is deflated. */
export function isMediaFile(file: Pick<MuseumFile, 'mimeType'>): boolean {
  return /^(image|video|audio)\//i.test(file.mimeType);
}

export function estimateMuseumZipBytes(files: Pick<MuseumFile, 'bytes'>[]): number {
  return files.reduce((total, file) => total + file.bytes.byteLength, 0);
}

/** Builds the fflate entry table with the package's per-file compression policy. */
export function buildZipEntries(museum: Pick<BuiltMuseum, 'files'>): Zippable {
  const entries: Zippable = {};
  for (const file of museum.files) {
    const options: ZipOptions = isMediaFile(file) ? { level: 0 } : { level: 6 };
    entries[file.path] = [file.bytes, options];
  }
  return entries;
}

/**
 * In-memory ZIP used by the download fallback, verification scripts, and
 * tests. Streaming exports bypass this and write directly to disk.
 */
export async function createMuseumZip(museum: BuiltMuseum): Promise<Uint8Array> {
  return zipSync(buildZipEntries(museum));
}
