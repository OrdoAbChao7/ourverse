import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = 'artifacts/screenshots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

async function captureDesktop() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[desktop] ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`[desktop pageerror] ${error.message}`));

  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/login-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: /以林雾的身份进入演示/ }).click();
  await page.waitForURL('**/app', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/home-desktop.png`, fullPage: true });

  const pages = [
    ['timeline', '/app/timeline'],
    ['memory-detail', null],
    ['memory-new', '/app/memories/new'],
    ['stars', '/app/stars'],
    ['gallery', '/app/gallery'],
    ['capsules', '/app/capsules'],
    ['ask', '/app/ask'],
    ['settings', '/app/settings'],
  ];

  for (const [name, path] of pages) {
    if (name === 'memory-detail') {
      await page.goto('http://localhost:5173/app/timeline', { waitUntil: 'networkidle' });
      const first = page.locator('a[href^="/app/memories/"]').first();
      if (await first.count()) {
        await first.click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${OUT}/memory-detail-desktop.png`, fullPage: true });
      }
      continue;
    }
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true });
  }

  await context.close();
}

async function captureMobile() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[mobile] ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`[mobile pageerror] ${error.message}`));

  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/login-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: /以江照的身份进入演示/ }).click();
  await page.waitForURL('**/app', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/home-mobile.png`, fullPage: true });

  for (const [name, path] of [
    ['timeline', '/app/timeline'],
    ['stars', '/app/stars'],
    ['capsules', '/app/capsules'],
    ['settings', '/app/settings'],
  ]) {
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${name}-mobile.png`, fullPage: true });
  }
  await context.close();
}

await captureDesktop();
await captureMobile();
await browser.close();
console.log('console errors:', errors.length);
for (const error of errors) console.log(error);
