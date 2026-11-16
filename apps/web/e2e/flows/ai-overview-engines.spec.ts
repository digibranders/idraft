import { expect, test } from '@playwright/test';

import { signIn } from '../support';
import {
  BUILTIN_FAMILY,
  BUILTIN_TITLES,
  CLEANSTART_PATH,
  COULD_NOT_LOAD,
  EDITOR,
  RETRY,
  THEMES,
  WIDTHS,
  allCards,
  applyTheme,
  awaitCardReady,
  awaitTitlesReady,
  cardById,
  cardGrid,
  cardTops,
  expectNoSidewaysScroll,
  heldSummaryReads,
  installSummaryFault,
  installSummaryHold,
  openOverview,
  openSummary,
  pageHeading,
  setSummaryFault,
  setSummaryHold,
  tableButton,
} from '../support/ai-overview-engines';
import { expectNoSeriousViolations } from '../support/layouts';

/**
 * The two cards of the engines family that the AI visibility screen draws by default, the trend over time and the
 * answer outcomes, on the Fynix mock project: the Metric tabs and their address key, one platform and All platforms,
 * the Table views, a failed read, the empty project, accessibility at four widths in both themes, and no card moving
 * while its data loads. The other cards of the family stay in the Add card catalog and have unit tests.
 */
test.describe.configure({ timeout: 120_000 });

const trend = (page: Parameters<typeof cardById>[0]) => cardById(page, BUILTIN_FAMILY.rateTrend);
const outcomes = (page: Parameters<typeof cardById>[0]) => cardById(page, BUILTIN_FAMILY.outcomeMix);

