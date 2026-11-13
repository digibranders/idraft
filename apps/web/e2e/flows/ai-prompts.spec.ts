import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible, signIn, watchPolicy } from '../support';

/** An editor holds `projects:write` and `prompts:write`; an analyst runs prompts and reads raw answers; a viewer reads. */
const EDITOR = 'priya@digibranders.test';
const ANALYST = 'jonas@digibranders.test';
const VIEWER = 'mei@digibranders.test';
const THEME_KEY = 'idraft.theme';
const CLEANSTART_ENGINES = '/digibranders/cleanstart/settings/engines';
const FYNIX_PROMPTS = '/digibranders/fynix/ai/prompts';
const FYNIX_ENGINES = '/digibranders/fynix/settings/engines';
const FIRST_PROMPT = 'Which SEO agency is best for a SaaS startup in Germany?';
const SECOND_PROMPT = 'How do I run a technical SEO audit on a large site?';
/** The first fixture prompt (`src/mocks/prompt-fixtures.ts`). */
const FIRST_PROMPT_ID = '0192d1a8-e000-7a10-8e00-000000000001';
const WIDTHS = [1440, 1280, 1024, 390] as const;

/** The answers the mocks make come from the clock: the rows that name the own brand are the ones with a mark to read. */
const namingTheBrand = (inspector: Locator): Locator =>
  inspector
    .getByRole('table', { name: 'Answers to this prompt' })
    .getByRole('row')
    .filter({ hasText: /Mentioned (and cited|only)/ });

const openAnswerButton = (row: Locator): Locator => row.getByRole('button', { name: /^Open the .* answer of / });

/** The answers of the prompt are listed on the History tab. */
async function openHistory(inspector: Locator): Promise<void> {
  await inspector.getByRole('tab', { name: 'History' }).click();
  await expect(inspector.getByRole('table', { name: 'Answers to this prompt' })).toBeVisible();
}

/** The toasts are also spoken by a live region, so the words are looked for in the toasts themselves. */
const toastsOf = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' });

/** The inspector of a prompt: beside the table on a wide window, a sheet over it on a narrow one. */
const inspectorOf = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name }).or(page.getByRole('dialog', { name }));

async function openFirstPrompt(page: Page): Promise<Locator> {
  // Exact, because a row's checkbox carries a screen reader label "Select <prompt>"
  await page.getByRole('grid', { name: 'Prompts' }).getByText(FIRST_PROMPT, { exact: true }).click();
  const inspector = inspectorOf(page, FIRST_PROMPT);
  await expect(inspector).toBeVisible();
  return inspector;
}

