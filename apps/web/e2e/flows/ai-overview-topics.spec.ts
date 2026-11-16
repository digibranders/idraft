import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { expectAccessible, signIn } from '../support';
import {
  BOTH_PLATFORM_COLUMNS,
  DENSITIES,
  EDITOR,
  EXTREMES_TITLE,
  HEATMAP_TITLE,
  OVERLAP_NOTE,
  RETRY,
  THEMES,
  THIN_ANSWERS,
  THIN_TOPIC,
  WIDTHS,
  applyDisplay,
  awaitCardReady,
  awaitEveryCardReady,
  cardGrid,
  customizeButton,
  dashesIn,
  expectNoSidewaysScroll,
  extremesCard,
  focusTitleOf,
  groupSelect,
  heatCell,
  heatmapCard,
  heatmapGrid,
  installSummaryFault,
  installSummaryHold,
  installThinCells,
  pageHeading,
  platformSelect,
  releaseSummary,
  saveGroupLayout,
  setSummaryFault,
  setThinCells,
  tabTo,
} from '../support/ai-overview-topics';

/**
 * The groups cards of the AI visibility screen: the heat map (one flat level of groups, a column per platform, the
 * measure tabs, a click that opens the group in the page) and the strongest and weakest groups, which give way to the
 * group against all groups when a group is chosen; the prompts of the chosen group with their Back button; the honest
 * states (too few answers, none, a failed read, loading), the keyboard, and the page at four widths in both themes and
 * both table densities. The Fynix mock asks two platforms, ChatGPT and Gemini; Eventus Security is seeded in the dev
 * server only and is not part of this spec.
 */
test.describe.configure({ timeout: 180_000 });

/** The group Paid Search of the Fynix mock (`src/mocks/entity-fixtures.ts`): a top level group with no group below it. */
const PAID_SEARCH = mockId('term', 6);
const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';

/** The query of the address the page is at, once it holds `key`. */
async function queryOf(page: Page, key: string): Promise<URLSearchParams> {
  await expect(page).toHaveURL(new RegExp(`[?&]${key}=`));
  return new URL(page.url()).searchParams;
}

/** The names of the columns of the heat map, in order. */
const columnNames = (card: Locator): Promise<string[]> =>
  heatmapGrid(card)
    .getByRole('columnheader')
    .evaluateAll((headers) => headers.map((header) => (header.textContent ?? '').trim()));

