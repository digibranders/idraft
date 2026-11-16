import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible } from '../support';
import {
  PAID_SEARCH,
  PAID_SEARCH_PROMPTS,
  SEO,
  THEME_KEY,
  FIRST_PROMPT,
  INSPECT_FIRST_PROMPT,
  addDetectableChip,
  awaitChanges,
  changesIn,
  colouredIn,
  compareSelect,
  drawerOf,
  inspectTopic,
  inspectorOf,
  openPrompts,
  openTip,
  promptsGrid,
  stripOf,
  topicsGrid,
  valueOf,
  visitPrompts,
} from '../support/ai-compare';

/** The address key that turns the comparison on: the page opens without one. */
const ON = { cmp: 'previous' } as const;
const INSPECT_FIRST_PROMPT_COMPARED = `${INSPECT_FIRST_PROMPT}&cmp=previous`;

/** The tone of a change that is not detectable, and the two of a detectable one. */
const NEUTRAL = 'text-foreground-secondary';
const POSITIVE = 'text-positive-text';

/** A change drawn in `region`, counted as the page leaves it: nothing while the comparison is off. */
const countChanges = async (region: Locator): Promise<number> => (await changesIn(region)).length;

/** The section of a drawer that a heading names. */
const sectionOf = (drawer: Locator, name: string): Locator =>
  drawer.locator('section').filter({ has: drawer.page().getByRole('heading', { name, exact: true }) });

/** Opens a topic's drawer by its name in the table, and returns the drawer. */
async function openTopic(page: Page, name: string): Promise<Locator> {
  await topicsGrid(page).getByText(name, { exact: true }).click();
  const drawer = drawerOf(page, name);
  await expect(drawer.getByRole('tablist', { name: 'Group sections' })).toBeVisible();
  return drawer;
}

