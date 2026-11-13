import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible, signIn } from '../support';

const EDITOR = 'priya@digibranders.test';
const THEME_KEY = 'idraft.theme';
const FYNIX_PROMPTS = '/digibranders/fynix/ai/prompts';
const FIRST_PROMPT = 'Which SEO agency is best for a SaaS startup in Germany?';
/** The first fixture prompt (`src/mocks/prompt-fixtures.ts`), in the topic SEO. */
const FIRST_PROMPT_ID = '0192d1a8-e000-7a10-8e00-000000000001';
const FIRST_TOPIC = 'SEO';

/** The inspector of a prompt: beside the table on a wide window, a sheet over it on a narrow one. */
const inspectorOf = (page: Page): Locator =>
  page.getByRole('complementary', { name: FIRST_PROMPT }).or(page.getByRole('dialog', { name: FIRST_PROMPT }));

/** Opens the first prompt through the address the Prompts tab gives it. */
async function openFirstPrompt(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  await page.goto(`${FYNIX_PROMPTS}?tab=prompts&inspect=${encodeURIComponent(`prompt:${FIRST_PROMPT_ID}`)}`);
  const inspector = inspectorOf(page);
  await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
  return inspector;
}

const tabRowOf = (inspector: Locator): Locator =>
  inspector.getByRole('tablist', { name: 'Prompt sections' }).locator('xpath=..');

test.describe('The prompt inspector, completed', () => {
  test('shows its freshness and topic, the cited domains, the events and the statistics of a prompt', async ({
    page,
  }) => {
    const inspector = await openFirstPrompt(page, 1280);

    // Header: when the prompt was last answered, and its topic as a badge
    await expect(inspector.getByText(/^Updated /).first()).toBeVisible();
    await expect(inspector.getByText(FIRST_TOPIC, { exact: true }).first()).toBeVisible();

    // Latest: each engine card names at most 3 cited domains, the rest behind "+N"
    const sourceLists = inspector.getByRole('list', { name: 'Top sources of this answer' });
    await expect(sourceLists.first()).toBeVisible();
    for (const list of await sourceLists.all()) {
      const chips = await list.locator('[data-slot="domain-chip"]').count();
      expect(chips).toBeLessThanOrEqual(3);
      const more = list.getByRole('button');
      if ((await more.count()) > 0) {
        expect(chips).toBe(3);
        await expect(more.locator('.num')).toHaveText(/^\+\d+$/);
      }
    }

    // History: the events. The Fynix mocks report one model for each engine, so no model change is marked
    await inspector.getByRole('tab', { name: 'History' }).click();
    await expect(
      inspector.getByRole('list', { name: 'Events of this prompt' }).getByText('Prompt added'),
    ).toBeVisible();
    await expect(inspector.getByText(/^Model change on /)).toHaveCount(0);
    await expect(inspector.getByText(/^Answer model changed on /)).toHaveCount(0);

    // Stats: the sample behind each rate, what the rates count, and the statistics of one rate
    await inspector.getByRole('tab', { name: 'Stats' }).click();
    await expect(inspector.getByText(/^\d+ of \d+ answers$/).first()).toBeVisible();
    await expect(
      inspector.getByText('ChatGPT only: rates count valid answers, each of this prompt counted once'),
    ).toBeVisible();
    const opener = inspector.getByRole('button', { name: 'Open statistics for Mention on ChatGPT' });
    await opener.click();
    await inspector.getByRole('button', { name: 'Back to Stats' }).click();
    await expect(opener).toBeFocused();
  });

  test('is a sheet on a phone, whose five tabs are four in one row and Stats under More tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, EDITOR);
    await page.goto(`${FYNIX_PROMPTS}?tab=prompts&inspect=${encodeURIComponent(`prompt:${FIRST_PROMPT_ID}`)}`);
    const sheet = page.getByRole('dialog', { name: FIRST_PROMPT });
    await expect(sheet.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: FIRST_PROMPT })).toHaveCount(0);
    // Measured at 390 px: Latest, History, Citations and Competitors fit the row, the fifth tab is in the menu
    await expect(sheet.getByRole('tab')).toHaveCount(4);
    await expect(sheet.getByRole('tab')).toHaveText([/^Latest/, /^History/, /^Citations/, /^Competitors/]);
    await expect(sheet.getByRole('tab', { name: 'Citations' })).toBeVisible();
    await sheet.getByRole('button', { name: 'More tabs' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Stats']);
    await page.keyboard.press('Escape');
    const fits = await tabRowOf(sheet).evaluate((row) => row.scrollWidth <= row.clientWidth);
    expect(fits).toBe(true);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`The prompt inspector in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const width of [1280, 390]) {
      test(`has no accessibility violation on Latest, History, Citations and Stats at ${String(width)} px`, async ({
        page,
      }) => {
        const inspector = await openFirstPrompt(page, width);
        await expectAccessible(page);
        for (const tab of ['History', 'Citations', 'Stats']) {
          // On a phone the fifth tab is under More tabs, and choosing it puts it in the row
          if ((await inspector.getByRole('tab', { name: tab }).count()) === 0) {
            await inspector.getByRole('button', { name: 'More tabs' }).click();
            await page.getByRole('menuitem', { name: tab }).click();
          } else {
            await inspector.getByRole('tab', { name: tab }).click();
          }
          await expectAccessible(page);
        }
        await inspector.getByRole('button', { name: 'Open statistics for Mention on ChatGPT' }).click();
        await expectAccessible(page);
      });
    }
  });
}
