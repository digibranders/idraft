import { expect, test } from '@playwright/test';

import { signIn } from '../support';
import {
  ADDED_CATALOG_TITLES,
  BUILTIN_FAMILY,
  BUILTIN_TITLES,
  CLEANSTART_PATH,
  COULD_NOT_LOAD,
  EDITOR,
  FAMILY_TITLES,
  NOT_BUILT,
  RETRY,
  THEMES,
  WIDTHS,
  allCards,
  applyTheme,
  awaitCardReady,
  awaitTitlesReady,
  cardByHeading,
  cardById,
  cardGrid,
  cardTops,
  countDeltas,
  expectNoSidewaysScroll,
  firstCardTop,
  heldSummaryReads,
  installSummaryFault,
  installSummaryHold,
  openOverview,
  openSummary,
  pageHeading,
  saveEnginesLayout,
  setSummaryFault,
  setSummaryHold,
  tableButton,
} from '../support/ai-overview-engines';
import { expectNoSeriousViolations } from '../support/layouts';

/**
 * The engines cards of the AI visibility screen (WP-34, plan task T6) on the Fynix mock project: the built-in
 * layout, every card of the family through Customize, the Table view, the comparison, a failed read, the empty and
 * thin projects, accessibility at four widths in both themes, and no card moving while its data loads.
 */
test.describe.configure({ timeout: 120_000 });

/** "612 of 1,800 answers": a count of what the figure rests on, as the cells of the rate Table views write it. */
const K_OF_N = /\d[\d,]* of [\d,]+ (?:valid )?(?:answers?|prompts?|citation units?)/;
/** What What changed may say instead when it has no answer counts to give: engines, domains or days compared. */
const ANY_COUNT = /\d[\d,]* (?:of [\d,]+ )?(?:answers?|prompts?|engines?|domains?|days?|citation units?)/;

/**
 * What each card's Table view must show, by the exact heading of the card. The rate cards write "k of n answers" in
 * their cells (`rateText`, `tip`, `shareValid`, `countText`). Four cards do not: "AI by engine" gives k and n in the
 * columns "Answers that count" and "Valid answers"; the waterfall, the agreement and the coverage card put their
 * counts in columns of their own ("Largest change", "Of compared prompts", "Of prompts in scope"); the country card
 * has an "Answers" column. Those four are held to their header words, which are the same whatever the data.
 */
const TABLE_WORDS: Record<(typeof FAMILY_TITLES)[number], RegExp> = {
  'What changed': ANY_COUNT,
  'Mention rate by engine': K_OF_N,
  'Named and cited, by engine': K_OF_N,
  'Mention rate trend': K_OF_N,
  'Prompt movers': K_OF_N,
  'This period vs the last': K_OF_N,
  'What moved the rate': /Largest change/,
  'AI by engine': /Answers that count/,
  'From answer to citation, by engine': K_OF_N,
  'Answers behind the numbers': /Of prompts in scope/,
  'Engine agreement': /Of compared prompts/,
  'By country': /Answers/,
};