test.describe('the trend and outcome cards', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('the built-in layout shows the trend and the answer outcomes with the platforms in scope', async ({ page }) => {
    await openOverview(page);
    for (const [id, title] of [
      [BUILTIN_FAMILY.rateTrend, BUILTIN_TITLES[0]],
      [BUILTIN_FAMILY.outcomeMix, BUILTIN_TITLES[1]],
    ] as const) {
      const card = cardById(page, id);
      await awaitCardReady(card);
      await expect(card.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
      await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0);
    }
    await expect(outcomes(page)).toContainText('ChatGPT');
    await expect(outcomes(page)).toContainText('Gemini');
    await expect(outcomes(page)).toContainText(/[\d,]+ answers?/);
  });

  test('the Metric tabs change the metric of the page, which is the address key and the trend title', async ({
    page,
  }) => {
    await openOverview(page);
    await awaitCardReady(trend(page));
    await trend(page).getByRole('radio', { name: 'Mention', exact: true }).click();
    await expect(page).toHaveURL(/[?&]metric=mention/);
    await expect(trend(page).getByRole('heading', { level: 2, name: 'Mention rate over time' })).toBeVisible();
    await expect(trend(page)).toContainText('a line per platform, with their average');
    await trend(page).getByRole('radio', { name: 'Share of voice', exact: true }).click();
    await expect(page).toHaveURL(/[?&]metric=sov/);
    await expect(trend(page).getByRole('heading', { level: 2, name: 'Share of voice over time' })).toBeVisible();
  });

  test('one platform draws its own line with the 95% interval, All platforms draws a line each and the average', async ({
    page,
  }) => {
    await openOverview(page, 1280, '?metric=mention&engine=chatgpt_web');
    await awaitCardReady(trend(page));
    await expect(trend(page)).toContainText('ChatGPT, with its 95% interval');
    await expect(
      trend(page)
        .getByRole('list', { name: /^Series in / })
        .getByText('Average'),
    ).toHaveCount(0);
    await openOverview(page, 1280, '?metric=mention');
    await awaitCardReady(trend(page));
    await expect(
      trend(page)
        .getByRole('list', { name: /^Series in / })
        .getByText('Average'),
    ).toBeVisible();
  });

  test('the Table view of each card shows the numbers the chart draws', async ({ page }) => {
    await openOverview(page, 1280, '?metric=mention');
    for (const card of [trend(page), outcomes(page)]) {
      await awaitCardReady(card);
      await tableButton(card).click();
      await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'true');
      await expect(card.getByRole('table').first()).toBeVisible();
      await tableButton(card).click();
      await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'false');
    }
    await tableButton(outcomes(page)).click();
    await expect(outcomes(page).getByRole('table').first()).toContainText(/\d+% \([\d,]+ \/ [\d,]+\)/);
  });

  test("a failed summary shows each card's error with Retry and Retry works", async ({ page }) => {
    await installSummaryFault(page);
    await setSummaryFault(page, true);
    await openOverview(page);
    const cards = [trend(page), outcomes(page)];

    await expect(pageHeading(page)).toBeVisible();
    for (const card of cards) {
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByText(COULD_NOT_LOAD)).toBeVisible();
      await expect(card.getByRole('button', { name: RETRY })).toBeVisible();
    }

    // The read works again: the reads are shared, so a card may recover through another's retry before its own button
    await setSummaryFault(page, false);
    for (const card of cards) {
      await expect(async () => {
        const retry = card.getByRole('button', { name: RETRY });
        if (await retry.isVisible()) await retry.click();
        await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0, { timeout: 2000 });
      }).toPass();
      await awaitCardReady(card);
    }
  });

  test('Cleanstart (platforms off) shows no cards', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(CLEANSTART_PATH);
    await expect(pageHeading(page)).toBeVisible();
    await expect(page.getByText('No AI platform is on', { exact: true })).toBeVisible();
    await expect(cardGrid(page)).toHaveCount(0);
  });

  test('a location filter of IN shows counts or says there is no rate, never a zero', async ({ page }) => {
    await openOverview(page, 1280, '?country=IN');
    for (const card of [trend(page), outcomes(page)]) {
      await awaitCardReady(card);
      await expect(card.getByText(COULD_NOT_LOAD)).toHaveCount(0);
    }
    expect(await cardGrid(page).innerText()).not.toMatch(/\bNaN\b|Infinity|\b0 of 0\b/);
  });

  for (const theme of THEMES) {
    test(`no serious or critical violation at 390, 768, 1024 and 1280 px in ${theme}`, async ({ page }) => {
      test.setTimeout(240_000);
      await openOverview(page);
      for (const width of WIDTHS) {
        await test.step(`${theme} at ${String(width)} px`, async () => {
          await page.setViewportSize({ width, height: 1100 });
          await applyTheme(page, theme);
          await awaitTitlesReady(page, BUILTIN_TITLES);
          for (const title of BUILTIN_TITLES) {
            await expect(cardGrid(page).getByText(COULD_NOT_LOAD)).toHaveCount(0);
            await expect(cardGrid(page).getByRole('heading', { level: 2, name: title })).toBeVisible();
          }
          await expectNoSidewaysScroll(page, width);
          // The cards are measured where a reader first sees them: from the top of the page (the sticky bar covers a header)
          await page.evaluate(() => window.scrollTo(0, 0));
          await expectNoSeriousViolations(page);
        });
      }
    });
  }

  test('no card moves between loading and loaded', async ({ page }) => {
    await installSummaryHold(page);
    await openOverview(page);
    await setSummaryHold(page, true);
    await page.reload();
    await expect(pageHeading(page)).toBeVisible();
    await expect.poll(() => heldSummaryReads(page)).toBeGreaterThan(0);
    const loadingTops = await cardTops(page);

    await openSummary(page);
    await awaitTitlesReady(page, BUILTIN_TITLES);
    const loadedTops: number[] = await cardTops(page);

    // Only the first row is held to its place: a skeleton stands in for a card at an estimated height, so the rows
    // under it may shift once the data is in
    const topOfGrid = loadingTops[0];
    expect(topOfGrid).toBeDefined();
    const firstRow = loadingTops.flatMap((top, index) => (top === topOfGrid ? [index] : []));
    expect(firstRow.length).toBeGreaterThan(0);
    for (const index of firstRow) expect(loadedTops[index]).toBe(loadingTops[index]);
    expect(await allCards(page).count()).toBeGreaterThan(0);
  });
});
