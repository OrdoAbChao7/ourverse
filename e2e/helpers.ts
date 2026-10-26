import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export async function signInAs(page: Page, displayName: '林雾' | '江照' | '演示访客'): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`以${displayName}的身份进入演示`) }).click();
  await page.waitForURL(/\/app$/, { timeout: 25_000 });
  await expect(page.locator('main#main')).toBeVisible();
}

export async function gotoApp(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

export async function screenshot(page: Page, name: string, fullPage = true): Promise<void> {
  const dir = path.resolve('artifacts/screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage });
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page should not scroll horizontally').toBeLessThanOrEqual(clientWidth + 1);
}

export async function createMemoryViaForm(
  page: Page,
  options: {
    title: string;
    body?: string;
    date?: string;
    location?: string;
    tags?: string[];
    visibility?: 'shared' | 'private';
    filePath?: string;
  },
): Promise<void> {
  await gotoApp(page, '/app/memories/new');
  await page.locator('#memory-title').fill(options.title);
  if (options.date) await page.locator('#memory-date').fill(options.date);
  if (options.body) await page.locator('textarea[aria-label="正文"]').fill(options.body);
  if (options.location) await page.locator('#memory-location').fill(options.location);
  for (const tag of options.tags ?? []) {
    const input = page.getByRole('textbox', { name: '添加标签' });
    await input.fill(tag);
    await input.press('Enter');
  }
  if (options.visibility === 'private') {
    await page.getByRole('radio', { name: /仅自己/ }).click();
  }
  if (options.filePath) {
    await page.locator('input[type="file"]').setInputFiles(options.filePath);
    await expect(page.getByText('待保存')).toBeVisible();
  }
  await page.getByRole('button', { name: '保存这一刻' }).first().click();
  await page.waitForURL(/\/app\/memories\/(?!new)/, { timeout: 20_000 });
}

export async function getTodayInShanghai(): Promise<string> {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
