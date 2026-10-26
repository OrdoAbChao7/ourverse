import { expect, test } from '@playwright/test';
import { getTodayInShanghai, gotoApp, signInAs } from './helpers';

test.describe('anniversaries', () => {
  test('the home page shows a real, user-defined countdown and it can be edited away', async ({ page }) => {
    await signInAs(page, '林雾');
    await expect(page.getByText('初次见面')).toBeVisible();

    await gotoApp(page, '/app/settings');
    await page.getByRole('button', { name: '添加纪念日' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#ann-name').fill('E2E 纪念日');
    await dialog.locator('#ann-date').fill(await getTodayInShanghai());
    await dialog.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('纪念日已添加')).toBeVisible();

    await gotoApp(page, '/app');
    const card = page.locator('section').filter({ hasText: '下一颗纪念日' });
    await expect(card).toContainText('E2E 纪念日');
    await expect(card).toContainText('就是今天');

    await gotoApp(page, '/app/settings');
    await page.getByRole('button', { name: '删除 E2E 纪念日' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
    await expect(page.getByText('E2E 纪念日')).toHaveCount(0);
  });
});
