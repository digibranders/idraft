import { expect, test, type Locator, type Page } from '@playwright/test';

import { signIn } from '../support';

/**
 * The Prompts page as the redesign has it, on Fynix as an editor: the flat Groups tab with two levels (a group, then
 * its prompts), a group row that opens its drawer, the Brands popover and Add as competitor with its toast and Undo,
 * the Screenshot column that only one platform has, and the prompt drawer with its five tabs.
 */
test.describe.configure({ timeout: 120_000 });

const EDITOR = 'priya@digibranders.test';
const PROMPTS = '/digibranders/fynix/ai/prompts';
const FIRST_PROMPT = 'Which SEO agency is best for a SaaS startup in Germany?';
/** The first fixture prompt (`src/mocks/prompt-fixtures.ts`). */
const FIRST_PROMPT_ID = '0192d1a8-e000-7a10-8e00-000000000001';
const PAID_SEARCH_PROMPT = 'What is the best way to manage paid search on a small budget?';

const groupsGrid = (page: Page): Locator => page.getByRole('treegrid', { name: 'Groups' });
const promptsGrid = (page: Page): Locator => page.getByRole('grid', { name: 'Prompts' });
const toastsOf = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' });

/** A drawer is docked beside the table on a wide window and a sheet over it on a narrow one. */
const drawerOf = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name }).or(page.getByRole('dialog', { name }));

/**
 * Opens the Brands list of a group row. A list closes when anything scrolls, and the click that first reaches the
 * cell scrolls the table sideways, so the trigger is brought into view and the frame after the scroll is waited for.
 */
async function openBrands(page: Page, group: string): Promise<Locator> {
  const trigger = page.getByRole('button', { name: new RegExp(`^Brands mentioned in the answers for ${group}:`) });
  await trigger.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return page.getByRole('dialog', { name: 'Brands mentioned in answers' });
}