/** The menu of the inspector holds the width choices for everyone; Archive is only for those who may change prompts. */
async function expectNoArchive(page: Page, inspector: Locator): Promise<void> {
  await inspector.getByRole('button', { name: `More actions for ${FIRST_PROMPT}` }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
  await page.keyboard.press('Escape');
}

test.describe('AI prompt tracking', () => {
  test('an editor turns an engine on, adds prompts by pasting a list and finds them in the table', async ({ page }) => {
    const policy = watchPolicy(page);
    await signIn(page, EDITOR);
    await page.goto(CLEANSTART_ENGINES);
    const chatgpt = page.getByRole('switch', { name: 'ChatGPT' });
    await expect(chatgpt).not.toBeChecked();
    await chatgpt.click();
    const confirm = page.getByRole('alertdialog', { name: 'Turn on ChatGPT?' });
    await expect(confirm.getByText(/starts scheduled spend from the next run/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Turn on ChatGPT' }).click();
    await expect(toastsOf(page).getByText('ChatGPT is on')).toBeVisible();
    await expect(chatgpt).toBeChecked();
    await expectAccessible(page);

    // The sentence under the title leads to the schedules that ask the prompts; a link, not page.goto, since the
    // mocks' memory lives in the page
    await page.getByRole('region', { name: 'Engines' }).getByRole('link', { name: 'Schedules' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Schedules' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Topics & Prompts' }).click();
    // The title is read and not drawn (the breadcrumb shows it), so it is in the page without being seen
    await expect(page.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeAttached();
    await expect(page.getByRole('heading', { name: 'No prompts yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Add prompts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add prompts' });
    await dialog
      .getByRole('textbox', { name: 'Prompts' })
      .fill(
        'Which cleaning service is best in Boston?\nHow often should an office be cleaned?\nWhich cleaning service is best in Boston?',
      );
    await expect(dialog.getByText('Line 3 repeats line 1 and is left out.')).toBeVisible();
    await expect(dialog.getByText(/^Adds 2 prompts of your remaining \d+\.$/)).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Add 2 prompts' }).click();
    await expect(toastsOf(page).getByText('2 prompts added')).toBeVisible();
    await expect(dialog).toBeHidden();

    // Topics and Prompts are a segmented control in the table toolbar: a radio group, not a tab list
    await page.getByRole('radio', { name: 'Prompts' }).click();
    const table = page.getByRole('grid', { name: 'Prompts' });
    await expect(table.getByText('How often should an office be cleaned?', { exact: true })).toBeVisible();
    await expect(table.getByText('Which cleaning service is best in Boston?', { exact: true })).toBeVisible();
    // New prompts have no answer until the next run, and the page says so
    await expect(page.getByText(/^No data yet\. Each prompt is asked twice a week/)).toBeVisible();
    await expectAccessible(page);
    expect(policy.violations).toEqual([]);
  });

  test('a viewer reads an answer with the brands marked and the sources listed, and sees no action it cannot take', async ({
    page,
  }) => {
    await signIn(page, VIEWER);
    await page.goto(`${FYNIX_PROMPTS}?tab=prompts`);
    const table = page.getByRole('grid', { name: 'Prompts' });
    await expect(table.getByText(FIRST_PROMPT, { exact: true })).toBeVisible();
    // The table is there, so a missing button is the viewer's, not a page still loading
    await expect(page.getByRole('button', { name: 'Add prompts' })).toHaveCount(0);
    // A row's checkbox brings up the bulk bar, which gives a viewer Export CSV and no action that changes anything
    await table.getByRole('checkbox', { name: `Select ${FIRST_PROMPT}` }).check();
    const bulkBar = page.getByRole('group', { name: /^Bulk actions, 1 selected/ });
    await expect(bulkBar.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(bulkBar.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await bulkBar.getByRole('button', { name: 'Clear selection' }).click();
    await expect(bulkBar).toBeHidden();
    const inspector = await openFirstPrompt(page);
    // The country is named once the countries have loaded, which Run now waits for too, and the strip holds the
    // rates: so a missing Run now is the viewer's and not an inspector still loading
    await expect(inspector.getByText('Germany', { exact: true })).toBeVisible();
    await expect(
      inspector
        .getByRole('group', { name: 'Mention and citation rates of this prompt' })
        .getByText(/^\d+ of \d+ answers$/)
        .first(),
    ).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Run now' })).toHaveCount(0);
    await expectNoArchive(page, inspector);

    // One thing on each tab: the newest answers, the history, the brands named, the statistics
    await expect(inspector.getByRole('button', { name: /^Open the full answer from / }).first()).toBeVisible();
    await openHistory(inspector);
    await inspector.getByRole('tab', { name: 'Competitors' }).click();
    await expect(inspector.getByRole('table', { name: 'Brands named in the answers to this prompt' })).toBeVisible();
    await inspector.getByRole('tab', { name: 'Stats' }).click();
    await expect(
      inspector.getByText(/^The interval is the 95 percent Wilson interval over the valid answers/),
    ).toBeVisible();
    await openHistory(inspector);

    await openAnswerButton(namingTheBrand(inspector).first()).click();
    await expect(page.getByLabel(/^Fynix mention, own brand/).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Sources cited in this answer' })).toBeVisible();
    await expect(page.getByText('Ads in the answer are left out of the mentions and the sources.')).toBeVisible();
    // The raw answer is for those who may read raw data (`raw:read`): a viewer has no link to it
    await expect(page.getByRole('link', { name: 'Download the raw answer' })).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Back to the prompt' }).click();
    await expect(page.getByRole('complementary', { name: FIRST_PROMPT })).toBeVisible();
  });

  test('an analyst runs a prompt now and is told when one is already on its way, and finds the raw answer link', async ({
    page,
  }) => {
    await signIn(page, ANALYST);
    await page.goto(`${FYNIX_PROMPTS}?tab=prompts`);
    const inspector = await openFirstPrompt(page);
    // An analyst runs prompts but does not change them: no Archive, no way to add
    await expectNoArchive(page, inspector);
    await expect(page.getByRole('button', { name: 'Add prompts' })).toHaveCount(0);

    const toasts = toastsOf(page);
    await inspector.getByRole('button', { name: 'Run now' }).click();
    await expect(toasts.getByText('Run queued')).toBeVisible();
    await expect(toasts.getByText(/^Answers arrive within minutes\./)).toBeVisible();
    // The mock run never answers: the prompt stays asked on both engines, so a second run is refused in words
    await inspector.getByRole('button', { name: 'Run now' }).click();
    await expect(toasts.getByText('Not queued')).toBeVisible();
    await expect(
      toasts.getByText('An answer is already on its way on ChatGPT and Gemini. Try again once it has arrived.'),
    ).toBeVisible();

    await openHistory(inspector);
    await openAnswerButton(namingTheBrand(inspector).first()).click();
    await expect(page.getByRole('button', { name: 'Download the raw answer' })).toBeVisible();
    await expectAccessible(page);
  });

  test('an editor archives a prompt, then brings it back with Undo', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${FYNIX_PROMPTS}?tab=prompts`);
    const table = page.getByRole('grid', { name: 'Prompts' });
    await table.getByText(SECOND_PROMPT, { exact: true }).click();
    const inspector = page.getByRole('complementary', { name: SECOND_PROMPT });
    await inspector.getByRole('button', { name: `More actions for ${SECOND_PROMPT}` }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(toastsOf(page).getByText('Prompt archived')).toBeVisible();
    await expect(table.getByText(SECOND_PROMPT, { exact: true })).toBeHidden();
    await expect(table.getByText(FIRST_PROMPT, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(toastsOf(page).getByText('Prompt restored')).toBeVisible();
    await expect(table.getByText(SECOND_PROMPT, { exact: true })).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Topics & Prompts in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const width of WIDTHS) {
      test(`has no accessibility violation and no page scroll sideways at ${String(width)} px`, async ({ page }) => {
        const noSidewaysScroll = async (): Promise<void> => {
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        };
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, EDITOR);
        await page.goto(FYNIX_PROMPTS);
        // Under 768 px the topics are a list of rows (the best engine and the engine count on each), not a grid
        if (width < 768) {
          const topics = page.getByRole('list', { name: /^Topics, \d+ results/ });
          await expect(topics).toBeVisible();
          await expect(topics.getByRole('button').first()).toBeVisible();
        } else {
          await expect(page.getByRole('treegrid', { name: 'Topics' })).toBeVisible();
        }
        await expectAccessible(page);
        await noSidewaysScroll();

        await page.goto(`${FYNIX_PROMPTS}?tab=prompts&inspect=${encodeURIComponent(`prompt:${FIRST_PROMPT_ID}`)}`);
        const inspector = inspectorOf(page, FIRST_PROMPT);
        await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
        await expectAccessible(page);
        await noSidewaysScroll();
        // Every tab keeps the inspector inside the window, and the answers are on History
        for (const tab of ['Competitors', 'Stats']) {
          // On a phone Stats is under More tabs, and choosing it puts it in the row
          if ((await inspector.getByRole('tab', { name: tab }).count()) === 0) {
            await inspector.getByRole('button', { name: 'More tabs' }).click();
            await page.getByRole('menuitem', { name: tab }).click();
          } else {
            await inspector.getByRole('tab', { name: tab }).click();
          }
          await noSidewaysScroll();
        }
        await openHistory(inspector);
        await expectAccessible(page);
        await noSidewaysScroll();

        // The answer viewer, with the own brand and the competitors marked
        await openAnswerButton(namingTheBrand(inspector).first()).click();
        await expect(page.getByLabel(/^Fynix mention, own brand/).first()).toBeVisible();
        await expect(page.getByRole('list', { name: 'Sources cited in this answer' })).toBeVisible();
        await expectAccessible(page);
        await noSidewaysScroll();

        await page.goto(FYNIX_ENGINES);
        await expect(page.getByRole('switch', { name: 'Gemini' })).toBeChecked();
        await expectAccessible(page);
        await noSidewaysScroll();
      });
    }
  });
}