test.describe('the groups cards', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('the heat map is one flat level of groups by platform, with counts in the cell names and an average column', async ({
    page,
  }) => {
    await saveGroupLayout(page);
    const card = heatmapCard(page);
    await expect(card.getByRole('heading', { level: 2, name: HEATMAP_TITLE })).toBeVisible();

    await test.step('a column per asked platform, AI Overview not collected, then the average of the two', async () => {
      expect(await columnNames(card)).toEqual(BOTH_PLATFORM_COLUMNS);
      // AI Mode is off for Fynix: a platform that is not asked is not a column
      await expect(heatmapGrid(card).getByRole('columnheader', { name: /AI Mode/ })).toHaveCount(0);
    });

    await test.step('rows are groups with no group below them: no chevron, no parent row', async () => {
      await expect(heatmapGrid(card).getByRole('rowheader', { name: THIN_TOPIC, exact: true })).toBeVisible();
      await expect(heatmapGrid(card).getByRole('rowheader', { name: 'SEO', exact: true })).toHaveCount(0);
      await expect(heatmapGrid(card).getByRole('rowheader', { name: 'Content Marketing', exact: true })).toHaveCount(0);
      await expect(card.getByRole('button', { name: /^Expand / })).toHaveCount(0);
    });

    await test.step('every platform cell is named with its rate and its answers', async () => {
      for (const platform of ['ChatGPT', 'Gemini']) {
        const name = await heatCell(card, THIN_TOPIC, platform).first().getByRole('link').getAttribute('aria-label');
        const counts = /: (\d+(?:\.\d+)?)%, ([\d,]+) of ([\d,]+) answers?/.exec(name ?? '');
        if (counts === null) throw new Error(`The cell ${THIN_TOPIC} on ${platform} has no counts: ${String(name)}`);
        expect(Number((counts[2] ?? '').replaceAll(',', ''))).toBeLessThanOrEqual(
          Number((counts[3] ?? '').replaceAll(',', '')),
        );
      }
      const average = heatmapGrid(card).getByRole('link', { name: new RegExp(`^${THIN_TOPIC}, avg of 2: \\d+%, `) });
      await expect(average).toHaveAttribute(
        'aria-label',
        /Equal weight average of ChatGPT and Gemini, each platform counting once\./,
      );
    });

    await test.step('AI Overview says it is not collected yet and is never a rate', async () => {
      const overview = heatCell(card, THIN_TOPIC, 'AI Overview');
      await expect(overview).toHaveText('n/a');
      await expect(overview).toHaveAttribute('aria-label', `${THIN_TOPIC} on AI Overview: not collected yet`);
      await expect(overview.getByRole('link')).toHaveCount(0);
    });

    await test.step('the footnote says the groups overlap and the average gives each platform one weight', async () => {
      await expect(card).toContainText(OVERLAP_NOTE);
      await expect(card).toContainText('The average column gives each platform that shows a rate the same weight');
    });
  });

  test('the measure tabs write the metric key of the page and change what the cells read', async ({ page }) => {
    await saveGroupLayout(page);
    const card = heatmapCard(page);
    const tabs = card.getByRole('radiogroup', { name: 'Metric' });
    await expect(tabs.getByRole('radio', { name: 'Visibility' })).toBeChecked();
    await expect(card).toContainText('AI visibility rate');

    await tabs.getByRole('radio', { name: 'Mention' }).click();
    expect((await queryOf(page, 'metric')).get('metric')).toBe('mention');
    await expect(card).toContainText('Mention rate');
    await expect(card).not.toContainText('ai visibility');
    await awaitCardReady(card);

    await tabs.getByRole('radio', { name: 'Share of voice' }).click();
    expect((await queryOf(page, 'metric')).get('metric')).toBe('sov');
    await tabs.getByRole('radio', { name: 'Visibility' }).click();
    await expect(page).not.toHaveURL(/metric=/);
  });

  test('a cell sets the group and the platform in the page, the card shows the prompts of the group, and Back restores the platform', async ({
    page,
  }) => {
    await saveGroupLayout(page);
    const heatmap = heatmapCard(page);

    await heatCell(heatmap, THIN_TOPIC, 'Gemini').getByRole('link').click();
    const query = await queryOf(page, 'topic');
    expect(query.get('topic')).toBe(PAID_SEARCH);
    expect(query.get('engine')).toBe(GEMINI);
    expect(new URL(page.url()).pathname).toBe('/digibranders/fynix/ai');
    await expect(groupSelect(page, THIN_TOPIC)).toBeVisible();
    await expect(platformSelect(page, 'Gemini')).toBeVisible();

    await test.step('the heat map slot is the prompts of the group with a link to the Prompts page', async () => {
      await awaitCardReady(heatmap);
      await expect(heatmap.getByRole('heading', { level: 2, name: `Prompts in ${THIN_TOPIC}` })).toBeVisible();
      await expect(heatmap.getByRole('table', { name: `Prompts in ${THIN_TOPIC}` })).toBeVisible();
      const prompts = heatmap.getByRole('link', { name: /^View all \d+ prompts?$/ });
      const href = (await prompts.getAttribute('href')) ?? '';
      const link = new URL(href, page.url());
      expect(link.pathname).toBe('/digibranders/fynix/ai/prompts');
      expect(link.searchParams.get('topic')).toBe(PAID_SEARCH);
      expect(link.searchParams.get('engine')).toBe(GEMINI);
    });

    await test.step('the extremes slot is the group against all groups, every platform whatever the page says', async () => {
      const extremes = extremesCard(page);
      await awaitCardReady(extremes);
      await expect(extremes.getByRole('heading', { level: 2, name: `${THIN_TOPIC} vs all groups` })).toBeVisible();
      await expect(extremes.getByRole('listitem')).toHaveCount(4);
      await expect(extremes).toContainText('AI Overview');
      await expect(extremes).toContainText('Not collected yet');
    });

    await test.step('a prompt opens on the Prompts page with the group and the platform carried', async () => {
      const first = heatmap
        .getByRole('table', { name: `Prompts in ${THIN_TOPIC}` })
        .getByRole('link')
        .first();
      const link = new URL((await first.getAttribute('href')) ?? '', page.url());
      expect(link.pathname).toBe('/digibranders/fynix/ai/prompts');
      expect(link.searchParams.get('inspect')).toMatch(/^prompt:/);
      expect(link.searchParams.get('topic')).toBe(PAID_SEARCH);
      expect(link.searchParams.get('engine')).toBe(GEMINI);
    });

    await test.step('Back goes to all groups on the platform the person came from', async () => {
      await heatmap.getByRole('button', { name: 'Back to all groups' }).click();
      await expect(page).not.toHaveURL(/topic=/);
      await expect(page).not.toHaveURL(/engine=/);
      await expect(groupSelect(page)).toBeVisible();
      await expect(platformSelect(page)).toBeVisible();
      await awaitCardReady(heatmap);
      await expect(heatmapGrid(heatmap)).toBeVisible();
    });
  });

  test('the top and bottom groups show 3 or 5 a side from 4 groups with a rate, and name the measure as written', async ({
    page,
  }) => {
    await saveGroupLayout(page);
    const card = extremesCard(page);
    await expect(card.getByRole('heading', { level: 2, name: EXTREMES_TITLE })).toBeVisible();
    await expect(card).toContainText('AI visibility rate');
    const strongest = card.getByRole('list', { name: /^Strongest groups by / });
    const weakest = card.getByRole('list', { name: /^Weakest groups by / });
    await expect(strongest).toBeVisible();
    await expect(weakest).toBeVisible();
    // No group is on both sides
    const names = async (list: Locator): Promise<string[]> =>
      list.getByRole('listitem').evaluateAll((items) => items.map((item) => (item.textContent ?? '').trim()));
    const sides = [...(await names(strongest)), ...(await names(weakest))].map((text) => text.replace(/\d.*$/, ''));
    expect(new Set(sides).size).toBe(sides.length);
    await expect(card).toContainText(OVERLAP_NOTE);
  });

  test('the page scope against the heat map: a platform or a group chosen in the bar keeps every platform column and then shows the prompts', async ({
    page,
  }) => {
    await saveGroupLayout(page);
    const heatmap = heatmapCard(page);

    await test.step('a platform in the bar highlights its column and keeps all of them', async () => {
      await platformSelect(page).click();
      await page.getByRole('option', { name: 'Gemini', exact: true }).click();
      expect((await queryOf(page, 'engine')).get('engine')).toBe(GEMINI);
      await awaitCardReady(heatmap);
      expect(await columnNames(heatmap)).toEqual(BOTH_PLATFORM_COLUMNS);
    });

    await test.step('a group in the bar turns the card into its prompts, and the URL survives a reload', async () => {
      await groupSelect(page).click();
      await page.getByRole('option', { name: THIN_TOPIC, exact: true }).click();
      expect((await queryOf(page, 'topic')).get('topic')).toBe(PAID_SEARCH);
      await awaitCardReady(heatmap);
      await expect(heatmap.getByRole('heading', { level: 2, name: `Prompts in ${THIN_TOPIC}` })).toBeVisible();
      const scoped = new URL(page.url()).search;
      await page.reload();
      await expect(pageHeading(page)).toBeVisible();
      expect(new URL(page.url()).search).toBe(scoped);
      await awaitCardReady(heatmap);
      await expect(heatmap.getByRole('heading', { level: 2, name: `Prompts in ${THIN_TOPIC}` })).toBeVisible();
    });
  });

  test('a thin cell says its answers and prints no percent; no cell says 0% for an unknown', async ({ page }) => {
    await installThinCells(page);
    await saveGroupLayout(page);
    await setThinCells(page, true);
    await page.reload();
    const card = heatmapCard(page);
    await awaitCardReady(card);

    await test.step('2 of 3 answers is three answers and no percent, in the cell and in its name', async () => {
      const thin = heatCell(card, THIN_TOPIC, 'ChatGPT');
      await expect(thin).toHaveText(`${String(THIN_ANSWERS)} ans`);
      await expect(thin).not.toContainText('%');
      const name = await thin.getAttribute('aria-label');
      expect(name).not.toContain('%');
    });

    await test.step('no answer says n/a, is no link, and is never a rate of 0', async () => {
      const none = heatCell(card, THIN_TOPIC, 'Gemini');
      await expect(none).toHaveText('n/a');
      await expect(none).not.toContainText('%');
      await expect(none.getByRole('link')).toHaveCount(0);
      await expect(none).not.toHaveAttribute('aria-label', /%/);
    });

    await test.step('no cell of the grid reads 0%', async () => {
      const texts = await heatmapGrid(card).getByRole('gridcell').allInnerTexts();
      expect(texts.filter((text) => /^0(?:\.0)?%$/.test(text.trim()))).toEqual([]);
    });
  });

  test('a failed summary shows the card error with Retry and Retry recovers', async ({ page }) => {
    await installSummaryFault(page);
    await saveGroupLayout(page);
    await setSummaryFault(page, true);
    await page.reload();

    await expect(pageHeading(page)).toBeVisible();
    await expect(customizeButton(page)).toBeVisible();
    for (const card of [heatmapCard(page), extremesCard(page)]) {
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByText(/ could not be read$/)).toBeVisible();
      await expect(card.getByRole('button', { name: RETRY })).toBeVisible();
    }

    // The read works again: Try again on the heat map brings its figures back
    await setSummaryFault(page, false);
    const card = heatmapCard(page);
    await card.getByRole('button', { name: RETRY }).click();
    await expect(card.getByText(/ could not be read$/)).toHaveCount(0);
    await awaitCardReady(card);
    await expect(heatmapGrid(card).getByRole('rowheader').first()).toBeVisible();
  });

  test('loading shows skeletons and no spinner', async ({ page }) => {
    await saveGroupLayout(page);
    await installSummaryHold(page);
    await page.reload();
    await expect(pageHeading(page)).toBeVisible();

    const card = heatmapCard(page);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('section[aria-busy="true"]')).toBeVisible();
    await expect(card.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(cardGrid(page).locator('[data-slot="spinner"], [role="progressbar"]')).toHaveCount(0);
    await expect(heatmapGrid(card)).toHaveCount(0);

    await releaseSummary(page);
    await awaitCardReady(card);
    await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(0);
    await expect(heatmapGrid(card).getByRole('rowheader').first()).toBeVisible();
  });

  test('keyboard: Tab reaches the grid, arrows move between cells, Enter on a cell opens the group in the page', async ({
    page,
  }) => {
    await saveGroupLayout(page);
    const card = heatmapCard(page);
    const focusedCell = card.locator('[data-cell]:focus');

    await test.step('Tab reaches the grid as one stop, on its first cell', async () => {
      await focusTitleOf(card);
      await tabTo(page, card.locator('[data-cell]'));
      await expect(focusedCell).toHaveAttribute('data-cell', '0:0');
    });

    await test.step('Enter on a platform cell opens the group on that platform, in this page', async () => {
      const target = card.getByRole('link', { name: new RegExp(`^${THIN_TOPIC} on ChatGPT: `) });
      await target.focus();
      await page.keyboard.press('Enter');
      const query = await queryOf(page, 'topic');
      expect(query.get('topic')).toBe(PAID_SEARCH);
      expect(query.get('engine')).toBe(CHATGPT);
      expect(new URL(page.url()).pathname).toBe('/digibranders/fynix/ai');
      await expect(card.getByRole('heading', { level: 2, name: `Prompts in ${THIN_TOPIC}` })).toBeVisible();
    });
  });

  test('axe: no serious or critical violation at 390, 768, 1024 and 1280 px, light and dark, Default and Compact', async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await saveGroupLayout(page);
    for (const theme of THEMES) {
      for (const density of DENSITIES) {
        for (const width of WIDTHS) {
          await test.step(`${theme}, ${density} at ${String(width)} px`, async () => {
            await page.setViewportSize({ width, height: 1100 });
            await applyDisplay(page, theme, density);
            await awaitEveryCardReady(page);
            await expectAccessible(page);
          });
        }
      }
    }
  });

  test('no horizontal page scroll at 390 and no text with an em or en dash', async ({ page }) => {
    await saveGroupLayout(page);
    for (const width of [390, 1280] as const) {
      await test.step(`${String(width)} px`, async () => {
        await page.setViewportSize({ width, height: 1100 });
        await applyDisplay(page, 'light', 'compact');
        await awaitEveryCardReady(page);
        await expectNoSidewaysScroll(page, width);
        expect(await dashesIn(cardGrid(page))).toEqual([]);
      });
    }
  });
});
