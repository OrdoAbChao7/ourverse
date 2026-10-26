import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoApp, screenshot, signInAs } from './helpers';

test.describe('authentication and entry', () => {
  test('login screen is neutral, private and labelled as demo', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 2, name: '进入你的星球' })).toBeVisible();
    await expect(page.getByText('演示空间使用虚构身份与虚构记录。')).toBeVisible();
    await expect(page.getByRole('button', { name: /以林雾的身份进入演示/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /以江照的身份进入演示/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /以演示访客的身份进入演示/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'e2e-login-desktop');
  });

  test('fictional identity A enters the seeded space', async ({ page }) => {
    await signInAs(page, '林雾');
    await expect(page.getByRole('heading', { level: 1, name: '把故事留在星光里。' })).toBeVisible();
    await expect(page.getByText('林雾').first()).toBeVisible();
    await expect(page.getByText('DEMO').first()).toBeVisible();
    // A sees 12 of 13 seeded records (B's private row is hidden).
    await expect(page.locator('p.num').first()).toContainText('12');
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'e2e-home-desktop');
  });

  test('third demo account without a space is sent to onboarding and sees no records', async ({ page }) => {
    await signInAs(page, '演示访客');
    await expect(page.getByRole('heading', { name: /这里还没有你的星球/ })).toBeVisible();
    await expect(page.getByText('创建空间')).toBeVisible();
    await expect(page.getByText('接受邀请')).toBeVisible();
    await gotoApp(page, '/app/timeline');
    await expect(page.getByRole('heading', { name: /这里还没有你的星球/ })).toBeVisible();
    await expect(page.getByText('海边的第一场日落')).toHaveCount(0);
  });

  test('unknown routes show a 404 page', async ({ page }) => {
    await page.goto('/this-does-not-exist');
    await expect(page.getByRole('heading', { name: '这片星域还没有被记录' })).toBeVisible();
  });

  test('signing out clears the demo session', async ({ page }) => {
    await signInAs(page, '江照');
    await gotoApp(page, '/app/settings');
    await page.getByRole('button', { name: '退出' }).click();
    await page.waitForURL('**/login');
    await page.goto('/app');
    await page.waitForURL(/\/login/);
  });
});
