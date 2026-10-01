import { expect, test, type Page } from '@playwright/test';

import { PREVIEW_SECTION_SLUGS } from '../../src/components/design-system/section-slugs';
import { signIn, waitForContent } from '../support';

/**
 * Visual regression (26-implementation-guidelines.md section 11): each page as a whole, light and dark, at
 * the two widths of the visual projects, with the clock, time zone and locale fixed in the config. The
 * baselines are made in the pinned Playwright image only, so fonts and anti-aliasing match from one machine
 * to the next: `pnpm e2e:visual` inside the image, which builds and serves the app there too.
 */

/** Every date the pages show is relative to this moment, so "Last active" reads the same on each run. */
const NOW = new Date('2026-09-29T12:00:00Z');
const THEMES = ['light', 'dark'] as const;
const THEME_STORAGE_KEY = 'sightline.theme';

const SIGNED_OUT = [
  { name: 'login', path: '/login' },
  { name: 'reset-password', path: '/reset-password' },
] as const;

const SIGNED_IN = [
  { name: 'workspace', path: '/digibranders' },
  { name: 'settings-profile', path: '/digibranders/fynix/settings/profile' },
  { name: 'settings-security', path: '/digibranders/fynix/settings/security' },
  { name: 'settings-preferences', path: '/digibranders/fynix/settings/preferences' },
  { name: 'settings-project-general', path: '/digibranders/fynix/settings/general' },
  { name: 'settings-workspace-general', path: '/digibranders/fynix/settings/workspace' },
  { name: 'settings-members', path: '/digibranders/fynix/settings/members' },
  { name: 'new-project', path: '/digibranders/onboarding' },
  { name: 'settings-entities', path: '/digibranders/fynix/settings/entities' },
  { name: 'settings-domains', path: '/digibranders/fynix/settings/domains' },
  { name: 'settings-taxonomy', path: '/digibranders/fynix/settings/taxonomy' },
] as const;

/** Waits until nothing on the page will still move: the content is there, the fonts are in, no request is out. */
async function settle(page: Page): Promise<void> {
  await waitForContent(page);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function expectPage(page: Page, name: string): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_STORAGE_KEY, theme] as const,
      );
    });

    for (const slug of PREVIEW_SECTION_SLUGS) {
      test(`design-system ${slug}`, async ({ page }) => {
        await page.goto(`/design-system/${slug}`);
        await expectPage(page, `design-system-${slug}-${theme}`);
      });
    }

    for (const { name, path } of SIGNED_OUT) {
      test(`${name}`, async ({ page }) => {
        await page.goto(path);
        await expectPage(page, `${name}-${theme}`);
      });
    }

    for (const { name, path } of SIGNED_IN) {
      test(`${name}`, async ({ page }) => {
        await signIn(page, 'priya@digibranders.test');
        await page.goto(path);
        await expectPage(page, `${name}-${theme}`);
      });
    }
  });
}
