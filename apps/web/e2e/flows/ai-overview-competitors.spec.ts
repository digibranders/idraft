import { expect, test, type Locator, type Page } from '@playwright/test';

import { signIn } from '../support';
import {
  EDITOR,
  PRESET_FAMILY,
  RETRY,
  THEMES,
  TRACKED_SET,
  WIDTHS,
  addCard,
  applyTheme,
  awaitCardReady,
  awaitFamilyReady,
  cardById,
  cardGrid,
  cardTitled,
  changeEngine,
  countDeltas,
  expectNoSidewaysScroll,
  familyCards,
  installSummaryFault,
  openOverview,
  pageHeading,
  saveFamilyLayout,
  saveLayout,
  setSummaryFault,
  startCustomizing,
  startFrom,
  tableButton,
} from '../support/ai-overview-competitors';
import { expectNoSeriousViolations } from '../support/layouts';

/**
 * The competitors cards of the AI visibility screen (WP-35, plan task T7): the Competitive preset, the other cards
 * through the Add card slot, a share of voice figure with its count, a Table view, an engine option, every card
 * at four widths in both themes, a failed read, the comparison off, and the keyboard.
 */
test.describe.configure({ timeout: 120_000 });

/** The sum of the changes the cards of the family show. */
async function familyDeltas(page: Page): Promise<number> {
  let total = 0;
  for (const { card } of familyCards(page)) total += await countDeltas(card);
  return total;
}

/** Presses Tab until the focus is on `target`; it takes a few presses to cross a card's own controls. */
async function tabTo(page: Page, target: Locator, maxPresses = 12): Promise<void> {
  const focused = target.and(page.locator(':focus'));
  const trail: string[] = [];
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    if ((await focused.count()) > 0) return;
    trail.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        return `${element?.tagName ?? 'none'} ${element?.getAttribute('aria-label') ?? element?.textContent?.slice(0, 30) ?? ''}`;
      }),
    );
  }
  throw new Error(`The focus did not reach the target in ${String(maxPresses)} presses of Tab: ${trail.join(' | ')}`);
}

