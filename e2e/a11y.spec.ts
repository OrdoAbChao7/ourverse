import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoApp, signInAs } from './helpers';

test.describe('accessibility', () => {
  test('core pages have no WCAG 2.1 A/AA violations', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, '林雾');
    for (const route of ['/app', '/app/timeline', '/app/stars', '/app/gallery', '/app/capsules', '/app/ask', '/app/settings']) {
      await gotoApp(page, route);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations, `${route} accessibility violations`).toEqual([]);
    }
  });

  test('login page and dialogs are accessible too', async ({ page }) => {
    await page.goto('/login');
    const login = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(login.violations).toEqual([]);

    await signInAs(page, '林雾');
    await gotoApp(page, '/app/capsules');
    await page.getByRole('button', { name: '写一封信' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Let the entrance transition finish so axe measures the settled colours.
    await page.waitForTimeout(500);
    const dialog = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(dialog.violations).toEqual([]);
  });
});
