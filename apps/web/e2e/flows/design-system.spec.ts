import { test } from '@playwright/test';

import { PREVIEW_SECTION_SLUGS } from '../../src/components/design-system/section-slugs';
import { expectAccessible } from '../support';

const THEME_STORAGE_KEY = 'idraft.theme';

/**
 * Every section of the design-system gallery passes axe with the WCAG 2.2 AA rules in both themes: in a
 * real browser, so contrast and landmarks are checked too, which jsdom cannot do. One test per section,
 * so a failure names its section and the others still run.
 */
for (const theme of ['light', 'dark'] as const) {
  test.describe(`the design-system gallery in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_STORAGE_KEY, theme] as const,
      );
    });

    for (const slug of PREVIEW_SECTION_SLUGS) {
      test(`${slug} has no accessibility violation`, async ({ page }) => {
        await page.goto(`/design-system/${slug}`);
        await expectAccessible(page);
      });
    }
  });
}