test.describe('the Groups tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
  });

  test('is one flat list of groups with their prompts one level under, and Expand all shows them', async ({ page }) => {
    await page.goto(PROMPTS);
    const grid = groupsGrid(page);
    const groups = grid.getByRole('row').filter({ has: page.getByRole('checkbox', { name: /^Select (?!all)/ }) });
    await expect(grid.getByRole('row', { name: /Paid Search/ })).toBeVisible();
    // Two levels: the rows of the first level are collapsed, so no prompt is in the table yet
    await expect(grid.getByText(PAID_SEARCH_PROMPT, { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(grid.getByText(PAID_SEARCH_PROMPT, { exact: true })).toBeVisible();
    await expect(grid.getByRole('row', { name: /Paid Search/ })).toHaveAttribute('aria-level', '1');
    await expect(grid.getByRole('row').filter({ hasText: PAID_SEARCH_PROMPT })).toHaveAttribute('aria-level', '2');
    expect(await groups.count()).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(grid.getByText(PAID_SEARCH_PROMPT, { exact: true })).toHaveCount(0);
  });

  test('a group row opens its drawer, whose Prompts (n) tab lists the prompts of the group', async ({ page }) => {
    await page.goto(PROMPTS);
    await groupsGrid(page).getByText('Paid Search', { exact: true }).click();
    const drawer = drawerOf(page, 'Paid Search');
    await expect(drawer.getByRole('tablist', { name: 'Group sections' })).toBeVisible();
    for (const name of ['Overview', 'Prompts (2)', 'Competitors', 'Related']) {
      await expect(drawer.getByRole('tab', { name, exact: true })).toBeVisible();
    }
    await drawer.getByRole('tab', { name: 'Prompts (2)', exact: true }).click();
    await expect(drawer.getByText(PAID_SEARCH_PROMPT, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/[?&]itab=prompts(&|$)/);
  });

  test('the Brands popover lists the brands of a group, and Escape closes it with the focus back on its button', async ({
    page,
  }) => {
    await page.goto(PROMPTS);
    const list = await openBrands(page, 'Technical SEO');
    await expect(list.getByText('Brands mentioned in answers', { exact: true })).toBeVisible();
    // The own brand is marked, and a brand that is not a competitor has an Add button
    await expect(list.getByText('You', { exact: true })).toBeVisible();
    await expect(list.getByRole('button', { name: 'Add Copper to your competitors' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Brands mentioned in the answers for Technical SEO:/ }),
    ).toBeFocused();
  });

  test('Add as competitor says so in a toast with Undo, and Undo takes the brand off again', async ({ page }) => {
    await page.goto(PROMPTS);
    const list = await openBrands(page, 'Technical SEO');
    await list.getByRole('button', { name: 'Add Copper to your competitors' }).click();
    const toasts = toastsOf(page);
    await expect(toasts.getByText('Copper added to your competitors')).toBeVisible();
    await expect(
      toasts.getByText(/^It counts in share of voice and the Lost to competitor card from the next run\./),
    ).toBeVisible();
    // The row says it is added, and the Add button is gone
    await expect(list.getByRole('button', { name: 'Add Copper to your competitors' })).toHaveCount(0);
    await expect(list.getByText('Added', { exact: true })).toBeVisible();

    await toasts.getByRole('button', { name: 'Undo' }).click();
    await expect(toasts.getByText('Copper added to your competitors')).toHaveCount(0);
    const again = await openBrands(page, 'Technical SEO');
    await expect(again.getByRole('button', { name: 'Add Copper to your competitors' })).toBeVisible();
  });
});

test.describe('the Prompts tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
  });

  test('has the Screenshot column only while one platform is chosen', async ({ page }) => {
    await page.goto(`${PROMPTS}?tab=prompts`);
    const grid = promptsGrid(page);
    await expect(grid.getByRole('columnheader', { name: 'Brands' })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Screenshot' })).toHaveCount(0);

    await page.getByRole('combobox', { name: 'Platform: All platforms' }).click();
    await page.getByRole('option', { name: 'ChatGPT', exact: true }).click();
    await expect(page).toHaveURL(/[?&]engine=chatgpt_web(&|$)/);
    await expect(grid.getByRole('columnheader', { name: 'Screenshot' })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Cited pages' })).toBeVisible();
    await expect(
      grid.getByRole('button', { name: /^Open the latest ChatGPT answer screenshot for / }).first(),
    ).toBeVisible();

    await page.getByRole('combobox', { name: 'Platform: ChatGPT' }).click();
    await page.getByRole('option', { name: 'All platforms', exact: true }).click();
    await expect(page).not.toHaveURL(/engine=/);
    await expect(grid.getByRole('columnheader', { name: 'Screenshot' })).toHaveCount(0);
  });

  test('the prompt drawer opens each of its tabs with that tab’s own content', async ({ page }) => {
    await page.goto(`${PROMPTS}?tab=prompts&inspect=${encodeURIComponent(`prompt:${FIRST_PROMPT_ID}`)}`);
    const drawer = drawerOf(page, FIRST_PROMPT);
    const tabs = drawer.getByRole('tablist', { name: 'Prompt sections' });
    await expect(tabs).toBeVisible();
    for (const name of ['Latest', 'History', 'Citations', 'Competitors', 'Stats']) {
      await expect(tabs.getByRole('tab', { name, exact: true })).toBeVisible();
    }

    // Latest: the newest answer of each platform, each with a way to open it whole
    await expect(tabs.getByRole('tab', { name: 'Latest', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByRole('button', { name: 'Open the full answer from ChatGPT' })).toBeVisible();

    await tabs.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(drawer.getByRole('table', { name: 'Answers to this prompt' })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Citations', exact: true }).click();
    await expect(drawer.getByText('Top domains', { exact: true })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Competitors', exact: true }).click();
    await expect(drawer.getByRole('table', { name: 'Brands mentioned in the answers to this prompt' })).toBeVisible();

    await tabs.getByRole('tab', { name: 'Stats', exact: true }).click();
    await expect(drawer.getByText(/^A rate is successes over valid answers in the period/)).toBeVisible();
  });
});
