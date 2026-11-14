import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { MOCK_TERM_IDS } from '../../src/mocks/entity-fixtures';
import { signIn } from '../support';
import {
  ADMIN,
  BUILTIN_CARD_IDS,
  BUILTIN_NUMBER_LABELS,
  DENSITIES,
  EDITOR,
  THEMES,
  VIEWER,
  WIDTHS,
  addCardSlot,
  aiCatalogGroups,
  aiCatalogTitles,
  applyAppearance,
  awaitCardSettled,
  awaitCardsSettled,
  bannersOf,
  barButton,
  builtinCardName,
  cardById,
  cardGrid,
  cardPart,
  cardsUnavailableWithoutAi,
  catalogDialog,
  customizeButton,
  discardDialog,
  drawnRows,
  expectCardOrder,
  expectNoSeriousViolations,
  expectNumberLabels,
  hideCard,
  installSummaryControl,
  layoutSettled,
  metaLine,
  numberOf,
  numberTip,
  numbersGroup,
  numbersOf,
  openCustomize,
  openOverview,
  overviewLink,
  overviewPath,
  pageHeading,
  parseCsv,
  partEmptyRows,
  permissionGatedTitles,
  promptsChip,
  saveBar,
  saveLayout,
  scopeBar,
  setSummaryMode,
  stripError,
  toastOf,
  unavailableCards,
  waitForAnnouncement,
  waitForOverview,
} from '../support/ai-overview';
import { copyLayouts, personalScreens, storedLayouts } from '../support/layouts';

/**
 * The AI visibility Overview shell (WP-33, plan tasks T12 and T13), part 1: the sidebar entry, the header, the four
 * numbers and the nine cards of the built-in layout, the scope in the address, the links of the numbers, the project
 * with no engine by role, the notice that paused schedules make, the loading and failed states of the strip, and
 * the axe checks at four widths in both themes and both densities. The AI cards are the card packages' (WP-34 to
 * 37), so a card is asserted by its title and by a finished, non-error state, never by its contents. Part 2 (T13) is
 * the second half of the file: customizing, the presets, the team default, the phone, Export Numbers, the keyboard,
 * leaving customize mode and a project with no AI.
 *
 * The mock keeps the engines in the memory of the page and the schedules in a cookie, so the tests that need paused
 * schedules turn an engine on (which makes them), pause them on the Schedules page, and then either load the page
 * again (the engines are the fixtures' again, the schedules stay paused) or move on through the sidebar (the
 * engines stay as they were turned).
 */
test.describe.configure({ timeout: 120_000 });

/** The title of each card of the built-in layout, in order (what the card draws, or the pending card's catalog title). */
const CARD_TITLES = [
  'What changed',
  'Mention rate by engine',
  'Named and cited, by engine',
  'Top cited domains',
  'Mention rate by topic and engine',
  'Share of voice on ChatGPT',
  'Mention rate on ChatGPT',
  'Key changes',
  'AI opportunities',
] as const;

const PROMPTS_PATH = '/digibranders/fynix/ai/prompts';
const PAUSED = 'Scheduled AI runs are paused for this project';
const AI_SCHEDULES = ['AI answers, Monday', 'AI answers, Thursday'] as const;

const paramsOf = (page: Page): URLSearchParams => new URL(page.url()).searchParams;
const hrefParams = (href: string | null): URLSearchParams => {
  if (href === null) throw new Error('The number is plain text, it has no link');
  return new URL(href, 'http://app.test').searchParams;
};

/**
 * Turns an engine on in Settings > Engines. `country` is the one the row shows once the countries have loaded, which
 * turning on needs; a project whose countries are not known to this flow leaves it out.
 */
async function turnEngineOn(page: Page, engine: string, country?: string): Promise<void> {
  if (country !== undefined) {
    const row = page.getByRole('region', { name: 'Engines' }).getByRole('listitem').filter({ hasText: engine }).first();
    await expect(row.getByText(country, { exact: true })).toBeVisible();
  }
  await page.getByRole('switch', { name: engine }).click();
  await page
    .getByRole('alertdialog', { name: `Turn on ${engine}?` })
    .getByRole('button', { name: `Turn on ${engine}` })
    .click();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText(`${engine} is on`)).toBeVisible();
  await expect(page.getByRole('switch', { name: engine })).toBeChecked();
}