test.describe('the engines cards', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('Fynix: the built-in layout shows What changed, Rates by engine over time and Named and cited as real cards', async ({
    page,
  }) => {
    await openOverview(page);
    const cards = [
      [BUILTIN_FAMILY.changeSummary, BUILTIN_TITLES[0]],
      [BUILTIN_FAMILY.rateTrend, BUILTIN_TITLES[1]],
      [BUILTIN_FAMILY.outcomeMix, BUILTIN_TITLES[2]],
    ] as const;
    for (const [id, title] of cards) {
      const card = cardById(page, id);
      await awaitCardReady(card);
      await expect(card.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
      await expect(card.getByText(NOT_BUILT)).toHaveCount(0);
      await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0);
    }
    // Two engines are on in Fynix: one chart each in the trend card, one row each in the outcome card
    await expect(cardById(page, BUILTIN_FAMILY.rateTrend)).toContainText('ChatGPT');
    await expect(cardById(page, BUILTIN_FAMILY.rateTrend)).toContainText('Gemini');
    await expect(cardById(page, BUILTIN_FAMILY.outcomeMix)).toContainText(/\d+ valid answers?, \d+ prompts?/);
  });

  test('every card of the family can be added in Customize and renders at 1280 px', async ({ page }) => {
    await saveEnginesLayout(page, ADDED_CATALOG_TITLES);
    await expect(allCards(page)).toHaveCount(12);
    await expectNoSidewaysScroll(page, 1280);
    for (const title of FAMILY_TITLES) {
      await test.step(title, async () => {
        const card = cardByHeading(page, title);
        await awaitCardReady(card);
        await expect(card.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
        await expect(card.getByText(NOT_BUILT)).toHaveCount(0);
        await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0);
        await expect(card.getByRole('button', { name: RETRY })).toHaveCount(0);
      });
    }
    expect(await cardGrid(page).innerText()).not.toMatch(/[\u{2013}\u{2014}]/u);
  });

  test('the Table toggle of each card shows the counts the figures rest on', async ({ page }) => {
    await saveEnginesLayout(page, ADDED_CATALOG_TITLES);
    for (const title of FAMILY_TITLES) {
      await test.step(title, async () => {
        const card = cardByHeading(page, title);
        await awaitCardReady(card);
        await expect(tableButton(card)).toBeVisible();
        await tableButton(card).click();
        await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'true');
        await expect(card.getByRole('table').first()).toContainText(TABLE_WORDS[title]);
        await tableButton(card).click();
        await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'false');
      });
    }
  });

  test('compare off removes the dashed lines and the changes, compare on shows them', async ({ page }) => {
    await saveEnginesLayout(page, ['AI by engine', 'This period vs the last'], { hideOthers: false });
    const trend = cardById(page, BUILTIN_FAMILY.rateTrend);
    const summary = cardById(page, BUILTIN_FAMILY.changeSummary);
    const byEngine = cardByHeading(page, 'AI by engine');
    const comparison = cardByHeading(page, 'This period vs the last');
    const OFF_FACT = 'The comparison with the previous period is off, so nothing is said about change.';

    await test.step('the comparison is on by default', async () => {
      for (const card of [trend, summary, byEngine, comparison]) await awaitCardReady(card);
      await expect(trend).toContainText('The dashed line is the previous window, week for week.');
      await expect(summary).not.toContainText(OFF_FACT);
      await expect(comparison.getByText('The comparison is off')).toHaveCount(0);
      // Without a change on show the check below would prove nothing
      expect(await countDeltas(byEngine)).toBeGreaterThan(0);
    });

    await test.step('cmp=off takes the previous lines and every change away', async () => {
      await openOverview(page, 1280, '?cmp=off');
      for (const card of [trend, summary, byEngine, comparison]) await awaitCardReady(card);
      await expect(trend).not.toContainText('The dashed line is the previous window');
      await expect(summary).toContainText(OFF_FACT);
      await expect(comparison.getByText('The comparison is off')).toBeVisible();
      expect(await countDeltas(byEngine)).toBe(0);
    });
  });

  test("a failed summary shows each card's error with Retry and Retry works", async ({ page }) => {
    await installSummaryFault(page);
    await setSummaryFault(page, true);
    await openOverview(page);
    const cards = [BUILTIN_FAMILY.changeSummary, BUILTIN_FAMILY.rateTrend, BUILTIN_FAMILY.outcomeMix].map((id) =>
      cardById(page, id),
    );

    await expect(pageHeading(page)).toBeVisible();
    for (const card of cards) {
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByText(COULD_NOT_LOAD)).toBeVisible();
      await expect(card.getByRole('button', { name: RETRY })).toBeVisible();
    }

    // The read works again: Try again brings the figures back, on every card (the reads are shared, so a card may
    // recover through another's retry before its own button is pressed)
    await setSummaryFault(page, false);
    for (const card of cards) {
      await expect(async () => {
        const retry = card.getByRole('button', { name: RETRY });
        if (await retry.isVisible()) await retry.click();
        await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0, { timeout: 2000 });
      }).toPass();
      await awaitCardReady(card);
      await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0);
    }
  });

  test('Cleanstart (engines off) shows no cards', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(CLEANSTART_PATH);
    await expect(pageHeading(page)).toBeVisible();
    await expect(page.getByText('No AI engine is on', { exact: true })).toBeVisible();
    await expect(cardGrid(page)).toHaveCount(0);
    await expect(page.getByText(NOT_BUILT)).toHaveCount(0);
  });

  test('a country filter of IN shows counts and thin states, not zeros', async ({ page }) => {
    // Fynix asks one prompt in India, with 7 valid ChatGPT answers and 8 valid Gemini answers (pinned by the
    // world facts test of use-card-data.test.tsx): enough for a rate, so the cards show counts, never an invented 0
    await openOverview(page, 1280, '?country=IN');
    for (const id of [BUILTIN_FAMILY.changeSummary, BUILTIN_FAMILY.rateTrend, BUILTIN_FAMILY.outcomeMix]) {
      const card = cardById(page, id);
      await awaitCardReady(card);
      await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0);
    }
    const outcome = cardById(page, BUILTIN_FAMILY.outcomeMix);
    await expect(outcome).toContainText('7 valid answers, 1 prompt');
    await expect(outcome).toContainText('8 valid answers, 1 prompt');
    await expect(outcome).not.toContainText('No valid answers');
    expect(await cardGrid(page).innerText()).not.toMatch(/\bNaN\b|Infinity|\b0 of 0\b/);
  });

  for (const theme of THEMES) {
    test.describe(`axe, ${theme}`, () => {
      test(`no serious or critical violation at 390, 768, 1024 and 1280 px in ${theme}`, async ({ page }) => {
        test.setTimeout(240_000);
        const titles = [...BUILTIN_TITLES, 'Prompt movers', 'AI by engine', 'By country'];
        await saveEnginesLayout(page, ['Prompt movers', 'AI by engine', 'By country']);
        for (const width of WIDTHS) {
          await test.step(`${theme} at ${String(width)} px`, async () => {
            await page.setViewportSize({ width, height: 1100 });
            await applyTheme(page, theme);
            await awaitTitlesReady(page, titles);
            for (const title of titles) {
              await expect(cardByHeading(page, title).getByText(COULD_NOT_LOAD)).toHaveCount(0);
            }
            await expectNoSidewaysScroll(page, width);
            await expectNoSeriousViolations(page);
          });
        }
      });
    });
  }

  test('no card moves between loading and loaded', async ({ page }) => {
    await installSummaryHold(page);
    await saveEnginesLayout(page, ADDED_CATALOG_TITLES);

    // Load the page again with the summary held back: the cards are in their loading state
    await setSummaryHold(page, true);
    await page.reload();
    await expect(pageHeading(page)).toBeVisible();
    await expect(allCards(page)).toHaveCount(12);
    await expect.poll(() => heldSummaryReads(page)).toBeGreaterThan(0);
    const loadingTops = await cardTops(page);
    const loadingFirst = await firstCardTop(page);

    await openSummary(page);
    await awaitTitlesReady(page, FAMILY_TITLES);
    const loadedTops: number[] = await cardTops(page);
    expect(await firstCardTop(page)).toBe(loadingFirst);

    // Only the first row is held to its place. A skeleton stands in for a card at an estimated height (plan
    // deviation: the stand-ins are within about 70 px of the loaded card at 1280 px and 40 to 250 px off at 390 px), so
    // the rows under the first may shift once the data is in. What is guaranteed is that nothing moves above or
    // inside the first row, which is what the viewer is reading while the page loads.
    const topOfGrid = loadingTops[0];
    expect(topOfGrid).toBeDefined();
    const firstRow = loadingTops.flatMap((top, index) => (top === topOfGrid ? [index] : []));
    expect(firstRow.length).toBeGreaterThan(0);
    for (const index of firstRow) expect(loadedTops[index]).toBe(loadingTops[index]);
  });
});
