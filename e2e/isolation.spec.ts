import { expect, test } from '@playwright/test';
import { createMemoryViaForm, gotoApp, screenshot, signInAs } from './helpers';

test.describe('two-person isolation across the UI', () => {
  test('B never sees A’s private record through list, detail, gallery, ask or capsules', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const a = await context.newPage();
    await signInAs(a, '林雾');
    await createMemoryViaForm(a, {
      title: 'A的私密角落',
      body: '暗号：紫色潜水艇',
      visibility: 'private',
      filePath: 'src/assets/demo/rain-street.webp',
    });
    const privateUrl = a.url();
    await createMemoryViaForm(a, { title: 'A的共同记忆', body: '可以一起看的部分', visibility: 'shared' });

    const b = await context.newPage();
    await signInAs(b, '江照');
    await gotoApp(b, '/app/timeline');
    await expect(b.getByText('A的共同记忆').first()).toBeVisible();
    await expect(b.getByText('A的私密角落')).toHaveCount(0);
    await screenshot(b, 'e2e-isolation-timeline-b');

    await b.goto(privateUrl);
    await expect(b.getByText('这条记忆打不开')).toBeVisible();
    await expect(b.getByText('对方')).toBeVisible();

    await gotoApp(b, '/app/gallery');
    await expect(b.getByRole('button', { name: '查看照片 A的私密角落' })).toHaveCount(0);

    await gotoApp(b, '/app/ask');
    await b.getByRole('textbox', { name: '向记忆助手提问' }).fill('紫色潜水艇');
    await b.getByRole('button', { name: '询问' }).click();
    const refusal = b.locator('article').filter({ hasText: '暂无足够记录' });
    await expect(refusal).toBeVisible();
    await expect(refusal).not.toContainText('潜水艇');

    await gotoApp(b, '/app/capsules');
    await expect(b.getByText('只写给自己的未来')).toHaveCount(0);
    await expect(b.getByText('搬家之前不要打开')).toBeVisible();

    await a.goto(privateUrl);
    await expect(a.getByRole('heading', { level: 1, name: 'A的私密角落' })).toBeVisible();
    await context.close();
  });

  test('a third demo account without membership cannot read or search any record', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const owner = await context.newPage();
    await signInAs(owner, '林雾');

    const outsider = await context.newPage();
    await signInAs(outsider, '演示访客');
    await expect(outsider.getByRole('heading', { name: /这里还没有你的星球/ })).toBeVisible();
    await gotoApp(outsider, '/app/timeline');
    await expect(outsider.getByRole('heading', { name: /这里还没有你的星球/ })).toBeVisible();
    await expect(outsider.getByText('海边的第一场日落')).toHaveCount(0);

    await outsider.goto('/app/ask');
    await expect(outsider.getByRole('heading', { name: /这里还没有你的星球/ })).toBeVisible();
    await context.close();
  });

  test('both people can independently add shared records and see each other immediately', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const a = await context.newPage();
    await signInAs(a, '林雾');
    await createMemoryViaForm(a, { title: 'A 新写下的共同记忆', body: '给两个人', visibility: 'shared' });

    const b = await context.newPage();
    await signInAs(b, '江照');
    await gotoApp(b, '/app/timeline');
    await expect(b.getByText('A 新写下的共同记忆').first()).toBeVisible();

    await createMemoryViaForm(b, { title: 'B 回应的一段', body: '我也记得', visibility: 'shared' });
    await gotoApp(a, '/app/timeline');
    await expect(a.getByText('B 回应的一段').first()).toBeVisible();
    await context.close();
  });
});
