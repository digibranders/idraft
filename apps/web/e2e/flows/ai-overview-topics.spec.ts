import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { expectAccessible, signIn } from '../support';
import {
  DENSITIES,
  EDITOR,
  EXTRAS_WITH_FOOTNOTE,
  EXTRA_CARDS,
  HEATMAP_TITLE,
  OVERLAP_COUNT,
  OVERLAP_NOTE,
  PRESET_CARD_COUNT,
  RETRY,
  THEMES,
  THIN_ANSWERS,
  THIN_TOPIC,
  TOPIC_OWNER_CARDS,
  TOP_LEVEL_TOPICS,
  WIDTHS,
  applyDisplay,
  awaitCardReady,
  awaitEveryCardReady,
  cardById,
  cardGrid,
  cardTitled,
  changeEngine,
  customizeButton,
  dashesIn,
  enginesButton,
  expectNoSidewaysScroll,
  focusTitleOf,
  heatCell,
  heatmapCard,
  heatmapGrid,
  installSummaryFault,
  installSummaryHold,
  installThinCells,
  openOverview,
  pageHeading,
  releaseSummary,
  saveBar,
  saveLayout,
  saveTopicLayout,
  setSummaryFault,
  setThinCells,
  startCustomizing,
  tabTo,
} from '../support/ai-overview-topics';

/**
 * The topic and prompt cards of the AI visibility screen (WP-36, plan task T12): the Topic owner preset and the four
 * cards it leaves out, the heat map and where its cells lead, the page scope against a card's own engine, the honest
 * states (too few answers, none, the comparison off, a failed read, loading), the keyboard, and every card at four
 * widths in both themes and both table densities. The Fynix mock asks two engines, ChatGPT and Gemini, over 23
 * prompts in four top level topics; Eventus Security is seeded in the dev server only and is not part of this spec.
 */
test.describe.configure({ timeout: 180_000 });

/** The topic Paid Search of the Fynix mock (`src/mocks/entity-fixtures.ts`). */
const PAID_SEARCH = mockId('term', 6);
const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';
/** The columns of the heat map while both engines are asked. */
const BOTH_ENGINE_COLUMNS = ['Topic', 'Prompts', 'ChatGPT', 'Gemini', 'avg of 2'];

/** The drawer of a topic: beside the table on a wide window, a sheet over it on a narrow one. */
const drawerOf = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name }).or(page.getByRole('dialog', { name }));

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

