import { expect, test } from '@playwright/test';
import { gotoApp, screenshot, signInAs } from './helpers';

test.describe('time capsules', () => {
  test('sealed capsules refuse early access, even if the device clock jumps forward', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/capsules');
    const locked = page.locator('article').filter({ hasText: '搬家之前不要打开' });
    await expect(locked).toContainText('密封中');
    await expect(locked.getByRole('button', { name: '开启胶囊' })).toHaveCount(0);
    const before = await locked.innerText();
    await screenshot(page, 'e2e-capsules-desktop');

    await page.clock.setSystemTime(new Date(Date.now() + 365 * 86_400_000));
    await page.locator('aside').getByRole('link', { name: '首页' }).click();
    await page.locator('aside').getByRole('link', { name: '时间胶囊' }).click();

    const stillLocked = page.locator('article').filter({ hasText: '搬家之前不要打开' });
    await expect(stillLocked).toContainText('密封中');
    await expect(stillLocked.getByRole('button', { name: '开启胶囊' })).toHaveCount(0);
    const after = await stillLocked.innerText();
    // The countdown is driven by the authoritative monotonic clock, so it must
    // not collapse after moving the wall clock forward.
    const daysBefore = before.match(/(\d+)\s*天后/)?.[1];
    const daysAfter = after.match(/(\d+)\s*天后/)?.[1];
    expect(daysAfter).toBe(daysBefore);
  });

  test('an already-open capsule reveals its sealed body only when opened', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/capsules');
    const open = page.locator('article').filter({ hasText: '给半年后的我们' });
    await expect(open).toContainText('已开启');
    await open.getByRole('button', { name: '开启胶囊' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('写这封信的时候，窗外刚下过雨。');
    await expect(dialog).toContainText('已解锁');
    await dialog.getByRole('button', { name: '收好这封信' }).click();
  });

  test('creates a future capsule with a real persisted schedule', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/capsules');
    await page.getByRole('button', { name: '写一封信' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#capsule-title').fill('E2E 未来胶囊');
    await dialog.locator('#capsule-body').fill('这封信要等到未来才能打开。');
    await dialog.locator('#capsule-opens').fill('2030-01-01T10:00');
    await dialog.getByRole('button', { name: '密封这颗胶囊' }).click();
    await expect(page.getByText('胶囊已经密封')).toBeVisible();

    const card = page.locator('article').filter({ hasText: 'E2E 未来胶囊' });
    await expect(card).toContainText('密封中');
    await expect(card.getByRole('button', { name: '开启胶囊' })).toHaveCount(0);
  });
});
