import { expect, test } from '@playwright/test';

import { signIn } from '../support';
import {
  EDITOR,
  PRESET_FAMILY,
  RETRY,
  THEMES,
  TRACKED_SET,
  WIDTHS,
  applyTheme,
  awaitCardReady,
  awaitFamilyReady,
  cardById,
  cardGrid,
  expectNoSidewaysScroll,
  familyCards,
  installSummaryFault,
  openOverview,
  pageHeading,
  saveFamilyLayout,
  setSummaryFault,
  tableButton,
} from '../support/ai-overview-competitors';
import { expectNoSeriousViolations } from '../support/layouts';

/**
 * The three competitor cards of the AI visibility screen (Share of voice, Share of voice over time, Competitor gap):
 * they follow the page scope, so the Platform of the page decides what they draw and they have no platform option.
 * The Competitive preset holds all three; the checks are the platform scope, the Table view, the competitor names as
 * buttons, every card at four widths in both themes, and a failed read.
 */
test.describe.configure({ timeout: 120_000 });

test.describe('the competitor cards', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('All platforms draws the average of the platforms and names how many took part', async ({ page }) => {
    await saveFamilyLayout(page);
    await awaitFamilyReady(page);
    const share = cardById(page, PRESET_FAMILY.shareOfVoice);
    await expect(share.getByRole('heading', { level: 2, name: 'Share of voice' })).toBeVisible();
    await expect(share).toContainText(/avg of \d+ platforms?/);
    await expect(share).toContainText(TRACKED_SET);
    await expect(cardById(page, PRESET_FAMILY.overTime)).toContainText(/avg of \d+ platforms?, stacked to 100%/);
    await expect(cardById(page, PRESET_FAMILY.lostTo).getByRole('columnheader', { name: 'They lead' })).toBeVisible();
  });

  test('one platform in the address gives that platform its own figures with the answers behind them', async ({
    page,
  }) => {
    await saveFamilyLayout(page);
    await openOverview(page, 1280, '?engine=chatgpt_web');
    await awaitFamilyReady(page);
    const share = cardById(page, PRESET_FAMILY.shareOfVoice);
    await expect(share).toContainText(/of [\d,]+ answers? that mention a tracked brand/);
    await expect(share).not.toContainText(/avg of/);
    await expect(cardById(page, PRESET_FAMILY.overTime)).toContainText('stacked to 100%');
  });

  test('a competitor name is a button that opens its drawer, and your own row is not', async ({ page }) => {
    await saveFamilyLayout(page);
    const share = cardById(page, PRESET_FAMILY.shareOfVoice);
    await awaitCardReady(share);
    expect(await share.getByRole('button', { name: /^Open / }).count()).toBeGreaterThan(0);
    await expect(share.getByRole('button', { name: /\(you\)/ })).toHaveCount(0);
    const gap = cardById(page, PRESET_FAMILY.lostTo);
    await awaitCardReady(gap);
    await expect(gap.getByRole('button', { name: /^Prompts where you lead: \d+ of \d+$/ }).first()).toBeVisible();
  });

  test('the Table view of Share of voice lists every brand with its share', async ({ page }) => {
    await saveFamilyLayout(page);
    const card = cardById(page, PRESET_FAMILY.shareOfVoice);
    await awaitCardReady(card);
    await tableButton(card).click();
    await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'true');
    const table = card.getByRole('table');
    for (const name of ['Brand', 'Share of voice']) {
      await expect(table.getByRole('columnheader', { name })).toBeVisible();
    }
    expect(await table.getByRole('row').count()).toBeGreaterThan(2);
    await tableButton(card).click();
    await expect(tableButton(card)).toHaveAttribute('aria-pressed', 'false');
  });

  test('every card renders at 390, 768, 1024 and 1280 px in light and dark with no serious axe violation', async ({
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
    const card = cardById(page, PRESET_FAMILY.shareOfVoice);
    await card.getByRole('button', { name: RETRY }).click();
    await expect(card.getByText(/^Could not load /)).toHaveCount(0);
    await awaitCardReady(card);
    await expect(card).toContainText(TRACKED_SET);
  });
});