/** Pauses the two AI schedules that turning an engine on made, on the Schedules page reached by the Engines page's link. */
async function pauseAiSchedules(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Engines' }).getByRole('link', { name: 'Schedules' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Schedules' })).toBeVisible();
  for (const name of AI_SCHEDULES) {
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${name}`) }) });
    await expect(row).toBeVisible();
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Pause', exact: true }).click();
    await expect(row.getByText('Paused')).toBeVisible();
  }
}

test.describe('the AI visibility Overview', () => {
  test('the sidebar lists AI visibility Overview for a member and it opens /ai', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(PROMPTS_PATH);
    const link = overviewLink(page);
    await expect(link).toHaveAttribute('href', '/digibranders/fynix/ai');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByText('AI Visibility', { exact: true }),
    ).toBeVisible();
    await expect(link).not.toHaveAttribute('aria-current', 'page');
    await link.click();
    await expect(page).toHaveURL(/\/digibranders\/fynix\/ai$/);
    await waitForOverview(page);
    await expect(overviewLink(page)).toHaveAttribute('aria-current', 'page');
  });

  test('Fynix: header, meta line, the four numbers with counts, notice region empty, nine cards in the built-in order', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');

    await test.step('the header names the page and the meta line gives freshness, prompts and engines', async () => {
      await expect(pageHeading(page)).toHaveText('AI visibility');
      await expect(metaLine(page)).toContainText(/^AI updated /);
      await expect(metaLine(page)).toContainText(/ · [\d,]+ prompts? · \d+ engines?$/);
      await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
    });

    await test.step('the four numbers are the built-in ones and each says what it counts', async () => {
      const cells = await numbersOf(page);
      expect(cells.map((cell) => cell.label)).toEqual([...BUILTIN_NUMBER_LABELS]);
      const [prompts, chatgpt, gemini, aiMode] = cells;
      expect(prompts?.value).toMatch(/^[\d,]+$/);
      expect(Number((prompts?.value ?? '0').replaceAll(',', ''))).toBeGreaterThan(0);
      expect(prompts?.text).toMatch(/in \d+ topics?$/);
      // An engine that is on shows a rate with the answers it rests on, or the answers it has when they are too few
      for (const engine of [chatgpt, gemini]) {
        expect(engine?.text).toMatch(/\d[\d,]* of [\d,]+ answers$|Too few for a rate$/);
      }
      // Fynix has Google AI Mode off: the number says so and does not read as a zero
      expect(aiMode?.text).toContain('Not asked');
      expect(aiMode?.text).toContain('Off in this project');
    });

    await test.step('there is no notice, and no state replaces the body', async () => {
      await expect(bannersOf(page)).toHaveCount(0);
      await expect(
        page.getByRole('heading', { level: 2, name: /^(No AI engine is on|No prompts are asked yet)$/ }),
      ).toHaveCount(0);
      await expect(stripError(page)).toHaveCount(0);
    });

    await test.step('the nine cards are in the order of the built-in layout, each with its title and a finished state', async () => {
      const grid = cardGrid(page);
      await expect(grid.locator('[data-layout-card]')).toHaveCount(CARD_TITLES.length);
      expect(
        await grid
          .locator('[data-layout-card]')
          .evaluateAll((nodes) =>
            nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.layoutCard ?? '') : '')),
          ),
      ).toEqual([...BUILTIN_CARD_IDS]);
      for (const [index, id] of BUILTIN_CARD_IDS.entries()) {
        const card = cardById(page, id);
        await awaitCardSettled(card);
        await expect(card.getByRole('heading', { level: 2 }).first()).toHaveText(CARD_TITLES[index] ?? '');
        // A card that is built shows its data and one that is not shows the pending card: neither is a failed read
        await expect(card.locator('[data-slot="inline-error"]')).toHaveCount(0);
        await expect(card.getByRole('alert')).toHaveCount(0);
      }
    });
  });

  test('the window, compare, engines, country, topic and branded are in the URL and survive reload and Back', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    const bar = scopeBar(page);
    const top = page.getByRole('banner');

    await test.step('each control writes its own key and the default of each writes nothing', async () => {
      expect([...paramsOf(page).keys()]).toEqual([]);
      await top.getByRole('button', { name: /^Date range: / }).click();
      await page
        .getByRole('dialog', { name: 'Date range', exact: true })
        .getByRole('button', { name: 'Last 7 days', exact: true })
        .click();
      await expect.poll(() => paramsOf(page).get('win')).toBe('7d');

      await bar.getByRole('button', { name: 'vs previous period' }).click();
      await page.getByRole('menuitemradio', { name: 'No comparison' }).click();
      await expect.poll(() => paramsOf(page).get('cmp')).toBe('off');

      await bar.getByRole('button', { name: /^Engines: 2 of 2/ }).click();
      await page.getByRole('checkbox', { name: /Gemini/ }).click();
      await expect.poll(() => paramsOf(page).get('engine')).toBe('chatgpt_web');
      await page.keyboard.press('Escape');

      await bar.getByRole('button', { name: 'Add a filter' }).click();
      await page.getByRole('button', { name: 'Topic', exact: true }).click();
      await page.getByRole('radio', { name: /Technical SEO$/ }).click();
      await expect.poll(() => paramsOf(page).get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
      await page.keyboard.press('Escape');

      await bar.getByRole('button', { name: 'Remove filter Branded: Excluded' }).click();
      await expect.poll(() => paramsOf(page).get('branded')).toBe('included');

      await top.getByRole('combobox', { name: 'Country: All countries' }).click();
      await page.getByRole('option', { name: 'Germany', exact: true }).click();
      await expect.poll(() => paramsOf(page).get('country')).toBe('DE');
    });

    const expected = {
      win: '7d',
      cmp: 'off',
      engine: 'chatgpt_web',
      topic: MOCK_TERM_IDS.technicalSeo,
      branded: 'included',
      country: 'DE',
    };
    /** The controls read the address back: the scope is the URL's, and nothing of it was kept anywhere else. */
    const expectScopeShown = async (): Promise<void> => {
      expect(Object.fromEntries(paramsOf(page))).toEqual(expected);
      await expect(scopeBar(page)).toBeVisible();
      await expect(top.getByRole('button', { name: /^Date range: Last 7 days/ })).toBeVisible();
      await expect(scopeBar(page).getByRole('button', { name: 'No comparison' })).toBeVisible();
      await expect(scopeBar(page).getByRole('button', { name: /^Engines: 1 of 2/ })).toBeVisible();
      await expect(
        scopeBar(page).getByRole('button', { name: /^Topic: .*Technical SEO\. Edit filter$/ }),
      ).toBeVisible();
      await expect(scopeBar(page).getByRole('button', { name: /^Branded:/ })).toHaveCount(0);
      await expect(scopeBar(page).getByRole('button', { name: 'Reset filters' })).toBeVisible();
      await expect(top.getByRole('combobox', { name: 'Country: Germany' })).toBeVisible();
    };

    await test.step('a reload shows the same scope', async () => {
      await page.reload();
      await expectScopeShown();
    });

    await test.step('Back from another page returns to the page with its scope', async () => {
      const returnTo = page.url();
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Topics & Prompts' }).click();
      await expect(page).toHaveURL(/\/digibranders\/fynix\/ai\/prompts/);
      await page.goBack();
      await expect(page).toHaveURL(returnTo);
      await expectScopeShown();
    });

    await test.step('Reset filters puts the filters back and leaves the window and the country', async () => {
      await scopeBar(page).getByRole('button', { name: 'Reset filters' }).click();
      await expect.poll(() => Object.fromEntries(paramsOf(page))).toEqual({ win: '7d', country: 'DE' });
    });
  });

  test('a number links to Topics and Prompts with the scope carried', async ({ page }) => {
    await signIn(page, EDITOR);
    const topic = MOCK_TERM_IDS.technicalSeo;
    await openOverview(page, 'Fynix', { search: `?win=7d&topic=${topic}` });
    const overview = page.url();

    await test.step('the links name the destination and carry the window, the topic and the engine', async () => {
      const prompts = await numberOf(page, 'Prompts');
      expect(prompts.href).toContain('/digibranders/fynix/ai/prompts?');
      expect(Object.fromEntries(hrefParams(prompts.href))).toEqual({ tab: 'prompts', win: '7d', topic });

      const chatgpt = await numberOf(page, 'Mention rate ChatGPT');
      expect(Object.fromEntries(hrefParams(chatgpt.href))).toEqual({
        tab: 'prompts',
        win: '7d',
        topic,
        engine: 'chatgpt_web',
        sort: '-chatgpt_web_rate',
      });
      // An engine that is off in the project has no page to lead to: its number is plain text
      expect((await numberOf(page, 'Mention rate AI Mode')).href).toBeNull();
    });

    await test.step('the Prompts number opens the Prompts tab with the same count', async () => {
      const count = (await numberOf(page, 'Prompts')).value;
      await numbersGroup(page).getByRole('link', { name: 'Prompts', exact: true }).click();
      await expect(page).toHaveURL(/\/digibranders\/fynix\/ai\/prompts\?/);
      expect(Object.fromEntries(paramsOf(page))).toMatchObject({ tab: 'prompts', win: '7d', topic });
      await expect(page.getByRole('grid', { name: 'Prompts' })).toBeVisible();
      expect(await promptsChip(page, 'Prompts')).toBe(count);
    });

    await test.step('an engine number opens the Prompts tab for that engine, sorted by its rate, with the same figure', async () => {
      await page.goBack();
      await expect(page).toHaveURL(overview);
      await waitForOverview(page);
      const figure = (await numberOf(page, 'Mention rate ChatGPT')).value;
      await numbersGroup(page).locator('dt a').filter({ hasText: 'ChatGPT' }).click();
      await expect(page).toHaveURL(/\/digibranders\/fynix\/ai\/prompts\?/);
      expect(Object.fromEntries(paramsOf(page))).toMatchObject({
        tab: 'prompts',
        win: '7d',
        topic,
        engine: 'chatgpt_web',
        sort: '-chatgpt_web_rate',
      });
      await expect(page.getByRole('grid', { name: 'Prompts' })).toBeVisible();
      expect(await promptsChip(page, 'ChatGPT')).toBe(figure);
    });
  });

  for (const [role, email] of [
    ['editor', EDITOR],
    ['viewer', VIEWER],
  ] as const) {
    test(`Cleanstart: no engine state with the right action by role (${role})`, async ({ page }) => {
      await signIn(page, email);
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.goto(overviewPath('Cleanstart'));
      await expect(pageHeading(page)).toBeVisible();
      const state = page.locator('[data-slot="empty-state"]');
      await expect(state.getByRole('heading', { level: 2, name: 'No AI engine is on' })).toBeVisible();
      // Nothing is counted, so nothing is drawn as a number or a card
      await expect(numbersGroup(page)).toHaveCount(0);
      await expect(cardGrid(page)).toHaveCount(0);
      await expect(bannersOf(page)).toHaveCount(0);
      const action = state.getByRole('link', { name: 'Turn on engines' });
      if (role === 'editor') {
        await expect(state).toContainText('Turn on ChatGPT, Gemini or Google AI Mode in the project settings');
        await expect(action).toHaveAttribute('href', '/digibranders/cleanstart/settings/engines');
        await action.click();
        await expect(page).toHaveURL(/\/digibranders\/cleanstart\/settings\/engines$/);
        await expect(page.getByRole('switch', { name: 'ChatGPT' })).toBeVisible();
      } else {
        await expect(state).toContainText('Ask a workspace admin to turn on an engine');
        await expect(action).toHaveCount(0);
        await expect(state.getByRole('link')).toHaveCount(0);
      }
    });
  }

  test('the notice precedence with paused schedules', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.setViewportSize({ width: 1280, height: 1100 });

    await test.step('turning an engine on makes the AI schedules, and pausing them is what the page says', async () => {
      await page.goto('/digibranders/fynix/settings/engines');
      await turnEngineOn(page, 'Google AI Mode', 'Germany');
      await pauseAiSchedules(page);
      // A full load: the engines are the fixtures' again, the schedules stay paused
      await page.goto(overviewPath('Fynix'));
      await waitForOverview(page);
      await expect(bannersOf(page)).toHaveCount(1);
      await expect(bannersOf(page)).toContainText(PAUSED);
    });

    await test.step('a country with no prompt is the body state, and the paused banner leaves with the strip and the grid', async () => {
      await page.goto(overviewPath('Fynix', '?country=US'));
      await expect(page.locator('[data-slot="empty-state"]').getByRole('heading', { level: 2 })).toContainText(
        /^No prompts ask in /,
      );
      await expect(bannersOf(page)).toHaveCount(0);
      await expect(numbersGroup(page)).toHaveCount(0);
      await expect(cardGrid(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Clear location' }).click();
      await waitForOverview(page);
      await expect(bannersOf(page)).toHaveCount(1);
      await expect(bannersOf(page)).toContainText(PAUSED);
    });
  });

  test('a project with an engine on and no prompts says so before it says the schedules are paused', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto('/digibranders/cleanstart/settings/engines');
    await turnEngineOn(page, 'ChatGPT');
    await pauseAiSchedules(page);
    // The sidebar keeps the page, and with it the engine just turned on
    await overviewLink(page).click();
    await expect(pageHeading(page)).toBeVisible();
    const state = page.locator('[data-slot="empty-state"]');
    await expect(state.getByRole('heading', { level: 2, name: 'No prompts are asked yet' })).toBeVisible();
    await expect(bannersOf(page)).toHaveCount(0);
    await expect(page.getByText(PAUSED)).toHaveCount(0);
    await expect(numbersGroup(page)).toHaveCount(0);
  });

  test.describe('the numbers while they load and when they fail', () => {
    const spinners = (page: Page): Locator => page.locator('[data-slot="spinner"], svg.animate-spin');

    test('loading shows skeletons and no spinner', async ({ page }) => {
      await signIn(page, EDITOR);
      await installSummaryControl(page, 'hold');
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.goto(overviewPath('Fynix'));
      const strip = numbersGroup(page);
      await expect(strip).toBeVisible();
      await expect(strip).toHaveAttribute('aria-busy', 'true');
      // The labels are known, so they stay; the values are bars, one for each number
      expect((await numbersOf(page)).map((cell) => cell.label)).toEqual([...BUILTIN_NUMBER_LABELS]);
      await expect(strip.locator('[data-slot="skeleton"]')).toHaveCount(BUILTIN_NUMBER_LABELS.length);
      await expect(stripError(page)).toHaveCount(0);
      await expect(spinners(page)).toHaveCount(0);

      await setSummaryMode(page, 'ok');
      await waitForOverview(page);
      await expect(strip.locator('[data-slot="skeleton"]')).toHaveCount(0);
      expect((await numberOf(page, 'Prompts')).value).toMatch(/^[\d,]+$/);
    });

    test('a failed summary shows the strip error row and Retry brings the numbers back', async ({ page }) => {
      await signIn(page, EDITOR);
      await installSummaryControl(page, 'fail');
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.goto(overviewPath('Fynix'));
      await expect(pageHeading(page)).toBeVisible();
      const row = stripError(page);
      await expect(row).toBeVisible();
      await expect(row).toContainText('Try again in a moment');
      await expect(row).toContainText('Error ID e2e-failed');
      // The strip's numbers are not drawn as zeros: the row stands in for them, and the cards keep their own states
      await expect(numbersGroup(page)).toHaveCount(0);
      await expect(cardGrid(page)).toBeVisible();

      // Retry asks again: while the failure lasts the row stays, and once it is over the numbers come
      await row.getByRole('button', { name: 'Try again' }).click();
      await expect(row).toBeVisible();
      await setSummaryMode(page, 'ok');
      await row.getByRole('button', { name: 'Try again' }).click();
      await waitForOverview(page);
      await expect(row).toHaveCount(0);
      expect((await numberOf(page, 'Prompts')).value).toMatch(/^[\d,]+$/);
    });
  });

  test.describe('accessibility', () => {
    for (const width of WIDTHS) {
      test(`axe: no serious or critical violation at ${String(width)} px, light and dark, Default and Compact`, async ({
        page,
      }) => {
        test.setTimeout(300_000);
        await signIn(page, EDITOR);
        await openOverview(page, 'Fynix', { width });
        for (const theme of THEMES) {
          for (const density of DENSITIES) {
            await test.step(`${theme}, ${density}`, async () => {
              await applyAppearance(page, theme, density);
              await awaitCardsSettled(page);
              await layoutSettled(page);
              expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
              await expectNoSeriousViolations(page);
            });
          }
        }
      });
    }
  });
});

// -------------------------------------------------------------------------------------------------
// Part 2 (WP-33 plan T13): customizing the page, the presets, the team default, the phone, Export Numbers, the
// keyboard, leaving customize mode and a project with no AI. Every test has a browser context of its own, so none sees
// the layouts another saved (the mock keeps them in the `mock-layouts` cookie of the context).

/** The built-in cards without AI opportunities, the last of them, which most of these tests hide. */
const WITHOUT_OPPORTUNITIES = BUILTIN_CARD_IDS.filter((id) => id !== 'opportunities');
/** With Key changes moved to the start as well, as the phone test saves it. */
const KEY_CHANGES_FIRST = ['key-changes', ...WITHOUT_OPPORTUNITIES.filter((id) => id !== 'key-changes')];

const SAVED_SCREEN = 'ai_overview';
const SCOPE_NOTE = 'Applies to your view, in every project';
const DIFFERS_NOTE = 'Your layout differs from the team default. It applies to your view, in every project';

interface PresetExpectation {
  name: string;
  numbers: string[];
  cards: string[];
  /** The 1 based rows the page leaves part empty, by the window's width. */
  partEmpty: Readonly<Record<1280 | 768, number[]>>;
}

/**
 * The four presets of the Start from menu as inventory 9.5 gives them (Competitive as built: `ai.sample_coverage` is a
 * third and `ai.co_mentions` two thirds). A copy typed out here, not read from the code, so a change to a preset fails
 * this file until the two are told apart on purpose. The part empty rows are the two the plan accepted: the last
 * half card of SEO analyst and the lone third of Topic owner, at 768 px.
 */
const PRESETS: readonly PresetExpectation[] = [
  {
    name: 'Executive summary',
    numbers: ['Mention rate ChatGPT', 'Mention rate Gemini', 'Mention rate AI Mode', 'Share of voice ChatGPT'],
    cards: [
      'change-summary',
      'rate-trend',
      'share-of-voice-chatgpt',
      'topic-extremes',
      'answer-funnel',
      'period-comparison',
    ],
    partEmpty: { 1280: [], 768: [] },
  },
  {
    name: 'SEO analyst',
    numbers: [
      'Prompts',
      'Citation rate ChatGPT',
      'Citation rate Gemini',
      'Citation rate AI Mode',
      'Own citation share ChatGPT',
    ],
    cards: [
      'own-pages',
      'top-domains',
      'citation-vs-mention',
      'citation-share-by-domain-type',
      'fanout-top',
      'prompt-movers-chatgpt',
      'opportunities',
      'sample-coverage',
    ],
    partEmpty: { 1280: [], 768: [5] },
  },
  {
    name: 'Competitive',
    numbers: ['Prompts', 'Share of voice ChatGPT', 'Share of voice Gemini', 'Share of voice AI Mode'],
    cards: [
      'share-of-voice-chatgpt',
      'share-of-voice-gemini',
      'competitor-trend-chatgpt',
      'lost-to-competitor-chatgpt',
      'competitor-table',
      'sov-over-time-chatgpt',
      'top-domains',
      'sample-coverage',
      'co-mentions-chatgpt',
    ],
    partEmpty: { 1280: [], 768: [] },
  },
  {
    name: 'Topic owner',
    numbers: ['Prompts', 'Mention rate ChatGPT', 'Mention rate Gemini', 'Mention rate AI Mode'],
    cards: [
      'topic-heatmap',
      'topic-extremes',
      'topic-movers',
      'topic-engine-gap',
      'sample-coverage',
      'topic-trends',
      'engine-disagreement',
      'topic-contribution-chatgpt',
    ],
    partEmpty: { 1280: [], 768: [4] },
  },
];

/** Sets the draft as the team default through the chevron of the save bar, and waits until it is saved. */
async function setTeamDefault(page: Page): Promise<void> {
  await barButton(page, 'More save options').click();
  await page.getByRole('menuitem', { name: 'Save as team default', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Set this as the default for everyone in Digibranders?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Set team default', exact: true }).click();
  await waitForAnnouncement(page, 'Team default set');
  await expect(saveBar(page)).toHaveCount(0);
}

const teamScreens = async (page: Page): Promise<string[]> => Object.keys((await storedLayouts(page))?.team ?? {});

test.describe('customizing the AI visibility Overview', () => {
  test('Customize: a card is hidden with Undo, the catalog lists the AI cards, Save, and a reload keeps the layout', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    const name = builtinCardName('opportunities');

    await test.step('Customize turns the mode on: the badge, the save bar with no changes, a handle on every card', async () => {
      await openCustomize(page);
      await expect(page.getByText('Customizing', { exact: true })).toBeVisible();
      await expect(saveBar(page).getByText('No changes', { exact: true })).toBeVisible();
      await expect(saveBar(page).getByText(SCOPE_NOTE, { exact: true })).toBeVisible();
      for (const id of BUILTIN_CARD_IDS) await expect(cardPart(page, id, 'handle')).toBeVisible();
      await expectCardOrder(page, BUILTIN_CARD_IDS);
    });

    await test.step('Hide takes the card out and its toast has an Undo that brings it back', async () => {
      await hideCard(page, 'opportunities', WITHOUT_OPPORTUNITIES);
      await expect(saveBar(page).getByText('1 change', { exact: true })).toBeVisible();
      await toastOf(page, `${name} hidden`).getByRole('button', { name: 'Undo', exact: true }).click();
      await waitForAnnouncement(page, 'Change undone');
      await expectCardOrder(page, BUILTIN_CARD_IDS);
      await expect(saveBar(page).getByText('No changes', { exact: true })).toBeVisible();
      await expect(toastOf(page, `${name} hidden`)).toHaveCount(0);
      await hideCard(page, 'opportunities', WITHOUT_OPPORTUNITIES);
    });

    await test.step('the catalog lists the AI cards of this screen, in their groups, and no card of another', async () => {
      await addCardSlot(page).click();
      const catalog = catalogDialog(page);
      await expect(catalog).toBeVisible();
      await expect(catalog.getByRole('heading', { level: 3 })).toHaveText(aiCatalogGroups());
      const entries = await catalog.locator('li').evaluateAll((items) =>
        items.map((item) => ({
          title: item.querySelector('p')?.firstChild?.textContent?.trim() ?? '',
          button: item.querySelector('button')?.textContent?.trim() ?? '',
        })),
      );
      // A card that needs a permission is listed only for someone who holds it
      const gated = new Set(permissionGatedTitles());
      expect(
        entries
          .map((entry) => entry.title)
          .filter((title) => !gated.has(title))
          .sort(),
      ).toEqual(aiCatalogTitles());
      expect(entries.map((entry) => entry.title)).not.toContain('Rank distribution');
      // What is on the page is Added, and the card just hidden can be put back
      const stateOf = (title: string): string | undefined => entries.find((entry) => entry.title === title)?.button;
      expect(stateOf(builtinCardName('key-changes'))).toBe('Added');
      expect(stateOf(name)).toBe('Add');
      await page.keyboard.press('Escape');
      await expect(catalog).toBeHidden();
    });

    await test.step('Save stores a personal layout for this screen only and ends the mode', async () => {
      await saveLayout(page);
      expect(personalScreens(await storedLayouts(page))).toEqual([SAVED_SCREEN]);
      await expectCardOrder(page, WITHOUT_OPPORTUNITIES);
    });

    await test.step('a reload shows the saved layout', async () => {
      await page.reload();
      await waitForOverview(page);
      await expectCardOrder(page, WITHOUT_OPPORTUNITIES);
      await expect(cardById(page, 'opportunities')).toHaveCount(0);
    });
  });

  test('every preset applies, and only the two accepted rows are left part empty, at 1280 and 768 px', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    await openCustomize(page);

    await test.step('Start from offers the built-in layout, then the four presets', async () => {
      await barButton(page, 'Start from').click();
      await expect(page.getByRole('menuitem')).toHaveText([
        'Built-in default',
        ...PRESETS.map((preset) => preset.name),
      ]);
      await page.keyboard.press('Escape');
    });

    const apply = async (name: string): Promise<void> => {
      await barButton(page, 'Start from').click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await waitForAnnouncement(page, `${name} applied. Save to keep it.`);
    };
    /** The cards as drawn at a width: in order, and with the rows that are not full. */
    const expectRows = async (
      width: 1280 | 768,
      cards: readonly string[],
      partEmpty: readonly number[],
    ): Promise<void> => {
      await page.setViewportSize({ width, height: 1100 });
      await layoutSettled(page);
      await expectCardOrder(page, cards);
      const rows = await drawnRows(page);
      expect(rows.flatMap((row) => row.cards)).toEqual([...cards]);
      expect(partEmptyRows(rows), `part empty rows at ${String(width)} px: ${JSON.stringify(rows)}`).toEqual([
        ...partEmpty,
      ]);
    };

    for (const preset of PRESETS) {
      await test.step(`${preset.name}: its cards and numbers, and the rows at both widths`, async () => {
        await page.setViewportSize({ width: 1280, height: 1100 });
        await apply(preset.name);
        await expectCardOrder(page, preset.cards);
        await expectNumberLabels(page, preset.numbers);
        await expect(saveBar(page).getByText(/^\d+ changes?$/)).toBeVisible();
        await expectRows(1280, preset.cards, preset.partEmpty[1280]);
        await expectRows(768, preset.cards, preset.partEmpty[768]);
      });
    }

    await test.step('Built-in default puts the built-in layout back, with no part empty row', async () => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await apply('Built-in default');
      await expectNumberLabels(page, BUILTIN_NUMBER_LABELS);
      await expectRows(1280, BUILTIN_CARD_IDS, []);
      await expectRows(768, BUILTIN_CARD_IDS, []);
    });
  });

  test('a team default by an admin is what a member who never customized sees', async ({ page, browser }) => {
    await signIn(page, ADMIN);
    await openOverview(page, 'Fynix');
    await openCustomize(page);
    await hideCard(page, 'opportunities', WITHOUT_OPPORTUNITIES);
    await setTeamDefault(page);
    await expect(toastOf(page, 'Team default set')).toContainText(
      'AI visibility now opens with this layout for Digibranders.',
    );
    expect(await teamScreens(page)).toEqual([SAVED_SCREEN]);

    // Mei never customized this page, in a browser of her own that holds only the layouts the admin saved
    const context = await browser.newContext();
    try {
      const member = await context.newPage();
      await signIn(member, VIEWER);
      await copyLayouts(page, member);
      await openOverview(member, 'Fynix');
      await expectCardOrder(member, WITHOUT_OPPORTUNITIES);
      expect(personalScreens(await storedLayouts(member))).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('Your layout differs from the team default shows for a personal layout, and not for the team layout itself', async ({
    page,
  }) => {
    await signIn(page, ADMIN);
    await openOverview(page, 'Fynix');
    await openCustomize(page);
    await hideCard(page, 'opportunities', WITHOUT_OPPORTUNITIES);
    await setTeamDefault(page);

    await test.step('the team layout is the admin own layout now: nothing to differ from', async () => {
      await page.reload();
      await waitForOverview(page);
      await openCustomize(page);
      await expect(saveBar(page).getByText(SCOPE_NOTE, { exact: true })).toBeVisible();
      await expect(saveBar(page).getByText(DIFFERS_NOTE, { exact: true })).toHaveCount(0);
      await hideCard(
        page,
        'key-changes',
        WITHOUT_OPPORTUNITIES.filter((id) => id !== 'key-changes'),
      );
      await saveLayout(page);
      expect(personalScreens(await storedLayouts(page))).toEqual([SAVED_SCREEN]);
    });

    await test.step('a personal layout over a team default says so', async () => {
      await page.reload();
      await waitForOverview(page);
      await openCustomize(page);
      await expect(saveBar(page).locator(`[title="${DIFFERS_NOTE}"]`)).toHaveCount(1);
      await expect(saveBar(page).getByText(DIFFERS_NOTE, { exact: true })).toBeVisible();
      await expect(saveBar(page).getByText(SCOPE_NOTE, { exact: true })).toHaveCount(0);
    });
  });

  test('Customize is absent at 390 px and the saved layout shows full width in order', async ({ page }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    // Saved on a wide window, where customizing is possible
    await openCustomize(page);
    await hideCard(page, 'opportunities', WITHOUT_OPPORTUNITIES);
    await cardPart(page, 'key-changes', 'more').click();
    await page.getByRole('menuitem', { name: 'Move to start', exact: true }).click();
    await waitForAnnouncement(
      page,
      `${builtinCardName('key-changes')}, position 1 of ${String(KEY_CHANGES_FIRST.length)}`,
    );
    await expectCardOrder(page, KEY_CHANGES_FIRST);
    await saveLayout(page);

    await openOverview(page, 'Fynix', { width: 390, height: 844 });
    // No way into the mode: no button, no badge, no save bar
    await expect(customizeButton(page)).toHaveCount(0);
    await expect(page.getByText('Customizing', { exact: true })).toHaveCount(0);
    await expect(saveBar(page)).toHaveCount(0);
    await expectCardOrder(page, KEY_CHANGES_FIRST);

    // One column: each card as wide as the grid and below the one before it, in the order saved
    const boxes = await cardGrid(page)
      .locator('[data-layout-card]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width } = node.getBoundingClientRect();
          return { x, y, width };
        }),
      );
    const grid = await cardGrid(page).evaluate((node) => {
      const { x, width } = node.getBoundingClientRect();
      return { x, width };
    });
    for (const box of boxes) {
      expect(box.x).toBeCloseTo(grid.x, 0);
      expect(box.width).toBeCloseTo(grid.width, 0);
    }
    const tops = boxes.map((box) => box.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(KEY_CHANGES_FIRST.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('Export Numbers', () => {
  /** The columns of the file, in order (`export/export-model.ts`): typed out here, so a change to them fails here. */
  const EXPORT_HEADER = [
    'block',
    'project',
    'number',
    'engine',
    'value',
    'unit',
    'numerator',
    'denominator',
    'n_observations',
    'prompts',
    'status',
    'window_from',
    'window_to',
    'compare_from',
    'compare_to',
    'country',
    'topic',
    'branded',
    'method',
    'is_estimate',
  ];
  const toNumber = (text: string | undefined): number => Number((text ?? '').replaceAll(',', ''));

  test('downloads a CSV whose numbers equal the strip: counts, prompts, off engine empty and never 0, the notes', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    const cells = await numbersOf(page);

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const item = page.getByRole('menuitem', { name: 'Numbers (CSV)', exact: true });
    // The item waits for the reads it needs and says why while it does
    await expect(item).toBeEnabled({ timeout: 20_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), item.click()]);
    const rows = parseCsv(await readFile(await download.path(), 'utf8'));
    const [header, ...body] = rows;
    expect(header).toEqual(EXPORT_HEADER);
    const column = (row: readonly string[], name: string): string => row[EXPORT_HEADER.indexOf(name)] ?? '';
    const data = body.filter((row) => row[0] === 'numbers');
    const notes = body.filter((row) => row[0] === 'note');
    const find = (metric: string, engine: string): string[] => {
      const row = data.find(
        (candidate) => column(candidate, 'number') === metric && column(candidate, 'engine') === engine,
      );
      if (row === undefined) throw new Error(`The file has no row for ${metric} ${engine}`);
      return row;
    };

    await test.step('the file is named for the project and the window its rows say', async () => {
      const first = data[0] ?? [];
      const from = column(first, 'window_from');
      const to = column(first, 'window_to');
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(download.suggestedFilename()).toBe(`ai-overview-fynix-${from}-to-${to}.csv`);
      for (const row of data) {
        expect(column(row, 'project')).toBe('fynix');
        expect(column(row, 'window_from')).toBe(from);
        expect(column(row, 'window_to')).toBe(to);
        // Compare is on by default and branded prompts are left out, as the page says
        expect(column(row, 'compare_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(column(row, 'branded')).toBe('excluded');
        expect(column(row, 'is_estimate')).toBe('false');
      }
    });

    await test.step('a value is empty exactly when its status says it is not known, and never 0', async () => {
      expect(data.length).toBeGreaterThan(0);
      for (const row of data) {
        const label = `${column(row, 'number')} ${column(row, 'engine')}`;
        if (column(row, 'status') === 'ok') {
          expect(column(row, 'value'), label).toMatch(/^\d+(\.\d+)?$/);
        } else expect(column(row, 'value'), `${label} (${column(row, 'status')})`).toBe('');
      }
    });

    await test.step('Prompts equals the strip', async () => {
      const prompts = cells.find((cell) => cell.label === 'Prompts');
      const row = find('ai.prompts_in_scope', '');
      expect(column(row, 'status')).toBe('ok');
      expect(toNumber(column(row, 'value'))).toBe(toNumber(prompts?.value));
    });

    for (const [label, engine] of [
      ['Mention rate ChatGPT', 'chatgpt_web'],
      ['Mention rate Gemini', 'gemini_web'],
    ] as const) {
      await test.step(`${label}: the value, the answers and the prompts equal the strip and its tooltip`, async () => {
        const cell = cells.find((candidate) => candidate.label === label);
        const row = find('ai.mention_rate', engine);
        if (cell?.value.endsWith('%') === true) {
          const decimals = cell.value.split('.')[1]?.replace('%', '').length ?? 0;
          expect(column(row, 'status')).toBe('ok');
          expect(Math.abs(toNumber(column(row, 'value')) - Number.parseFloat(cell.value))).toBeLessThanOrEqual(
            0.5 / 10 ** decimals + 1e-9,
          );
        } else {
          // Too few answers for a rate: the strip says how many, the file has no value
          expect(column(row, 'value')).toBe('');
          expect(column(row, 'status')).toBe('insufficient');
        }
        const counts =
          /([\d,]+) of ([\d,]+) valid answers, ([\d,]+) prompts? each counted once, ([\d,]+) answers? not valid/.exec(
            await numberTip(page, label),
          );
        expect(counts, `the tooltip of ${label} gives its counts`).not.toBeNull();
        expect(toNumber(column(row, 'numerator'))).toBe(toNumber(counts?.[1]));
        expect(toNumber(column(row, 'denominator'))).toBe(toNumber(counts?.[2]));
        expect(toNumber(column(row, 'prompts'))).toBe(toNumber(counts?.[3]));
        // Every answer is valid or not: the answers seen less the valid ones are the invalid ones the tooltip counts
        expect(toNumber(column(row, 'n_observations')) - toNumber(counts?.[2])).toBe(toNumber(counts?.[4]));
        // The strip's own context line says the same counts, with thousands separators the tooltip has too
        expect((cell?.text ?? '').replaceAll(',', '')).toContain(
          `${String(toNumber(counts?.[1]))} of ${String(toNumber(counts?.[2]))} answers`,
        );
      });
    }

    await test.step('an engine that is off has rows with an empty value and the status off', async () => {
      expect((await numberOf(page, 'Mention rate AI Mode')).text).toContain('Off in this project');
      const offRows = data.filter((row) => column(row, 'engine') === 'google_ai_mode');
      expect(offRows.length).toBeGreaterThan(0);
      for (const row of offRows) {
        expect(column(row, 'value')).toBe('');
        expect(column(row, 'status')).toBe('off');
      }
    });

    await test.step('the notes say what an empty value and the counts mean', async () => {
      expect(notes).toHaveLength(2);
      expect(notes.map((note) => note[1]).join(' ')).toContain('An empty value means unknown, never zero');
      expect(notes.map((note) => note[1]).join(' ')).toContain('prompt weighted rates');
    });

    await expect(toastOf(page, 'rows exported')).toBeVisible();
  });
});

test.describe('the keyboard', () => {
  interface Stop {
    zone: 'header' | 'numbers' | 'scope' | 'cards' | 'other';
    tag: string;
    name: string;
  }

  async function stopOf(page: Page): Promise<Stop> {
    return page.evaluate((): Stop => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return { zone: 'other', tag: '', name: '' };
      const zone: Stop['zone'] =
        active.closest('[data-slot="page-header"]') !== null
          ? 'header'
          : active.closest('[role="group"][aria-label^="AI visibility numbers"]') !== null
            ? 'numbers'
            : active.closest('[aria-label="Scope"]') !== null
              ? 'scope'
              : active.closest('[aria-label="AI visibility cards"]') !== null
                ? 'cards'
                : 'other';
      return {
        zone,
        tag: active.tagName,
        name: (active.getAttribute('aria-label') ?? active.innerText).replace(/\s+/g, ' ').trim(),
      };
    });
  }

  test('Tab walks the header, every number link, compare, engines, the filter chips, then the cards', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    // The first card has loaded, so it has its own controls to stop at
    await awaitCardSettled(cardById(page, BUILTIN_CARD_IDS[0] ?? ''));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    // There is no notice on this project, so none is a stop (a notice with an action needs a failed run the mock cannot make)
    await expect(bannersOf(page)).toHaveCount(0);
    await customizeButton(page).focus();
    await expect(customizeButton(page)).toBeFocused();

    const stops: Stop[] = [];
    let reachedCards = false;
    for (let press = 0; press < 150; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await stopOf(page);
      stops.push(stop);
      reachedCards ||= stop.zone === 'cards';
      if (reachedCards && stop.zone !== 'cards') break;
    }

    const zones = stops
      .map((stop) => stop.zone)
      .filter((zone) => zone !== 'other')
      .filter((zone, index, all) => zone !== all[index - 1]);
    expect(zones.slice(0, 4)).toEqual(['header', 'numbers', 'scope', 'cards']);

    await test.step('the header: Export and More actions after Customize', async () => {
      expect(stops.filter((stop) => stop.zone === 'header').map((stop) => stop.name)).toEqual([
        'Export',
        'More actions',
      ]);
    });

    await test.step('every number that leads somewhere is a link and a stop, in the order of the strip', async () => {
      const links = stops.filter((stop) => stop.zone === 'numbers' && stop.tag === 'A').map((stop) => stop.name);
      expect(links).toHaveLength(3);
      expect(links[0]).toContain('Prompts');
      expect(links[1]).toContain('Mention rate');
      expect(links[1]).toContain('ChatGPT');
      expect(links[2]).toContain('Gemini');
    });

    await test.step('the scope bar: compare, engines, the Branded chip and its remove button, then the add filter button', async () => {
      const names = stops.filter((stop) => stop.zone === 'scope').map((stop) => stop.name);
      const at = (text: string): number => names.findIndex((name) => name.includes(text));
      expect(at('vs previous period'), names.join(' | ')).toBeGreaterThanOrEqual(0);
      expect(at('Engines')).toBeGreaterThan(at('vs previous period'));
      expect(at('Branded')).toBeGreaterThan(at('Engines'));
      expect(at('Remove filter Branded')).toBeGreaterThan(at('Branded'));
      expect(at('Add a filter')).toBeGreaterThanOrEqual(0);
    });

    await test.step('the cards come last and have a stop of their own', async () => {
      expect(stops.filter((stop) => stop.zone === 'cards').length).toBeGreaterThan(0);
      expect(stops.findLastIndex((stop) => stop.zone === 'cards')).toBeGreaterThan(
        stops.findLastIndex((stop) => stop.zone === 'scope'),
      );
    });
  });

  test('c turns Customize on and off and e opens the Export menu at 1280 px; at 390 px c does nothing and e still opens it', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    const menuItem = page.getByRole('menuitem', { name: 'Numbers (CSV)', exact: true });

    // The key does what the button does, so it waits for the layout as the button does
    await expect(customizeButton(page)).toBeEnabled();
    await page.keyboard.press('c');
    await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(saveBar(page)).toBeVisible();
    // No changes, so leaving asks nothing
    await page.keyboard.press('c');
    await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(saveBar(page)).toHaveCount(0);
    await expect(discardDialog(page)).toHaveCount(0);

    await page.keyboard.press('e');
    await expect(menuItem).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menuItem).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(customizeButton(page)).toHaveCount(0);
    await page.keyboard.press('c');
    await expect(saveBar(page)).toHaveCount(0);
    await expect(page.getByText('Customizing', { exact: true })).toHaveCount(0);
    await page.keyboard.press('e');
    await expect(menuItem).toBeVisible();
  });
});

test.describe('leaving customize mode', () => {
  test('Escape asks first when the draft differs, and a second Escape keeps editing', async ({ page }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    await openCustomize(page);
    await hideCard(page, 'opportunities', WITHOUT_OPPORTUNITIES);
    await cardPart(page, BUILTIN_CARD_IDS[0] ?? '', 'handle').focus();

    await page.keyboard.press('Escape');
    await expect(discardDialog(page)).toBeVisible();
    await expect(discardDialog(page)).toContainText('Your layout changes will be lost.');
    await page.keyboard.press('Escape');
    await expect(discardDialog(page)).toBeHidden();
    await expect(saveBar(page)).toBeVisible();
    await expectCardOrder(page, WITHOUT_OPPORTUNITIES);

    await page.keyboard.press('Escape');
    await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(saveBar(page)).toHaveCount(0);
    await expectCardOrder(page, BUILTIN_CARD_IDS);
    await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(customizeButton(page)).toBeFocused();
    expect(personalScreens(await storedLayouts(page))).toEqual([]);
  });

  test('Escape leaves at once when nothing was changed, with no question', async ({ page }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    await openCustomize(page);
    await cardPart(page, BUILTIN_CARD_IDS[0] ?? '', 'handle').focus();
    await page.keyboard.press('Escape');
    await expect(saveBar(page)).toHaveCount(0);
    await expect(discardDialog(page)).toHaveCount(0);
    await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(customizeButton(page)).toBeFocused();
  });
});

test.describe('a project with no AI engine', () => {
  test('its AI cards are placeholders with a reason in customize mode, and are not drawn in view', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(overviewPath('Cleanstart'));
    await expect(pageHeading(page)).toBeVisible();
    const state = page
      .locator('[data-slot="empty-state"]')
      .getByRole('heading', { level: 2, name: 'No AI engine is on' });
    await expect(state).toBeVisible();
    // The mock cannot give this page a grid with some of its cards unavailable and the rest shown: with no engine the
    // body is the no engine state, so in view no card of the layout is drawn at all
    await expect(cardGrid(page)).toHaveCount(0);

    // The catalog's own rule: every card of the built-in layout that needs AI, and the ones that need nothing
    const unavailable = cardsUnavailableWithoutAi();
    const available = BUILTIN_CARD_IDS.filter((id) => !unavailable.includes(id));
    expect(unavailable.length).toBeGreaterThan(0);
    expect(available).toContain('key-changes');

    await openCustomize(page);
    await expectCardOrder(page, BUILTIN_CARD_IDS);
    await expect(unavailableCards(page)).toHaveCount(unavailable.length);
    for (const id of unavailable) {
      const placeholder = cardById(page, id).locator('[data-slot="unavailable-card"]');
      await expect(placeholder).toContainText(builtinCardName(id));
      await expect(placeholder).toContainText('AI tracking is off in this project');
      await expect(placeholder).toContainText('This card shows in projects that have what it needs.');
      // It keeps its toolbar, so it can still be moved, resized or hidden
      await expect(cardPart(page, id, 'handle')).toBeVisible();
    }
    for (const id of available)
      await expect(cardById(page, id).locator('[data-slot="unavailable-card"]')).toHaveCount(0);

    // Leaving puts the page back as it was: the no engine state, and no card
    await barButton(page, 'Cancel').click();
    await expect(saveBar(page)).toHaveCount(0);
    await expect(discardDialog(page)).toHaveCount(0);
    await expect(state).toBeVisible();
    await expect(cardGrid(page)).toHaveCount(0);
    await expect(unavailableCards(page)).toHaveCount(0);
  });
});
