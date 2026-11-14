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
  columnOf,
  compareSelect,
  drawerOf,
  inspectTopic,
  inspectorOf,
  openPrompts,
  openTip,
  pointsOf,
  promptsGrid,
  stripOf,
  topicsGrid,
  valueOf,
  visitPrompts,
} from '../support/ai-compare';

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
  await expect(drawer.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
  return drawer;
}

/** Chooses an option of the "Compare with" select. */
async function chooseCompare(page: Page, option: string): Promise<void> {
  await compareSelect(page).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Compare with the previous period', () => {
  test('is on by default, and the strip, the Mention column and the first topic drawer show changes', async ({
    page,
  }) => {
    await openPrompts(page, 1280);
    await expect(compareSelect(page)).toHaveText('vs previous period');
    await awaitChanges(page);
    expect(page.url()).not.toContain('cmp=');

    // The strip: one change on each engine chip
    expect(await countChanges(stripOf(page))).toBeGreaterThanOrEqual(2);
    // The Mention column: a change beside the average of every topic row that has a previous period
    await expect.poll(() => countChanges(topicsGrid(page))).toBeGreaterThanOrEqual(3);
    // The first topic with a drawer: the three cards and the engine rows carry a change
    const drawer = await openTopic(page, 'SEO');
    for (const card of ['Mentioned', 'Cited', 'Share of voice']) {
      await expect(valueOf(drawer, card)).toContainText(/\d pts/);
    }
    expect(await countChanges(drawer.getByRole('list', { name: 'Mention by engine' }))).toBeGreaterThanOrEqual(1);
  });

  test('No comparison writes cmp=off and removes every change', async ({ page }) => {
    await openPrompts(page, 1280);
    await awaitChanges(page);
    await chooseCompare(page, 'No comparison');
    await expect(page).toHaveURL(/[?&]cmp=off(&|$)/);
    await expect(compareSelect(page)).toHaveText('No comparison');
    await expect.poll(() => countChanges(stripOf(page))).toBe(0);
    await expect.poll(() => countChanges(topicsGrid(page))).toBe(0);
    await page.getByRole('radio', { name: 'Prompts' }).click();
    await expect(promptsGrid(page).getByRole('row').nth(1)).toBeVisible();
    expect(await countChanges(promptsGrid(page))).toBe(0);

    // The drawer and the inspector draw none either
    await page.goto(inspectTopic(SEO, { cmp: 'off' }));
    const drawer = drawerOf(page, 'SEO');
    await expect(drawer.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
    await expect(valueOf(drawer, 'Mentioned')).toContainText('avg of');
    expect(await countChanges(drawer)).toBe(0);

    // Back on: the key goes (a default writes nothing) and the changes return
    await visitPrompts(page, { cmp: 'off' });
    await chooseCompare(page, 'vs previous period');
    await expect(page).not.toHaveURL(/cmp=/);
    await awaitChanges(page);
  });

  test('Detectable changes only is in the URL, narrows Topics and Prompts, and survives a reload', async ({ page }) => {
    await openPrompts(page, 1280, {}, { detectable: true });
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
    await openPrompts(page, 1280, { cmp: 'off', detectable: 'only' }, { detectable: true, table: false });
    await expect(page.getByRole('heading', { name: 'No comparison to read changes from' })).toBeVisible();
    await expect(page.getByText(/^Comparison is off, so no change can be detected/)).toBeVisible();
    await page.getByRole('button', { name: 'Compare with previous period' }).click();
    await expect(page).not.toHaveURL(/cmp=/);
    await expect(page).toHaveURL(/[?&]detectable=only(&|$)/);
    await expect(page.getByRole('heading', { name: 'No comparison to read changes from' })).toHaveCount(0);
    await expect(topicsGrid(page).getByText('Paid Search', { exact: true })).toBeVisible();
    await expect(compareSelect(page)).toHaveText('vs previous period');
  });

  test('a change that is not detectable is neutral and its tooltip says within normal variation', async ({ page }) => {
    await openPrompts(page, 1280);
    await awaitChanges(page);
    // Fynix has no detectable change at 28 days: every change drawn is neutral, and says it is within normal variation
    const drawn = [...(await changesIn(stripOf(page))), ...(await changesIn(topicsGrid(page)))];
    expect(drawn.length).toBeGreaterThanOrEqual(5);
    for (const change of drawn) {
      expect(change.tone, change.spoken).toBe(NEUTRAL);
      expect(change.spoken).toMatch(/, within normal variation, interim test$/);
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
    await expect(openTip(page)).toContainText('Interim test');
    await expect(openTip(page)).toContainText(/Previous \d+%/);
    await page.mouse.move(0, 0);
    await topicsGrid(page)
      .getByRole('row', { name: /Paid Search/ })
      .getByRole('gridcell')
      .filter({ hasText: 'avg of' })
      // The Mention rate cell comes before the Citation rate cell, which has no change
      .first()
      .hover();
    await expect(openTip(page)).toContainText('Within normal variation');
    await expect(openTip(page)).toContainText('Previous period: ');
  });

  test('a detectable change is coloured on the Mention column and in the topic drawer, and nothing else is', async ({
    page,
  }) => {
    await openPrompts(page, 1280, {}, { detectable: true });
    await awaitChanges(page);

    // Topics: exactly one coloured change, on the Mention rate of Paid Search, and a colour the neutral ones do not have
    const row = topicsGrid(page).getByRole('row', { name: /Paid Search/ });
    const coloured = await colouredIn(topicsGrid(page));
    expect(coloured).toHaveLength(1);
    expect(await colouredIn(row)).toEqual(coloured);
    const [change] = coloured;
    expect(change?.tone).toBe(POSITIVE);
    expect(change?.spoken).toMatch(/^up .* pts, detectable, interim test$/);
    const neutral = (await changesIn(topicsGrid(page))).find((one) => one.tone === NEUTRAL);
    expect(neutral).toBeDefined();
    expect(change?.color).not.toBe(neutral?.color);
    await row.getByRole('gridcell').filter({ hasText: 'avg of' }).first().hover();
    await expect(openTip(page)).toContainText('Detectable change');
    await expect(openTip(page)).toContainText('Interim test');
    await expect(openTip(page)).toContainText('Average of 2 engines that have a rate in both periods');
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
    await page.goto(inspectTopic(PAID_SEARCH));
    const drawer = drawerOf(page, 'Paid Search');
    await expect(drawer.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
    await expect(valueOf(drawer, 'Mentioned')).toContainText(/\d pts/);
    expect(await colouredIn(valueOf(drawer, 'Mentioned'))).toHaveLength(1);
    expect((await colouredIn(valueOf(drawer, 'Mentioned')))[0]?.tone).toBe(POSITIVE);
    expect(await colouredIn(valueOf(drawer, 'Cited'))).toEqual([]);
    expect(await changesIn(valueOf(drawer, 'Cited'))).toHaveLength(1);
    // Share of voice has no test: neutral, and it says nothing about variation
    const share = await changesIn(valueOf(drawer, 'Share of voice'));
    expect(share).toHaveLength(1);
    expect(share[0]?.tone).toBe(NEUTRAL);
    expect(share[0]?.spoken).not.toMatch(/detectable|within normal variation|interim test/);
    // The two top prompts moved by more than normal variation
    expect(await colouredIn(sectionOf(drawer, 'Top prompts'))).toHaveLength(2);
  });

  test('the prompt inspector strip shows the change per engine', async ({ page }) => {
    await openPrompts(page, 1280);
    await page.goto(INSPECT_FIRST_PROMPT);
    const inspector = inspectorOf(page);
    await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    for (const item of ['ChatGPT mention', 'Gemini mention']) {
      await expect(valueOf(inspector, item)).toContainText(/\d pts/);
      await expect(valueOf(inspector, item)).toContainText('within normal variation, interim test');
    }
    // The Citation rate is an average over engines and keeps no change
    expect(await changesIn(valueOf(inspector, 'Citation rate'))).toEqual([]);

    await valueOf(inspector, 'ChatGPT mention').hover();
    await expect(openTip(page)).toContainText(/Previous \d+%, \d+ of \d+ answers/);
    await expect(openTip(page)).toContainText('Previous period: ');
    await expect(openTip(page)).toContainText('Within normal variation');
  });

  test('the topic drawer cards and top prompts show a change', async ({ page }) => {
    await openPrompts(page, 1280);
    await page.goto(inspectTopic(SEO));
    const drawer = drawerOf(page, 'SEO');
    await expect(drawer.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
    for (const card of ['Mentioned', 'Cited', 'Share of voice']) {
      await expect.poll(async () => (await changesIn(valueOf(drawer, card))).length).toBe(1);
    }
    await valueOf(drawer, 'Mentioned').locator('[tabindex="0"]').first().hover();
    await expect(openTip(page)).toContainText(/Average of \d engines/);
    await expect(openTip(page)).toContainText(/Previous \d+%/);
    await page.mouse.move(0, 0);

    const top = sectionOf(drawer, 'Top prompts');
    await expect.poll(() => countChanges(top)).toBeGreaterThanOrEqual(1);
    // "Show all" opens the Prompts tab, whose list draws the same changes
    await drawer.getByRole('button', { name: /^Show all \d+ prompts$/ }).click();
    await expect(drawer.getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => countChanges(sectionOf(drawer, 'Prompts'))).toBeGreaterThanOrEqual(1);
  });

  test('a change column chosen in the chooser shows and sorts', async ({ page }) => {
    await openPrompts(page, 1280, { tab: 'prompts' });
    const grid = promptsGrid(page);
    await expect(grid.getByRole('columnheader', { name: /ChatGPT change/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('checkbox', { name: 'ChatGPT change' }).check();
    await page.keyboard.press('Escape');
    const header = grid.getByRole('columnheader', { name: /ChatGPT change/ });
    await expect(header).toBeVisible();
    await expect(page).toHaveURL(/cols=[^&]*change_chatgpt_web/);
    await expect
      .poll(async () => (await columnOf(grid, /ChatGPT change/)).filter((cell) => pointsOf(cell) !== null).length)
      .toBeGreaterThan(5);

    // Each click orders the rows by the points; a change that cannot be told ("n/a") stays last
    // A rate column sorts high first, then low first
    for (const direction of ['descending', 'ascending'] as const) {
      await header
        .getByRole('button', { name: /^ChatGPT change/ })
        .first()
        .click();
      await expect(header).toHaveAttribute('aria-sort', direction);
      const cells = await columnOf(grid, /ChatGPT change/);
      const points = cells.map(pointsOf);
      const known = points.filter((value): value is number => value !== null);
      expect(known.length).toBeGreaterThan(5);
      expect(points.slice(0, known.length).every((value) => value !== null)).toBe(true);
      const expected = [...known].sort((a, b) => (direction === 'ascending' ? a - b : b - a));
      expect(known).toEqual(expected);
    }
  });

  test('cmp survives the switch between Topics and Prompts and the inspector', async ({ page }) => {
    await openPrompts(page, 1280, { cmp: 'off' });
    await expect(compareSelect(page)).toHaveText('No comparison');
    await page.getByRole('radio', { name: 'Prompts' }).click();
    await expect(page).toHaveURL(/[?&]cmp=off(&|$)/);
    await expect(promptsGrid(page).getByRole('row').nth(1)).toBeVisible();
    await promptsGrid(page).getByText(FIRST_PROMPT, { exact: true }).click();
    const inspector = inspectorOf(page);
    await expect(inspector.getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]cmp=off(&|$)/);
    await expect(page).toHaveURL(/inspect=/);
    await expect(valueOf(inspector, 'ChatGPT mention')).toContainText('answers');
    expect(await changesIn(inspector)).toEqual([]);
    await page.reload();
    await expect(page).toHaveURL(/[?&]cmp=off(&|$)/);
    await expect(inspectorOf(page).getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
    await expect(compareSelect(page)).toHaveText('No comparison');
    expect(await changesIn(inspectorOf(page))).toEqual([]);
  });

  test('the chip survives the switch between Topics and Prompts, the inspector and a reload', async ({ page }) => {
    await openPrompts(page, 1280, { detectable: 'only' }, { detectable: true });
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
      test(`has no accessibility violation on Topics, Prompts with a change column, the prompt inspector and the topic drawer at ${String(width)} px`, async ({
        page,
      }) => {
        // The detectable change is drawn, so a coloured change is among what axe measures
        await openPrompts(page, width, {}, { detectable: true });
        await awaitChanges(page);
        await expectAccessible(page);

        await visitPrompts(page, {
          tab: 'prompts',
          cols: 'prompt,mention,change_chatgpt_web,change_gemini_web',
        });
        await expect(promptsGrid(page).getByRole('columnheader', { name: /ChatGPT change/ })).toBeVisible();
        await expect.poll(async () => (await colouredIn(promptsGrid(page))).length).toBeGreaterThan(0);
        await expectAccessible(page);

        await page.goto(INSPECT_FIRST_PROMPT);
        await expect(inspectorOf(page).getByRole('tablist', { name: 'Prompt sections' })).toBeVisible();
        await expect(valueOf(inspectorOf(page), 'ChatGPT mention')).toContainText(/\d pts/);
        await expectAccessible(page);

        await page.goto(inspectTopic(PAID_SEARCH));
        const drawer = drawerOf(page, 'Paid Search');
        await expect(drawer.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
        await expect(valueOf(drawer, 'Mentioned')).toContainText(/\d pts/);
        await expectAccessible(page);
      });
    }
  });
}
