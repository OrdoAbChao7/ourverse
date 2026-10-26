import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end acceptance against a REAL Supabase stack (local Docker).
 *
 * Run:
 *   VITE_BACKEND=supabase VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npx vite --port 5174
 *   E2E_SUPABASE_APP_URL=http://localhost:5174 npx playwright test e2e/supabase-local.spec.ts
 *
 * It is skipped in the default demo run, where no cloud/local Supabase is required.
 */
const APP_URL = process.env.E2E_SUPABASE_APP_URL;
const PASSWORD = 'Ourverse-Test-2026!';

async function signUp(page: Page, email: string, name: string) {
  await page.goto(`${APP_URL}/login`);
  await page.getByRole('button', { name: '第一次来？创建账号后使用邀请加入' }).click();
  await page.locator('#login-email').fill(email);
  await page.locator('#login-name').fill(name);
  await page.locator('#login-password').fill(PASSWORD);
  await page.getByRole('button', { name: '创建账号' }).click();
  await page.waitForURL(/\/app/, { timeout: 40_000 });
}

test.describe('real Supabase backend acceptance', () => {
  test.skip(!APP_URL, 'Set E2E_SUPABASE_APP_URL to run against a real Supabase app server.');

  test('A creates a space, B accepts a one-time invite, both see shared but not private', async ({ browser }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const emailA = `e2e-a-${stamp}@example.com`;
    const emailB = `e2e-b-${stamp}@example.com`;
    const emailC = `e2e-c-${stamp}@example.com`;

    const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const a = await contextA.newPage();
    await signUp(a, emailA, '真实甲');
    await expect(a.getByRole('heading', { name: /这里还没有你的星球/ })).toBeVisible();
    await a.locator('#space-name').fill('真实后端测试空间');
    await a.getByRole('button', { name: '建立这颗星球' }).click();
    await expect(a.getByText('今日想写一句话')).toBeVisible({ timeout: 30_000 });

    await a.goto(`${APP_URL}/app/settings`);
    await expect(a.locator('section#about').getByText('supabase', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: '生成邀请链接' }).click();
    const inviteUrl = (await a.locator('#members code').textContent())?.trim();
    expect(inviteUrl).toBeTruthy();
    expect(inviteUrl).toContain('invite=');

    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const b = await contextB.newPage();
    await b.goto(inviteUrl!);
    await expect(b.getByText('邀请你加入「真实后端测试空间」')).toBeVisible();
    await b.getByRole('button', { name: '第一次来？创建账号后使用邀请加入' }).click();
    await b.locator('#login-email').fill(emailB);
    await b.locator('#login-name').fill('真实乙');
    await b.locator('#login-password').fill(PASSWORD);
    await b.getByRole('button', { name: '创建账号' }).click();
    await b.waitForURL(/\/app/, { timeout: 40_000 });
    await expect(b.getByText('今日想写一句话')).toBeVisible({ timeout: 30_000 });

    // A writes a shared record; B can see it.
    await a.goto(`${APP_URL}/app/memories/new`);
    await a.locator('#memory-title').fill('A 的真实后端共享记录');
    await a.locator('textarea[aria-label="正文"]').fill('这条记录来自真实 Postgres 与 RLS。');
    await a.getByRole('button', { name: '保存这一刻' }).first().click();
    await a.waitForURL(/\/app\/memories\/(?!new)/, { timeout: 30_000 });
    await b.goto(`${APP_URL}/app/timeline`);
    await expect(b.getByText('A 的真实后端共享记录').first()).toBeVisible({ timeout: 20_000 });

    // B writes a shared record; A can see it (independent login, same space).
    await b.goto(`${APP_URL}/app/memories/new`);
    await b.locator('#memory-title').fill('B 的真实后端共享记录');
    await b.getByRole('button', { name: '保存这一刻' }).first().click();
    await b.waitForURL(/\/app\/memories\/(?!new)/, { timeout: 30_000 });
    await a.goto(`${APP_URL}/app/timeline`);
    await expect(a.getByText('B 的真实后端共享记录').first()).toBeVisible({ timeout: 20_000 });

    // A writes a private record; B cannot see it even with the direct URL.
    await a.goto(`${APP_URL}/app/memories/new`);
    await a.locator('#memory-title').fill('A 的真实后端私密记录');
    await a.getByRole('radio', { name: /仅自己/ }).click();
    await a.getByRole('button', { name: '保存这一刻' }).first().click();
    await a.waitForURL(/\/app\/memories\/(?!new)/, { timeout: 30_000 });
    const privateUrl = a.url();
    await b.goto(`${APP_URL}/app/timeline`);
    await expect(b.getByText('A 的真实后端私密记录')).toHaveCount(0);
    await b.goto(privateUrl);
    await expect(b.getByText('这条记忆打不开')).toBeVisible();

    // The invite is single-use: a third account cannot join with it.
    const contextC = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const c = await contextC.newPage();
    await c.goto(inviteUrl!);
    await expect(c.getByText(/邀请已被使用|空间已满员/)).toBeVisible();
    await signUp(c, emailC, '真实丙');
    await expect(c.getByRole('heading', { name: /这里还没有你的星球/ })).toBeVisible();

    await a.screenshot({ path: 'artifacts/screenshots/e2e-supabase-real-home.png', fullPage: true });
    await contextA.close();
    await contextB.close();
    await contextC.close();
  });
});