test.describe('the topic and prompt cards', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('the heat map shows topics by engine with counts in the cell names and an avg column', async ({ page }) => {
    await saveTopicLayout(page);
    const card = heatmapCard(page);
    await expect(card.getByRole('heading', { level: 2, name: HEATMAP_TITLE })).toBeVisible();

    await test.step('a row per top level topic, a column per asked engine, then the average of the two', async () => {
      expect(await columnNames(card)).toEqual(BOTH_ENGINE_COLUMNS);
      for (const topic of TOP_LEVEL_TOPICS) {
        await expect(heatmapGrid(card).getByRole('rowheader', { name: topic, exact: true })).toBeVisible();
      }
      await expect(heatmapGrid(card).getByRole('rowheader')).toHaveCount(TOP_LEVEL_TOPICS.length);
      // AI Mode is off for Fynix: an engine that is not asked is not a column
      await expect(heatmapGrid(card).getByRole('columnheader', { name: /AI Mode/ })).toHaveCount(0);
    });

    await test.step('every cell is named with its rate, its answers and its prompts', async () => {
      for (const topic of TOP_LEVEL_TOPICS) {
        for (const engine of ['ChatGPT', 'Gemini']) {
          const name = await heatCell(card, topic, engine).first().getByRole('link').getAttribute('aria-label');
          const counts = /: (\d+(?:\.\d+)?)%, ([\d,]+) of ([\d,]+) answers?, .*?([\d,]+) prompts?/.exec(name ?? '');
          if (counts === null)
            throw new Error(`The cell ${topic} on ${engine} is not named with its counts: ${String(name)}`);
          expect(Number((counts[2] ?? '').replaceAll(',', ''))).toBeLessThanOrEqual(
            Number((counts[3] ?? '').replaceAll(',', '')),
          );
        }
        const average = heatmapGrid(card).getByRole('gridcell', { name: new RegExp(`^${topic}, avg of 2: \\d+%, `) });
        await expect(average).toHaveCount(1);
        await expect(average).toHaveAttribute(
          'aria-label',
          /Equal weight average of ChatGPT and Gemini, each engine counting once\./,
        );
      }
    });

    await test.step('the footnote explains the colours and the average', async () => {
      await expect(card).toContainText('Cell colour by rate:');
      await expect(card).toContainText('The average column gives each engine that shows a rate the same weight');
    });
  });

  test('a heat map cell opens the topic drawer on the Prompts tab filtered to its engine', async ({ page }) => {
    await saveTopicLayout(page);
    await heatCell(heatmapCard(page), 'Paid Search', 'ChatGPT').getByRole('link').click();

    const query = await queryOf(page, 'inspect');
    expect(new URL(page.url()).pathname).toBe('/digibranders/fynix/ai/prompts');
    expect(query.get('inspect')).toBe(`topic:${PAID_SEARCH}`);
    expect(query.get('itab')).toBe('prompts');
    expect(query.get('eng')).toBe(CHATGPT);

    const drawer = drawerOf(page, 'Paid Search');
    await expect(drawer.getByRole('tab', { name: 'Prompts', selected: true })).toBeVisible();
    await expect(drawer.getByText('Engine: ChatGPT')).toBeVisible();
  });

  test('Topic owner preset shows every topic card with its overlap footnote', async ({ page }) => {
    await saveTopicLayout(page, { extras: true });
    await expect(cardGrid(page).locator('[data-layout-card]')).toHaveCount(PRESET_CARD_COUNT + EXTRA_CARDS.length);

    await test.step('each of the seven cards of the preset has its title and the footnote with the overlap count', async () => {
      const titles: Record<keyof typeof TOPIC_OWNER_CARDS, string> = {
        heatmap: HEATMAP_TITLE,
        extremes: 'Strongest and weakest topics',
        movers: 'Topics gaining or losing',
        gap: 'Where engines disagree',
        trends: 'Mention rate by week, topic and engine',
        disagreement: 'Named by one engine, not another',
        contribution: 'What each topic adds',
      };
      for (const [key, id] of Object.entries(TOPIC_OWNER_CARDS) as Array<[keyof typeof TOPIC_OWNER_CARDS, string]>) {
        const card = cardById(page, id);
        await awaitCardReady(card);
        await expect(card.getByRole('heading', { level: 2, name: titles[key] })).toBeVisible();
        await expect(card).toContainText(OVERLAP_NOTE);
        // The trends read carries no prompt rows, so that card cannot count the prompts in two topics and says nothing of it
        if (key !== 'trends') await expect(card).toContainText(OVERLAP_COUNT);
      }
    });

    await test.step('the four cards added from the catalog are there and read', async () => {
      for (const { title } of EXTRA_CARDS) {
        const card = cardTitled(page, title);
        await awaitCardReady(card);
        await expect(card.getByRole('heading', { level: 2, name: title })).toBeVisible();
        await expect(card.getByText(/could not be read/)).toHaveCount(0);
      }
      for (const { title } of EXTRAS_WITH_FOOTNOTE) {
        await expect(cardTitled(page, title)).toContainText(OVERLAP_NOTE);
      }
    });
  });

  test('the engine option of a card with an engine choice changes the card and not the page scope', async ({
    page,
  }) => {
    await saveTopicLayout(page);
    const card = cardById(page, TOPIC_OWNER_CARDS.contribution);
    await expect(card).toContainText('to the mention rate on ChatGPT');
    await expect(enginesButton(page)).toHaveAccessibleName('Engines: 2 of 2');

    await startCustomizing(page);
    await changeEngine(page, TOPIC_OWNER_CARDS.contribution, 'What each topic adds: ChatGPT', 'Gemini');
    await expect(card).toContainText('to the mention rate on Gemini');
    await expect(card).not.toContainText('to the mention rate on ChatGPT');
    await saveLayout(page);

    // The page still asks both engines: no key in the address, the same count on the control, both columns in the heat map
    expect(new URL(page.url()).searchParams.has('engine')).toBe(false);
    await expect(enginesButton(page)).toHaveAccessibleName('Engines: 2 of 2');
    await awaitCardReady(heatmapCard(page));
    expect(await columnNames(heatmapCard(page))).toEqual(BOTH_ENGINE_COLUMNS);
  });

  test('the page scope (engine filter, topic) narrows every topic card; the URL survives reload and Back', async ({
    page,
  }) => {
    await saveTopicLayout(page);
    const heatmap = heatmapCard(page);
    const named = (id: string): Locator => cardById(page, id);

    await test.step('one engine: every card leaves the other out', async () => {
      await enginesButton(page).click();
      await page.getByRole('checkbox', { name: /ChatGPT/ }).click();
      await page.keyboard.press('Escape');
      expect((await queryOf(page, 'engine')).get('engine')).toBe(GEMINI);
      await expect(enginesButton(page)).toHaveAccessibleName('Engines: 1 of 2');

      await expect(heatmapGrid(heatmap).getByRole('columnheader', { name: /ChatGPT/ })).toHaveCount(0);
      await expect(heatmapGrid(heatmap).getByRole('columnheader', { name: /avg of/ })).toHaveCount(0);
      await expect(heatmapGrid(heatmap).getByRole('columnheader', { name: /Gemini/ })).toBeVisible();
      for (const id of [TOPIC_OWNER_CARDS.extremes, TOPIC_OWNER_CARDS.movers, TOPIC_OWNER_CARDS.trends]) {
        await awaitCardReady(named(id));
        await expect(named(id)).not.toContainText('ChatGPT');
      }
      await awaitCardReady(named(TOPIC_OWNER_CARDS.gap));
      await expect(named(TOPIC_OWNER_CARDS.gap)).toContainText('Needs two engines');
      await awaitCardReady(named(TOPIC_OWNER_CARDS.contribution));
      await expect(named(TOPIC_OWNER_CARDS.contribution)).toContainText('ChatGPT is not part of this view');
    });

    await test.step('one topic: every card leaves the others out', async () => {
      await page.getByRole('button', { name: 'Add a filter' }).click();
      await page.getByRole('button', { name: 'Topic', exact: true }).click();
      await page.getByRole('radio', { name: THIN_TOPIC, exact: true }).click();
      await page.keyboard.press('Escape');
      expect((await queryOf(page, 'topic')).get('topic')).toBe(PAID_SEARCH);

      await expect(heatmapGrid(heatmap).getByRole('rowheader')).toHaveCount(1);
      await expect(heatmapGrid(heatmap).getByRole('rowheader', { name: THIN_TOPIC, exact: true })).toBeVisible();
      await awaitCardReady(named(TOPIC_OWNER_CARDS.trends));
      await expect(named(TOPIC_OWNER_CARDS.trends)).toContainText(THIN_TOPIC);
      await expect(named(TOPIC_OWNER_CARDS.trends)).not.toContainText('Content Marketing');
    });

    const scoped = new URL(page.url()).search;
    await test.step('a reload keeps the scope and the cards', async () => {
      await page.reload();
      await expect(pageHeading(page)).toBeVisible();
      expect(new URL(page.url()).search).toBe(scoped);
      await awaitCardReady(heatmap);
      await expect(heatmapGrid(heatmap).getByRole('rowheader')).toHaveCount(1);
      await expect(heatmapGrid(heatmap).getByRole('columnheader', { name: /ChatGPT/ })).toHaveCount(0);
    });

    await test.step('a cell carries the scope to the Prompts page, and Back returns to the same scope', async () => {
      await heatCell(heatmap, THIN_TOPIC, 'Gemini').getByRole('link').click();
      await expect(page).toHaveURL(/\/ai\/prompts\?/);
      expect((await queryOf(page, 'inspect')).get('eng')).toBe(GEMINI);
      await page.goBack();
      await expect(pageHeading(page)).toBeVisible();
      expect(new URL(page.url()).search).toBe(scoped);
      await awaitCardReady(heatmap);
      await expect(heatmapGrid(heatmap).getByRole('rowheader')).toHaveCount(1);
      await expect(heatmapGrid(heatmap).getByRole('columnheader', { name: /ChatGPT/ })).toHaveCount(0);
    });
  });

  test('a thin cell says its answers and prints no percent; no cell says 0% for an unknown', async ({ page }) => {
    await installThinCells(page);
    await saveTopicLayout(page);
    await setThinCells(page, true);
    await page.reload();
    const card = heatmapCard(page);
    await awaitCardReady(card);

    await test.step('2 of 3 answers is three answers and no percent, in the cell and in its name', async () => {
      const thin = heatCell(card, THIN_TOPIC, 'ChatGPT');
      await expect(thin).toHaveText(`${String(THIN_ANSWERS)} ans`);
      await expect(thin).not.toContainText('%');
      const name = await thin.getByRole('link').getAttribute('aria-label');
      expect(name).toContain(`${String(THIN_ANSWERS)} answers`);
      expect(name).not.toContain('%');
    });

    await test.step('no answer says n/a, is no link, and is never a rate of 0', async () => {
      const none = heatCell(card, THIN_TOPIC, 'Gemini');
      await expect(none).toHaveText('n/a');
      await expect(none).not.toContainText('%');
      await expect(none.getByRole('link')).toHaveCount(0);
      await expect(none).not.toHaveAttribute('aria-label', /%/);
    });

    await test.step('the average of a row with no rate in either column is no percent either', async () => {
      const average = heatmapGrid(card).getByRole('gridcell', { name: new RegExp(`^${THIN_TOPIC}, `) });
      await expect(average).toHaveCount(1);
      await expect(average).toHaveText(/^(?:\d+ ans|n\/a)$/);
      await expect(average).not.toHaveAttribute('aria-label', /\d%/);
    });

    await test.step('the other rows keep their rates, and no cell of the grid reads 0%', async () => {
      await expect(heatCell(card, 'SEO', 'ChatGPT')).toHaveText(/^\d+%$/);
      const texts = await heatmapGrid(card).getByRole('gridcell').allInnerTexts();
      expect(texts.filter((text) => /^0(?:\.0)?%$/.test(text.trim()))).toEqual([]);
      // Gemini on the topic is the one unknown cell of the page: no other cell says n/a, none says a rate of 0
      expect(texts.filter((text) => text.trim() === 'n/a')).toHaveLength(1);
    });
  });

  test('compare off turns the movers card into its empty state with the action, and the action turns it on', async ({
    page,
  }) => {
    await saveTopicLayout(page);
    await openOverview(page, 1280, '?cmp=off');
    const movers = cardById(page, TOPIC_OWNER_CARDS.movers);
    await awaitCardReady(movers);

    await expect(movers.getByRole('heading', { level: 3, name: 'Comparison is off' })).toBeVisible();
    await expect(movers).toContainText(
      'Turn the comparison on to see which topics gained or lost against the previous window.',
    );
    // The cards that do not compare are not touched: the heat map still reads
    await awaitCardReady(heatmapCard(page));
    await expect(heatmapGrid(heatmapCard(page)).getByRole('rowheader')).toHaveCount(TOP_LEVEL_TOPICS.length);

    await movers.getByRole('button', { name: 'Compare with the previous period' }).click();
    await expect(page).not.toHaveURL(/cmp=/);
    await expect(movers.getByText('Comparison is off')).toHaveCount(0);
    await awaitCardReady(movers);
    await expect(movers.getByRole('group', { name: / view$/ })).toBeVisible();
    await expect(movers).toContainText(/topics? moved within normal variation|gaining|lost/i);
  });

  test('a failed summary shows the card error with Retry and Retry recovers', async ({ page }) => {
    await installSummaryFault(page);
    await saveTopicLayout(page);
    await setSummaryFault(page, true);
    await page.reload();

    await expect(pageHeading(page)).toBeVisible();
    await expect(customizeButton(page)).toBeVisible();
    for (const id of Object.values(TOPIC_OWNER_CARDS)) {
      const card = cardById(page, id);
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
    await expect(heatmapGrid(card).getByRole('rowheader')).toHaveCount(TOP_LEVEL_TOPICS.length);
  });

  test('loading shows skeletons and no spinner', async ({ page }) => {
    await saveTopicLayout(page);
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
    await expect(heatmapGrid(card).getByRole('rowheader')).toHaveCount(TOP_LEVEL_TOPICS.length);
  });

  test('keyboard: Tab reaches the grid, arrows move between cells, Enter follows a cell link, Escape leaves customize', async ({
    page,
  }) => {
    await saveTopicLayout(page);

    await test.step('Escape leaves customize mode and the focus returns to Customize', async () => {
      await startCustomizing(page);
      await heatmapCard(page)
        .getByRole('button', { name: /^Reorder / })
        .focus();
      await page.keyboard.press('Escape');
      await expect(saveBar(page)).toHaveCount(0);
      await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(customizeButton(page)).toBeFocused();
    });

    const card = heatmapCard(page);
    const focusedCell = card.locator('[data-cell]:focus');
    await test.step('Tab reaches the grid as one stop, on its first cell', async () => {
      await focusTitleOf(card);
      await tabTo(page, card.locator('[data-cell]'));
      await expect(focusedCell).toHaveAttribute('data-cell', '0:0');
    });

    await test.step('the arrows move down the rows and across the columns to a cell link', async () => {
      // SEO and Content Marketing hold subtopics, so the third row is the first that is a plain row
      await page.keyboard.press('ArrowDown');
      await expect(focusedCell).toHaveAttribute('data-cell', '1:0');
      await page.keyboard.press('ArrowDown');
      await expect(focusedCell).toHaveAttribute('data-cell', '2:0');
      await page.keyboard.press('ArrowRight');
      await expect(focusedCell).toHaveAttribute('data-cell', '2:1');
      await page.keyboard.press('ArrowRight');
      await expect(focusedCell).toHaveAttribute('data-cell', '2:2');
      await expect(card.getByRole('link', { name: /^Paid Search on ChatGPT: / })).toBeFocused();
    });

    await test.step('Enter follows the link of the cell to the drawer of its engine', async () => {
      await page.keyboard.press('Enter');
      const query = await queryOf(page, 'inspect');
      expect(query.get('inspect')).toBe(`topic:${PAID_SEARCH}`);
      expect(query.get('itab')).toBe('prompts');
      expect(query.get('eng')).toBe(CHATGPT);
      await expect(drawerOf(page, 'Paid Search').getByRole('tab', { name: 'Prompts', selected: true })).toBeVisible();
    });
  });

  test('axe: no serious or critical violation at 390, 768, 1024 and 1280 px, light and dark, Default and Compact', async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await saveTopicLayout(page, { extras: true });
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
    await saveTopicLayout(page, { extras: true });
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