test.describe('the competitors cards', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('the Competitive preset shows its share of voice cards with a tracked set footnote', async ({ page }) => {
    await test.step('start from Competitive and save', async () => {
      await openOverview(page);
      await startCustomizing(page);
      await startFrom(page, 'Competitive');
      await saveLayout(page);
      await expect(cardGrid(page).locator('[data-layout-card]')).toHaveCount(9);
      for (const id of Object.values(PRESET_FAMILY)) await awaitCardReady(cardById(page, id));
    });

    await test.step('each share of voice card names its engine and the tracked set', async () => {
      for (const [id, title] of [
        [PRESET_FAMILY.shareOfVoiceChatgpt, 'Share of voice on ChatGPT'],
        [PRESET_FAMILY.shareOfVoiceGemini, 'Share of voice on Gemini'],
      ] as const) {
        const card = cardById(page, id);
        await expect(card.getByRole('heading', { level: 2, name: title })).toBeVisible();
        await expect(card).toContainText(TRACKED_SET);
      }
    });

    await test.step('add the other cards of the family and give one instance another engine', async () => {
      await startCustomizing(page);
      await addCard(page, 'Share of voice rank');
      await addCard(page, 'AI opportunities');
      await changeEngine(page, PRESET_FAMILY.overTime, 'Share of voice over time: ChatGPT', 'Gemini');
      await saveLayout(page);
      await awaitFamilyReady(page);
      await expect(cardGrid(page).locator('[data-layout-card]')).toHaveCount(11);
      await expect(
        cardById(page, PRESET_FAMILY.overTime).getByRole('heading', {
          level: 2,
          name: 'Share of voice over time on Gemini',
        }),
      ).toBeVisible();
      await expect(cardTitled(page, /^Share of voice rank on /)).toBeVisible();
      await expect(cardTitled(page, 'AI opportunities')).toBeVisible();
    });

    const card = cardById(page, PRESET_FAMILY.shareOfVoiceChatgpt);
    await test.step('a share of voice percent comes with its count and its denominator', async () => {
      const row = card.getByText(/share of voice, named in [\d,]+ of [\d,]+ answers?/).first();
      const match = /: (\d+%|<0\.1%) share of voice, named in ([\d,]+) of ([\d,]+) answers?/.exec(
        (await row.textContent()) ?? '',
      );
      if (match === null) throw new Error('The first row of share of voice has no percent with a count');
      const named = Number((match[2] ?? '').replaceAll(',', ''));
      const answers = Number((match[3] ?? '').replaceAll(',', ''));
      expect(answers).toBeGreaterThan(0);
      expect(named).toBeLessThanOrEqual(answers);
      await expect(card).toContainText(/of [\d,]+ answers? naming a tracked brand/);
    });

    await test.step('the Table view lists every brand with the counts', async () => {
      await tableButton(card).click();
      await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'true');
      const table = card.getByRole('table');
      for (const name of ['Brand', 'Share of voice', 'Named in']) {
        await expect(table.getByRole('columnheader', { name })).toBeVisible();
      }
      expect(await table.getByRole('row').count()).toBeGreaterThan(2);
      await expect(table).toContainText(/named in [\d,]+ of [\d,]+ answers?/);
      await tableButton(card).click();
      await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'false');
    });
  });

  test('every card of the family renders at 390, 768, 1024 and 1280 px in light and dark with no serious axe violation', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await saveFamilyLayout(page);
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        await test.step(`${theme} at ${String(width)} px`, async () => {
          await page.setViewportSize({ width, height: 1100 });
          await applyTheme(page, theme);
          await awaitFamilyReady(page);
          for (const { card } of familyCards(page)) {
            await expect(card.getByText(/^Could not load /)).toHaveCount(0);
            await expect(card.getByRole('button', { name: RETRY })).toHaveCount(0);
          }
          await expectNoSidewaysScroll(page, width);
          expect(await cardGrid(page).innerText()).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
          await expectNoSeriousViolations(page);
        });
      }
    }
  });

  test('a failed summary read shows Retry on the cards and the page keeps its header', async ({ page }) => {
    await installSummaryFault(page);
    await saveFamilyLayout(page);
    await setSummaryFault(page, true);
    await page.reload();

    await expect(pageHeading(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible();
    for (const { card } of familyCards(page)) {
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByText(/^Could not load /)).toBeVisible();
      await expect(card.getByRole('button', { name: RETRY })).toBeVisible();
    }

    // The read works again: Try again on one card brings its figures back
    await setSummaryFault(page, false);
    const card = cardById(page, PRESET_FAMILY.shareOfVoiceChatgpt);
    await card.getByRole('button', { name: RETRY }).click();
    await expect(card.getByText(/^Could not load /)).toHaveCount(0);
    await awaitCardReady(card);
    await expect(card).toContainText(TRACKED_SET);
  });

  test('compare off hides every delta', async ({ page }) => {
    await saveFamilyLayout(page);
    await awaitFamilyReady(page);
    // The comparison is on by default, and the family shows changes: without them the check below proves nothing
    expect(await familyDeltas(page)).toBeGreaterThan(0);

    await openOverview(page, 1280, '?cmp=off');
    await awaitFamilyReady(page);
    expect(await familyDeltas(page)).toBe(0);
  });

  test('the keyboard path reaches the Table view button and a heat cell', async ({ page }) => {
    await saveFamilyLayout(page);
    const card = cardById(page, PRESET_FAMILY.coMentions);
    await awaitCardReady(card);

    // Tab starts from the title of the card: a click on text does not move the focus start in a headless window
    await card.getByRole('heading', { level: 2 }).evaluate((title: HTMLElement) => {
      title.tabIndex = -1;
      title.focus();
    });
    await tabTo(page, tableButton(card));
    await page.keyboard.press('Enter');
    await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'false');

    // The grid is one tab stop; the arrow keys move inside it
    const cells = card.locator('[data-cell]');
    await tabTo(page, cells);
    const focusedCell = card.locator('[data-cell]:focus');
    const first = await focusedCell.getAttribute('data-cell');
    await page.keyboard.press('ArrowRight');
    await expect(focusedCell).toHaveCount(1);
    await expect(focusedCell).not.toHaveAttribute('data-cell', first ?? '');
  });
});
