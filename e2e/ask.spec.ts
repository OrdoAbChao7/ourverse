import { expect, test, type Page } from '@playwright/test';
import { gotoApp, screenshot, signInAs } from './helpers';

async function ask(page: Page, question: string) {
  await page.getByRole('textbox', { name: '向记忆助手提问' }).fill(question);
  await page.getByRole('button', { name: '询问' }).click();
}

test.describe('memory assistant', () => {
  test('answers from records with a clickable citation', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/ask');
    await expect(page.getByText('仅检索模式')).toBeVisible();

    await ask(page, '我们第一次看海是什么时候？');
    const answer = page.locator('article').filter({ hasText: '海边的第一场日落' });
    await expect(answer).toBeVisible();
    await expect(answer).toContainText('[1]');
    await screenshot(page, 'e2e-ask-answer-desktop');

    const source = page.locator('ol a[href^="/app/memories/"]').first();
    await expect(source).toContainText('海边的第一场日落');
    await source.click();
    await expect(page.getByRole('heading', { level: 1, name: '海边的第一场日落' })).toBeVisible();
  });

  test('refuses to invent an answer when no record supports it', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/ask');
    await ask(page, '我们养过什么宠物？');
    await expect(page.getByText('暂无足够记录来回答这个问题。', { exact: false })).toBeVisible();
    await expect(page.getByText('来源 · 点击直达记录')).toHaveCount(0);
    await expect(page.getByText('暂无证据')).toBeVisible();
  });

  test('counts only the records the viewer may access', async ({ page }) => {
    await signInAs(page, '江照');
    await gotoApp(page, '/app/ask');
    await ask(page, '我们一共有多少条记忆？');
    await expect(page.locator('article')).toContainText('12 条');
  });

  test('AI stays disabled by default and explains exactly what enabling sends', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/ask');
    const toggle = page.getByRole('switch', { name: '启用模型增强回答' });
    await expect(toggle).not.toBeChecked();
    await toggle.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('最多 5 条');
    await expect(dialog).toContainText('不会发送：照片');
    await expect(dialog).toContainText('模型密钥');
    await dialog.getByRole('button', { name: '我已了解并启用' }).click();

    await expect(page.getByText('演示后端没有连接模型服务', { exact: false })).toBeVisible();
    await expect(toggle).toBeChecked();
  });

  test('filters a date question to that month and brings sources', async ({ page }) => {
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/ask');
    // The seed is relative to "today"; use the month of the most recent seed
    // memory (12 days ago) so the question stays valid whenever the suite runs.
    const recent = new Date(Date.now() - 12 * 86_400_000);
    const [year, month] = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
    })
      .format(recent)
      .split('-');
    await ask(page, `${year}年${Number(month)}月有什么记录？`);
    const answer = page.locator('article');
    await expect(answer).toContainText('来源');
    const sourceTexts = await page.locator('ol a[href^="/app/memories/"]').allTextContents();
    expect(sourceTexts.length).toBeGreaterThan(0);
    for (const text of sourceTexts) {
      expect(text).toContain(`${year}年${Number(month)}月`);
    }
  });
});
