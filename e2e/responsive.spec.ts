import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoApp, screenshot, signInAs } from './helpers';

test.describe('visual consistency and reduced motion', () => {
  test('desktop screens have no horizontal overflow and are captured as evidence', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/login');
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'evidence-login-1440', false);

    await signInAs(page, '林雾');
    for (const [name, route] of [
      ['home', '/app'],
      ['timeline', '/app/timeline'],
      ['stars', '/app/stars'],
      ['gallery', '/app/gallery'],
      ['capsules', '/app/capsules'],
      ['ask', '/app/ask'],
      ['settings', '/app/settings'],
    ] as const) {
      await gotoApp(page, route);
      await expectNoHorizontalOverflow(page);
      await screenshot(page, `evidence-${name}-1440`, false);
    }
  });

  test('prefers-reduced-motion stops the continuous star animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAs(page, '林雾');
    await gotoApp(page, '/app/stars');
    expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(400);
    const first = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    await page.waitForTimeout(500);
    const second = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    expect(second).toBe(first);
    await screenshot(page, 'evidence-stars-reduced-motion-1440', false);

    // The core task is still available as a plain list.
    await page.getByRole('radio', { name: '列表' }).click();
    await expect(page.locator('a[href^="/app/memories/"]').first()).toBeVisible();
  });
});
