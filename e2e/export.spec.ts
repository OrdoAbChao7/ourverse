import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { gotoApp, screenshot, signInAs } from './helpers';

interface ExportedMemory {
  id: string;
  title: string;
  attachments: { path: string; kind: string }[];
}

const EXPORT_DIR = path.resolve('artifacts/exports');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test.describe('offline digital museum', () => {
  test('exports, verifies and opens with no network at all', async ({ page, browser }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    });

    await signInAs(page, '林雾');
    await gotoApp(page, '/app/settings');
    const section = page.locator('#export');
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('button', { name: '生成离线包' }).click();
    await expect(section.getByText(/已生成并计算/)).toBeVisible({ timeout: 60_000 });
    await screenshot(page, 'e2e-export-ready-desktop');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      section.getByRole('button', { name: '保存 ZIP' }).click(),
    ]);
    mkdirSync(EXPORT_DIR, { recursive: true });
    const zipPath = path.join(EXPORT_DIR, 'e2e-museum.zip');
    await download.saveAs(zipPath);
    expect(download.suggestedFilename()).toMatch(/^ourverse-museum-\d{8}-\d{4}-all\.zip$/);

    const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const paths = Object.keys(entries);
    const required = ['index.html', 'memories.json', 'meta.json', 'manifest.json', 'SHA256SUMS.txt', 'README.txt'];
    for (const file of required) expect(paths, `missing ${file}`).toContain(file);
    expect(paths.some((file) => file.startsWith('assets/'))).toBe(true);
    expect(paths.filter((file) => file.startsWith('memories/') && file.endsWith('.md'))).toHaveLength(12);

    const memoryBytes = entries['memories.json'];
    expect(memoryBytes).toBeDefined();
    const parsed = JSON.parse(strFromU8(memoryBytes!)) as { memories: ExportedMemory[] };
    expect(parsed.memories).toHaveLength(12);
    const attachmentCount = parsed.memories.reduce((sum, memory) => sum + memory.attachments.length, 0);
    expect(attachmentCount).toBe(6);
    for (const memory of parsed.memories) {
      for (const attachment of memory.attachments) {
        expect(entries[attachment.path], `asset ${attachment.path}`).toBeDefined();
      }
    }

    const indexHtml = strFromU8(entries['index.html']!);
    expect(indexHtml).not.toMatch(/https?:\/\//);
    expect(indexHtml).not.toContain('fetch(');
    expect(indexHtml).not.toContain('type="module"');
    expect(indexHtml).toContain('OURVERSE');
    expect(indexHtml).toContain('海边的第一场日落');

    const sums = strFromU8(entries['SHA256SUMS.txt']!);
    const listed = new Set<string>();
    for (const line of sums.split('\n').filter(Boolean)) {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      expect(match, `bad checksum line: ${line}`).not.toBeNull();
      const [, hash, file] = match!;
      listed.add(file!);
      expect(sha256(entries[file!]!), `hash mismatch for ${file}`).toBe(hash);
    }
    for (const file of paths) {
      if (file !== 'SHA256SUMS.txt') expect(listed, `${file} not in checksums`).toContain(file);
    }

    const extractDir = path.join(EXPORT_DIR, 'e2e-extracted');
    rmSync(extractDir, { recursive: true, force: true });
    for (const [file, bytes] of Object.entries(entries)) {
      const target = path.join(extractDir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }

    const verifyOutput = execFileSync(process.execPath, ['scripts/verify-export.mjs', extractDir, '--strict'], {
      encoding: 'utf8',
    });
    expect(verifyOutput).toContain('校验通过');

    const tamperedDir = path.join(EXPORT_DIR, 'e2e-tampered');
    rmSync(tamperedDir, { recursive: true, force: true });
    cpSync(extractDir, tamperedDir, { recursive: true });
    const mdPath = paths.find((file) => file.startsWith('memories/') && file.endsWith('.md'))!;
    writeFileSync(path.join(tamperedDir, mdPath), `${readFileSync(path.join(tamperedDir, mdPath), 'utf8')}\n被篡改`, 'utf8');
    let tamperFailed = false;
    try {
      execFileSync(process.execPath, ['scripts/verify-export.mjs', tamperedDir], { encoding: 'utf8' });
    } catch (error) {
      tamperFailed = (error as { status?: number }).status === 1;
    }
    expect(tamperFailed, 'tampered package must fail verification').toBe(true);
    rmSync(tamperedDir, { recursive: true, force: true });

    const offlineContext = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 } });
    const offlinePage = await offlineContext.newPage();
    const remoteRequests: string[] = [];
    const pageErrors: string[] = [];
    offlinePage.on('request', (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
    });
    offlinePage.on('pageerror', (error) => pageErrors.push(error.message));

    await offlinePage.goto(pathToFileURL(path.join(extractDir, 'index.html')).href);
    await expect(offlinePage.locator('#space-name')).toBeVisible();
    await expect(offlinePage.locator('.memory-card')).toHaveCount(12);

    const photo = offlinePage.locator('#photo-grid img').first();
    await expect(photo).toBeVisible();
    await expect.poll(async () => photo.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await offlinePage.waitForFunction(() => {
      const audio = document.querySelector<HTMLAudioElement>('#audio-list audio');
      return Boolean(audio && audio.readyState >= 1 && audio.duration > 0);
    });
    const duration = await offlinePage.locator('#audio-list audio').first().evaluate((element) => (element as HTMLAudioElement).duration);
    expect(duration).toBeGreaterThan(1);

    await offlinePage.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('#video-grid video');
      return Boolean(video && video.readyState >= 1);
    });
    const videoWidth = await offlinePage.locator('#video-grid video').first().evaluate((element) => (element as HTMLVideoElement).videoWidth);
    expect(videoWidth).toBe(1280);

    await offlinePage.locator('#search').fill('海边');
    await expect(offlinePage.locator('.memory-card').first()).toContainText('海边');
    await offlinePage.locator('#chips [data-filter="photos"]').click();
    expect(await offlinePage.locator('.memory-card').count()).toBeGreaterThan(0);
    await offlinePage.locator('#chips [data-filter="all"]').click();
    await offlinePage.locator('.memory-card').first().click();
    await expect(offlinePage.locator('#detail-sheet')).toBeVisible();
    await offlinePage.locator('#detail-close').click();

    expect(remoteRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    await screenshot(offlinePage, 'e2e-offline-museum-desktop');
    await offlineContext.close();
  });
});
