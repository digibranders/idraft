import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { signIn } from '../support';
import { EDITOR, THEME_STORAGE_KEY, openLinks } from '../support/internal-links';

/**
 * The Link map tab (plan 11) against the test build with every route mocked. The mock crawl behind the map is the
 * small one of `mocks/fixtures/link-graph.ts`: 15 pages and 13 editorial links.
 */

const MAP = 'section[aria-label="Link map"]';

/** No WCAG 2.2 AA violation inside the tab, with its card open. The page's shell is checked by the other flows. */
async function expectMapAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .include(MAP)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

test.describe('Link map', () => {
  test('finds a page, selects it and opens its details', async ({ page }) => {
    await signIn(page, EDITOR);
    await openLinks(page);
    await page.getByRole('tab', { name: 'Link map' }).click();

    const map = page.getByRole('region', { name: 'Link map' });
    await expect(
      page.getByRole('img', { name: /^Map of internal links\. 15 pages and 13 editorial links\./ }),
    ).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Find a page on the map' });
    await search.fill('digital-bank');
    await expect(map.getByRole('status')).toHaveText('1 of 15 pages');
    await search.press('Enter');

    const card = page.getByRole('complementary', { name: 'Selected page' });
    await expect(card).toContainText('/india/bfsi/case-study/digital-bank');
    await expect(card).toContainText('pages it links to');
    await expect(page).toHaveURL(/mpage=8/);

    await card.getByRole('button', { name: 'Page details' }).click();
    await expect(page).toHaveURL(/inspect=page(%3A|:)8/);
    // The first Escape closes the inspector, the second lets the page go
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/inspect=/);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page).not.toHaveURL(/mpage=/);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no axe violations in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          window.localStorage.setItem(key, value);
        },
        [THEME_STORAGE_KEY, theme] as const,
      );
      await signIn(page, EDITOR);
      await openLinks(page, 'tab=map&mpage=8');
      await expect(page.getByRole('complementary', { name: 'Selected page' })).toBeVisible();
      await page.getByRole('button', { name: 'Reading the map' }).click();
      await expect(page.getByRole('region', { name: 'Reading the map' })).toBeVisible();
      await expectMapAccessible(page);
    });
  }
});