/** Chooses an option of the "Compare with" select. */
async function chooseCompare(page: Page, option: string): Promise<void> {
  await compareSelect(page).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Compare with the previous period', () => {
  test('is off by default, and the previous period turns on the strip, the Mention column and the group drawer changes', async ({
    page,
  }) => {
    await openPrompts(page, 1280);
    await expect(compareSelect(page)).toHaveText('No comparison');
    expect(page.url()).not.toContain('cmp=');
    // Nothing is compared: no change anywhere, and no line in the Mention rate cell
    expect(await countChanges(stripOf(page))).toBe(0);
    expect(await countChanges(topicsGrid(page))).toBe(0);

    await chooseCompare(page, 'vs previous period');
    await expect(page).toHaveURL(/[?&]cmp=previous(&|$)/);
    await awaitChanges(page);

    // The strip: one change on each platform slot
    expect(await countChanges(stripOf(page))).toBeGreaterThanOrEqual(2);
    // The Mention column: a change beside the average of every topic row that has a previous period
    await expect.poll(() => countChanges(topicsGrid(page))).toBeGreaterThanOrEqual(3);
    // The first topic with a drawer: the three cards and the engine rows carry a change
    const drawer = await openTopic(page, 'SEO');
    for (const card of ['Mentioned', 'Cited', 'Share of voice']) {
      await expect(valueOf(drawer, card)).toContainText(/\d pts/);
    }
    expect(await countChanges(drawer.getByRole('list', { name: 'Mention by platform' }))).toBeGreaterThanOrEqual(1);
  });

  test('No comparison drops cmp from the address and removes every change', async ({ page }) => {
    await openPrompts(page, 1280, ON);
    await awaitChanges(page);
    await chooseCompare(page, 'No comparison');
    await expect(page).not.toHaveURL(/cmp=/);
    await expect(compareSelect(page)).toHaveText('No comparison');
    await expect.poll(() => countChanges(stripOf(page))).toBe(0);
    await expect.poll(() => countChanges(topicsGrid(page))).toBe(0);
    await page.getByRole('radio', { name: 'Prompts' }).click();
    await expect(promptsGrid(page).getByRole('row').nth(1)).toBeVisible();
    expect(await countChanges(promptsGrid(page))).toBe(0);

    // The drawer and the inspector draw none either
    await page.goto(inspectTopic(SEO));
    const drawer = drawerOf(page, 'SEO');
    await expect(drawer.getByRole('tablist', { name: 'Group sections' })).toBeVisible();
    await expect(valueOf(drawer, 'Mentioned')).toContainText('avg of');
    expect(await countChanges(drawer)).toBe(0);

    // Back on: the key comes and the changes return
    await visitPrompts(page);
    await chooseCompare(page, 'vs previous period');
    await expect(page).toHaveURL(/[?&]cmp=previous(&|$)/);
    await awaitChanges(page);
  });

  test('the Mention rate cell draws a trend icon only while comparing, with its figures in the tooltip, and there is no Trend column', async ({
    page,
  }) => {
    await openPrompts(page, 1280, { tab: 'prompts' });
    const icons = promptsGrid(page).locator('[data-slot="trend-icon"]');
    await expect(promptsGrid(page).getByRole('columnheader', { name: /^Trend/ })).toHaveCount(0);
    await expect(icons).toHaveCount(0);
    await chooseCompare(page, 'vs previous period');
    await expect(icons.first()).toBeVisible();
    await expect(promptsGrid(page).getByRole('columnheader', { name: /^Trend/ })).toHaveCount(0);
    // No points in the cell and no line: the icon says the direction, the hover says the figures
    await expect(promptsGrid(page).getByRole('img', { name: /^Mention rate by week: / })).toHaveCount(0);
    const cell = promptsGrid(page).getByRole('gridcell').filter({ has: icons }).first();
    expect(await cell.textContent()).toMatch(/^\d+%/);
    expect(await cell.locator('[aria-hidden="true"]').filter({ hasText: /pts/ }).count()).toBe(0);
    await cell.hover();
    await expect(openTip(page)).toContainText(/(Up|Down|No change)( [\d.]+ pts)? against the previous period/);
    await expect(openTip(page)).toContainText(/Within normal variation|Detectable change/);
  });

  test('Detectable changes only is in the URL, narrows Prompts, and survives a reload', async ({ page }) => {
    await openPrompts(page, 1280, ON, { detectable: true });
    await awaitChanges(page);
    await expect(topicsGrid(page).getByText('Content Marketing', { exact: true })).toBeVisible();
    await addDetectableChip(page);
    await expect(page.getByRole('button', { name: /^Show: Detectable changes only/ })).toBeVisible();

    // Topics: Paid Search alone, the one topic whose change the interim test finds
    await expect(topicsGrid(page).getByText('Paid Search', { exact: true })).toBeVisible();
    await expect(topicsGrid(page).getByText('Content Marketing', { exact: true })).toHaveCount(0);
    await expect(topicsGrid(page).getByText('SEO', { exact: true })).toHaveCount(0);

    // Prompts: its two prompts, and the strip counts them
    await page.getByRole('radio', { name: 'Prompts' }).click();
    for (const text of PAID_SEARCH_PROMPTS)
      await expect(promptsGrid(page).getByText(text, { exact: true })).toBeVisible();
    await expect(promptsGrid(page).getByText(FIRST_PROMPT, { exact: true })).toHaveCount(0);
    await expect(stripOf(page)).toContainText(/Prompts\s*2(?!\d)/);

    await page.reload();
    await expect(page).toHaveURL(/[?&]detectable=only(&|$)/);
    await expect(page.getByRole('button', { name: /^Show: Detectable changes only/ })).toBeVisible();
    for (const text of PAID_SEARCH_PROMPTS)
      await expect(promptsGrid(page).getByText(text, { exact: true })).toBeVisible();
    await expect(promptsGrid(page).getByText(FIRST_PROMPT, { exact: true })).toHaveCount(0);
  });

  test('with comparison off the chip says why no row is left and Compare with previous period brings the rows back', async ({
    page,
  }) => {
    await openPrompts(page, 1280, { detectable: 'only' }, { detectable: true, table: false });
    await expect(page.getByRole('heading', { name: 'No comparison to read changes from' })).toBeVisible();
    await expect(page.getByText(/^Comparison is off, so no change can be detected/)).toBeVisible();
    await page.getByRole('button', { name: 'Compare with previous period' }).click();
    await expect(page).toHaveURL(/[?&]cmp=previous(&|$)/);
    await expect(page).toHaveURL(/[?&]detectable=only(&|$)/);
    await expect(page.getByRole('heading', { name: 'No comparison to read changes from' })).toHaveCount(0);
    await expect(topicsGrid(page).getByText('Paid Search', { exact: true })).toBeVisible();
    await expect(compareSelect(page)).toHaveText('vs previous period');
  });

  test('a change that is not detectable is neutral and its tooltip says within normal variation', async ({ page }) => {
    await openPrompts(page, 1280, ON);
    await awaitChanges(page);
    // Fynix has no detectable change at 28 days: every change drawn is neutral, and says it is within normal variation
    const drawn = [...(await changesIn(stripOf(page))), ...(await changesIn(topicsGrid(page)))];
    expect(drawn.length).toBeGreaterThanOrEqual(5);
    for (const change of drawn) {
      expect(change.tone, change.spoken).toBe(NEUTRAL);
      expect(change.spoken).toMatch(/, within normal variation, provisional$/);
    }
    expect(await colouredIn(stripOf(page))).toEqual([]);
    expect(await colouredIn(topicsGrid(page))).toEqual([]);

    // The tooltip of a chip, and of the Mention cell of a row, say so in words and name the test
    await stripOf(page)
      .getByRole('definition')
      .filter({ hasText: /\d pts/ })
      .first()
      .hover();
    await expect(openTip(page)).toContainText('Within normal variation');
    await expect(openTip(page)).toContainText('Provisional');
    await expect(openTip(page)).toContainText(/Previous \d+%/);
    await page.mouse.move(0, 0);
    await topicsGrid(page)
      .getByRole('row', { name: /Paid Search/ })
      .getByRole('gridcell')
      .filter({ has: page.locator('[data-slot="trend-icon"]') })
      // The Mention rate cell comes before the Citation rate cell, which has no change
      .first()
      .hover();
    await expect(openTip(page)).toContainText('Within normal variation');
    await expect(openTip(page)).toContainText('Previous period: ');
  });

  test('a detectable change is coloured on the Mention column and in the group drawer, and nothing else is', async ({
    page,
  }) => {
    await openPrompts(page, 1280, ON, { detectable: true });
    await awaitChanges(page);

    // Topics: exactly one coloured change, on the Mention rate of Paid Search, and a colour the neutral ones do not have
    const row = topicsGrid(page).getByRole('row', { name: /Paid Search/ });
    const coloured = await colouredIn(topicsGrid(page));
    expect(coloured).toHaveLength(1);
    expect(await colouredIn(row)).toEqual(coloured);
    const [change] = coloured;
    expect(change?.tone).toBe(POSITIVE);
    expect(change?.spoken).toMatch(/^up .* pts, detectable, provisional$/);
    const neutral = (await changesIn(topicsGrid(page))).find((one) => one.tone === NEUTRAL);
    expect(neutral).toBeDefined();
    expect(change?.color).not.toBe(neutral?.color);
    await row
      .getByRole('gridcell')
      .filter({ has: page.locator('[data-slot="trend-icon"]') })
      .first()
      .hover();
    await expect(openTip(page)).toContainText('Detectable change');
    await expect(openTip(page)).toContainText('Provisional');
    await expect(openTip(page)).toContainText('Average of 2 platforms that have a rate in both periods');
    await page.mouse.move(0, 0);

    // The strip's chips are over every prompt: the move of two prompts does not make them detectable
    expect(await colouredIn(stripOf(page))).toEqual([]);

    // Prompts: the Mention column colours the two prompts of Paid Search
    await page.getByRole('radio', { name: 'Prompts' }).click();
    await expect(promptsGrid(page).getByRole('row').nth(1)).toBeVisible();
    await expect.poll(async () => (await colouredIn(promptsGrid(page))).length).toBe(2);
    for (const text of PAID_SEARCH_PROMPTS) {
      const promptRow = promptsGrid(page).getByRole('row').filter({ hasText: text });
      expect(await colouredIn(promptRow)).toHaveLength(1);
    }

    // The drawer of Paid Search: the Mentioned card is coloured, the Cited card is not
    await page.goto(inspectTopic(PAID_SEARCH, ON));
    const drawer = drawerOf(page, 'Paid Search');
    await expect(drawer.getByRole('tablist', { name: 'Group sections' })).toBeVisible();
    await expect(valueOf(drawer, 'Mentioned')).toContainText(/\d pts/);
    expect(await colouredIn(valueOf(drawer, 'Mentioned'))).toHaveLength(1);
    expect((await colouredIn(valueOf(drawer, 'Mentioned')))[0]?.tone).toBe(POSITIVE);
    expect(await colouredIn(valueOf(drawer, 'Cited'))).toEqual([]);
    expect(await changesIn(valueOf(drawer, 'Cited'))).toHaveLength(1);
    // Share of voice has no test: neutral, and it says nothing about variation
    const share = await changesIn(valueOf(drawer, 'Share of voice'));
    expect(share).toHaveLength(1);
    expect(share[0]?.tone).toBe(NEUTRAL);
    expect(share[0]?.spoken).not.toMatch(/detectable|within normal variation|provisional/);
    // The two top prompts moved by more than normal variation
    expect(await colouredIn(sectionOf(drawer, 'Top prompts'))).toHaveLength(2);
  });

  test('the prompt inspector strip shows the change per platform', async ({ page }) => {
    await openPrompts(page, 1280, ON);
    await page.goto(INSPECT_FIRST_PROMPT_COMPARED);
    const inspector = inspectorOf(page);
    await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    for (const item of ['ChatGPT mention', 'Gemini mention']) {
      await expect(valueOf(inspector, item)).toContainText(/\d pts/);
      await expect(valueOf(inspector, item)).toContainText('within normal variation, provisional');
    }
    // The Citation rate is an average over engines and keeps no change
    expect(await changesIn(valueOf(inspector, 'Citation rate'))).toEqual([]);

    await valueOf(inspector, 'ChatGPT mention').hover();
    await expect(openTip(page)).toContainText(/Previous \d+%, \d+ of \d+ answers/);
    await expect(openTip(page)).toContainText('Previous period: ');
    await expect(openTip(page)).toContainText('Within normal variation');
  });

  test('the group drawer cards and top prompts show a change', async ({ page }) => {
    await openPrompts(page, 1280, ON);
    await page.goto(inspectTopic(SEO, ON));
    const drawer = drawerOf(page, 'SEO');
    await expect(drawer.getByRole('tablist', { name: 'Group sections' })).toBeVisible();
    for (const card of ['Mentioned', 'Cited', 'Share of voice']) {
      await expect.poll(async () => (await changesIn(valueOf(drawer, card))).length).toBe(1);
    }
    await valueOf(drawer, 'Mentioned').locator('[tabindex="0"]').first().hover();
    await expect(openTip(page)).toContainText(/Average of \d platforms/);
    await expect(openTip(page)).toContainText(/Previous \d+%/);
    await page.mouse.move(0, 0);

    const top = sectionOf(drawer, 'Top prompts');
    await expect.poll(() => countChanges(top)).toBeGreaterThanOrEqual(1);
    // "Show all" opens the Prompts tab, whose list draws the same changes
    await drawer.getByRole('button', { name: /^Show all \d+ prompts$/ }).click();
    await expect(drawer.getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => countChanges(sectionOf(drawer, 'Prompts'))).toBeGreaterThanOrEqual(1);
  });

  test('cmp survives the switch between Prompts and the inspector', async ({ page }) => {
    await openPrompts(page, 1280, ON);
    await expect(compareSelect(page)).toHaveText('vs previous period');
    await page.getByRole('radio', { name: 'Prompts' }).click();
    await expect(page).toHaveURL(/[?&]cmp=previous(&|$)/);
    await expect(promptsGrid(page).getByRole('row').nth(1)).toBeVisible();
    await promptsGrid(page).getByText(FIRST_PROMPT, { exact: true }).click();
    const inspector = inspectorOf(page);
    await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]cmp=previous(&|$)/);
    await expect(page).toHaveURL(/inspect=/);
    await expect(valueOf(inspector, 'ChatGPT mention')).toContainText(/\d pts/);
    await page.reload();
    await expect(page).toHaveURL(/[?&]cmp=previous(&|$)/);
    await expect(inspectorOf(page).getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    await expect(compareSelect(page)).toHaveText('vs previous period');
    await expect(valueOf(inspectorOf(page), 'ChatGPT mention')).toContainText(/\d pts/);
  });

  test('a page opened without cmp compares nothing, in the inspector too', async ({ page }) => {
    await openPrompts(page, 1280, { tab: 'prompts' });
    await expect(compareSelect(page)).toHaveText('No comparison');
    await promptsGrid(page).getByText(FIRST_PROMPT, { exact: true }).click();
    const inspector = inspectorOf(page);
    await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    await expect(valueOf(inspector, 'ChatGPT mention')).toContainText('answers');
    expect(await changesIn(inspector)).toEqual([]);
  });

  test('the chip survives the switch between Prompts, the inspector and a reload', async ({ page }) => {
    await openPrompts(page, 1280, { detectable: 'only', ...ON }, { detectable: true });
    await expect(topicsGrid(page).getByText('Paid Search', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Prompts' }).click();
    await expect(page).toHaveURL(/[?&]detectable=only(&|$)/);
    const [first, second] = PAID_SEARCH_PROMPTS;
    await expect(promptsGrid(page).getByText(second ?? '', { exact: true })).toBeVisible();
    await promptsGrid(page)
      .getByText(first ?? '', { exact: true })
      .click();
    const inspector = drawerOf(page, first ?? '');
    await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]detectable=only(&|$)/);
    // The inspector of a prompt that moved shows a coloured change for the engines that moved
    await expect.poll(async () => (await colouredIn(inspector)).length).toBeGreaterThanOrEqual(1);
    await page.reload();
    await expect(page).toHaveURL(/[?&]detectable=only(&|$)/);
    await expect(page.getByRole('button', { name: /^Show: Detectable changes only/ })).toBeVisible();
    await expect(drawerOf(page, first ?? '').getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Compare in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const width of [1280, 390]) {
      test(`has no accessibility violation on Groups, Prompts with trend icons, the prompt inspector and the group drawer at ${String(width)} px`, async ({
        page,
      }) => {
        // The detectable change is drawn, so a coloured change is among what axe measures
        await openPrompts(page, width, ON, { detectable: true });
        await awaitChanges(page);
        await expectAccessible(page);

        await visitPrompts(page, {
          tab: 'prompts',
          cols: 'prompt,mention,citation',
          ...ON,
        });
        await expect(promptsGrid(page).getByRole('columnheader', { name: /^Mention rate/ })).toBeVisible();
        await expect.poll(async () => (await colouredIn(promptsGrid(page))).length).toBeGreaterThan(0);
        await expectAccessible(page);

        await page.goto(INSPECT_FIRST_PROMPT_COMPARED);
        await expect(inspectorOf(page).getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
        await expect(valueOf(inspectorOf(page), 'ChatGPT mention')).toContainText(/\d pts/);
        await expectAccessible(page);

        await page.goto(inspectTopic(PAID_SEARCH, ON));
        const drawer = drawerOf(page, 'Paid Search');
        await expect(drawer.getByRole('tablist', { name: 'Group sections' })).toBeVisible();
        await expect(valueOf(drawer, 'Mentioned')).toContainText(/\d pts/);
        await expectAccessible(page);
      });
    }
  });
}
