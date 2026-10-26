import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, screenshot, signInAs } from './helpers';

test.describe('mobile experience', () => {
  test('bottom navigation, touch flows and responsive layout', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/login');
    await expectNoHorizontalOverflow(page);
    // Regression: the login panel used to be centred in an auto-sized grid
    // column and got clipped by the root `overflow-hidden` at 375px.
    const panel = page.locator('main .glass').first();
    const panelBox = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(panelBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
    await screenshot(page, 'evidence-login-mobile', false);

    await signInAs(page, '江照');
    await expect(page.locator('nav[aria-label="底部导航"]')).toBeVisible();
    await expect(page.locator('aside')).toBeHidden();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'evidence-home-mobile');

    const bottomNav = page.locator('nav[aria-label="底部导航"]');
    await bottomNav.getByRole('link', { name: '回忆' }).click();
    await expect(page).toHaveURL(/\/app\/timeline/);
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'evidence-timeline-mobile', false);

    await page.locator('a[href^="/app/memories/"]').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await screenshot(page, 'evidence-memory-detail-mobile', false);
    await page.getByRole('link', { name: '时光长廊' }).click();

    await bottomNav.getByRole('link', { name: '星空' }).click();
    await expect(page.locator('canvas').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'evidence-stars-mobile', false);

    await bottomNav.getByRole('link', { name: '博物馆' }).click();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'evidence-gallery-mobile', false);

    await bottomNav.getByRole('link', { name: '我的' }).click();
    await expect(page).toHaveURL(/\/app\/settings/);
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'evidence-settings-mobile', false);

    // Capsules and the assistant remain reachable from the compact header.
    const header = page.locator('header').first();
    await header.getByRole('link', { name: '时间胶囊' }).click();
    await expect(page).toHaveURL(/\/app\/capsules/);
    await header.getByRole('link', { name: '记忆助手' }).click();
    await expect(page).toHaveURL(/\/app\/ask/);
  });
});
