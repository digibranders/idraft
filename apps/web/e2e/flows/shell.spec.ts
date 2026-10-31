import { expect, test, type Page } from '@playwright/test';

import { expectAccessible, expectPolicy, signIn, waitForContent, watchPolicy } from '../support';

const PROFILE = '/digibranders/fynix/settings/profile';
const SECURITY = '/digibranders/fynix/settings/security';
const PREFERENCES = '/digibranders/fynix/settings/preferences';

/** The width of an element, rounded. */
const widthOf = async (page: Page, selector: string): Promise<number> =>
  Math.round((await page.locator(selector).first().boundingBox())?.width ?? 0);

test.describe('the application shell', () => {
  test('at 1440 px: the expanded sidebar, which [ collapses to the rail, and the choice stays after a reload', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'priya@digibranders.test');
    await page.goto(PROFILE);
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    expect(await widthOf(page, 'nav[aria-label="Primary"]')).toBe(208);
    await expect(page.getByRole('switch', { name: 'Dark theme' })).toBeVisible();
    await page.getByRole('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('[');
    await expect.poll(() => widthOf(page, 'nav[aria-label="Primary"]')).toBe(56);
    await page.reload();
    expect(await widthOf(page, 'nav[aria-label="Primary"]')).toBe(56);
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect.poll(() => widthOf(page, 'nav[aria-label="Primary"]')).toBe(208);
    await expectAccessible(page);
  });

  test('at 1100 px: the rail, expanded over the page on request', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, 'priya@digibranders.test');
    await page.goto(PROFILE);
    expect(await widthOf(page, 'nav[aria-label="Primary"]')).toBe(56);
    const before = await page.getByRole('banner').boundingBox();
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect.poll(() => widthOf(page, 'nav[aria-label="Primary"]')).toBe(208);
    // The overlay does not move the page
    const after = await page.getByRole('banner').boundingBox();
    expect(before).not.toBeNull();
    expect(after?.x).toBe(before?.x);
    await page.keyboard.press('Escape');
    await expect.poll(() => widthOf(page, 'nav[aria-label="Primary"]')).toBe(56);
  });

  test('at 390 px: the drawer behind the menu button, and no sideways scroll', async ({ page }) => {
    const policy = watchPolicy(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'priya@digibranders.test');
    await page.goto(PROFILE);
    // The menu button is there first, so the hidden sidebar is the layout's doing, not a page still empty
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer.getByRole('link', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expectAccessible(page);
    expect(policy.violations).toEqual([]);
  });

  test('a viewer sees no action it cannot take', async ({ page }) => {
    await signIn(page, 'mei@digibranders.test');
    // The list is there, so a missing Create button is the viewer's, not a page still loading
    await expect(page.getByRole('link', { name: 'Fynix' })).toBeVisible();
    await expect(page.getByRole('button', { name: /create/i })).toHaveCount(0);
    await page.goto(PROFILE);
    const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
    // A viewer reads the data, so Runs is there; Costs needs costs:read, which the role does not hold
    await expect(links).toHaveText(['Keywords', 'Runs', 'Settings']);
  });

  test('every page carries the policy, and none reports a violation', async ({ page }) => {
    const policy = watchPolicy(page);
    for (const path of [
      '/login',
      '/reset-password',
      '/verify-email',
      '/invite',
      '/two-factor',
      '/design-system/tokens',
    ]) {
      expectPolicy(await page.goto(path));
    }
    await signIn(page, 'priya@digibranders.test');
    for (const path of ['/digibranders', '/digibranders/fynix', PROFILE, SECURITY, PREFERENCES, '/another-agency']) {
      const response = await page.goto(path);
      expectPolicy(response);
      // Pages with tenant data stay out of shared caches and the back-forward cache
      expect(response?.headers()['cache-control']).toBe('private, no-store');
      await page.waitForLoadState('networkidle');
    }
    expect(policy.violations).toEqual([]);
  });

  test('in the dark theme every page still passes the accessibility checks', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('idraft.theme', 'dark');
    });
    await signIn(page, 'tomas@digibranders.test');
    for (const path of [
      '/digibranders',
      '/digibranders/settings/profile',
      SECURITY,
      '/digibranders/fynix/settings/members',
      '/digibranders/fynix/settings/entities',
      '/digibranders/fynix/settings/taxonomy',
      '/digibranders/fynix/seo/keywords',
      '/digibranders/fynix/costs',
      '/digibranders/fynix/ops/runs',
      '/digibranders/fynix/settings/schedules',
      '/digibranders/onboarding',
    ]) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      await expectAccessible(page);
    }
  });

  test('at 375 px the pages of keywords, costs, runs and schedules pass the checks and do not scroll sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'tomas@digibranders.test');
    for (const path of [
      '/digibranders/fynix/seo/keywords',
      '/digibranders/fynix/costs',
      '/digibranders/fynix/ops/runs',
      '/digibranders/fynix/settings/schedules',
    ]) {
      await page.goto(path);
      await waitForContent(page);
      await expectAccessible(page);
      // The page itself never scrolls sideways (19-responsive-behavior.md): a wide table scrolls inside its own region
      const { overflow, wide } = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // What reaches past the screen, to name the culprit when there is one
        wide: [...document.querySelectorAll('body *')]
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth)
          .slice(0, 6)
          .map((element) => `${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 60)}`),
      }));
      expect(
        overflow,
        `${path} is wider than the screen by ${String(overflow)} px: ${wide.join(' | ')}`,
      ).toBeLessThanOrEqual(0);
    }
  });

  test('a planned destination is the 404 page inside the shell', async ({ page }) => {
    await signIn(page, 'priya@digibranders.test');
    await page.goto('/digibranders/fynix/seo/keywords');
    await expect(page.getByRole('heading', { level: 1, name: /does not exist/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });
});
