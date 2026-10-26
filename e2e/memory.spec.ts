import { expect, test } from '@playwright/test';
import { createMemoryViaForm, expectNoHorizontalOverflow, gotoApp, screenshot, signInAs } from './helpers';

test.describe('memory lifecycle', () => {
  test('creates a memory with media and surfaces it in detail, timeline, stars and gallery', async ({ page }) => {
    await signInAs(page, '林雾');
    await createMemoryViaForm(page, {
      title: 'E2E 海边记忆',
      body: '**风很大**，我们走了很久。\n\n- 第一件事\n- 第二件事',
      date: '2025-06-01',
      location: '青岛 · 金沙滩',
      tags: ['E2E', '海'],
      filePath: 'src/assets/demo/sea-sunset.jpg',
    });

    await expect(page.getByRole('heading', { level: 1, name: 'E2E 海边记忆' })).toBeVisible();
    await expect(page.getByText('2025年6月1日').first()).toBeVisible();
    await expect(page.getByText('青岛 · 金沙滩')).toBeVisible();
    await expect(page.getByText('#E2E', { exact: true })).toBeVisible();
    await expect(page.locator('strong')).toContainText('风很大');

    const image = page.locator('img[alt="sea-sunset.jpg"]').first();
    await expect(image).toBeVisible();
    await expect
      .poll(async () => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载 sea-sunset.jpg' }).first().click(),
    ]);
    expect(download.suggestedFilename()).toBe('sea-sunset.jpg');

    const detailUrl = page.url();
    await screenshot(page, 'e2e-memory-detail-desktop');

    await gotoApp(page, '/app/timeline');
    await page.getByRole('textbox', { name: '搜索记忆' }).fill('E2E 海边记忆');
    await expect(page.getByText('E2E 海边记忆').first()).toBeVisible();
    await expect(page.getByText('找到')).toBeVisible();
    await screenshot(page, 'e2e-timeline-search-desktop');

    await gotoApp(page, '/app/stars');
    const star = page.getByRole('button', { name: /E2E 海边记忆/ });
    await expect(star).toBeVisible();
    await star.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('E2E 海边记忆');
    await dialog.getByRole('button', { name: '打开完整记忆' }).click();
    await expect(page).toHaveURL(detailUrl);

    await gotoApp(page, '/app/gallery');
    const photo = page.getByRole('button', { name: '查看照片 E2E 海边记忆' });
    await expect(photo).toBeVisible();
    await photo.click();
    await expect(page.getByRole('dialog')).toContainText('E2E 海边记忆');
    await page.getByRole('button', { name: '关闭' }).click();
  });

  test('edits and deletes a memory, keeping timeline and stars consistent', async ({ page }) => {
    await signInAs(page, '林雾');
    await createMemoryViaForm(page, {
      title: '待编辑的记忆',
      body: '原始正文',
      date: '2025-08-08',
    });
    const detailUrl = page.url();

    await page.getByRole('link', { name: '编辑' }).click();
    const titleField = page.locator('#memory-title');
    await titleField.click();
    await titleField.press('Control+A');
    await titleField.pressSequentially('已经编辑过的记忆');
    await expect(titleField).toHaveValue('已经编辑过的记忆');
    await page.getByRole('button', { name: '保存修改' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: '已经编辑过的记忆' })).toBeVisible();

    await gotoApp(page, '/app/timeline');
    await page.getByRole('textbox', { name: '搜索记忆' }).fill('已经编辑过的记忆');
    await expect(page.getByText('已经编辑过的记忆').first()).toBeVisible();

    await gotoApp(page, detailUrl);
    await page.getByRole('button', { name: '删除这条记忆' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
    await page.waitForURL(/\/app\/timeline/);

    await page.getByRole('textbox', { name: '搜索记忆' }).fill('已经编辑过的记忆');
    await expect(page.getByText('没有找到符合条件的记录')).toBeVisible();

    await gotoApp(page, '/app/stars');
    await expect(page.getByRole('button', { name: /已经编辑过的记忆/ })).toHaveCount(0);
  });

  test('validates an empty title instead of saving invalid data', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/memories/new');
    await page.getByRole('button', { name: '保存这一刻' }).first().click();
    await expect(page.locator('p[role="alert"]').filter({ hasText: '请为这一刻写一个标题' })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/memories\/new/);
  });

  test('quick note on the home screen persists a real memory', async ({ page }) => {
    await signInAs(page, '林雾');
    await page.getByRole('textbox', { name: '随手记内容' }).fill('E2E 随手记：今天的光很好');
    await page.getByRole('button', { name: '记下' }).click();
    await expect(page.getByText('已经收进今天的星光')).toBeVisible();
    await gotoApp(page, '/app/timeline');
    await page.getByRole('textbox', { name: '搜索记忆' }).fill('E2E 随手记：今天的光很好');
    await expect(page.getByText('E2E 随手记：今天的光很好').first()).toBeVisible();
  });

  test('rejects an unsupported file type in the upload picker', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/memories/new');
    await page.locator('#memory-title').fill('非法附件测试');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'not-an-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(page.getByText('附件未添加')).toBeVisible();
    await expect(page.getByText('不支持的文件类型', { exact: false })).toBeVisible();
  });

  test('desktop layout has no horizontal overflow on each core page', async ({ page }) => {
    await signInAs(page, '林雾');
    for (const route of ['/app', '/app/timeline', '/app/stars', '/app/gallery', '/app/capsules', '/app/ask', '/app/settings']) {
      await gotoApp(page, route);
      await expectNoHorizontalOverflow(page);
    }
    await screenshot(page, 'e2e-ask-desktop');
  });
});
