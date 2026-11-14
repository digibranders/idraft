import { expect, test, type Locator, type Page } from '@playwright/test';

import { MOCK_TERM_IDS } from '../../src/mocks/entity-fixtures';
import { signIn } from '../support';
import {
  BUILTIN_CARD_IDS,
  BUILTIN_NUMBER_LABELS,
  DENSITIES,
  EDITOR,
  THEMES,
  VIEWER,
  WIDTHS,
  applyAppearance,
  awaitCardSettled,
  awaitCardsSettled,
  bannersOf,
  cardById,
  cardGrid,
  expectNoSeriousViolations,
  installSummaryControl,
  layoutSettled,
  metaLine,
  numberOf,
  numbersGroup,
  numbersOf,
  openOverview,
  overviewLink,
  overviewPath,
  pageHeading,
  promptsChip,
  scopeBar,
  setSummaryMode,
  stripError,
  waitForOverview,
} from '../support/ai-overview';

/**
 * The AI visibility Overview shell (WP-33, plan tasks T12 and T13), part 1: the sidebar entry, the header, the four
 * numbers and the nine cards of the built-in layout, the scope in the address, the links of the numbers, the project
 * with no engine by role, the notice that paused schedules make, the loading and failed states of the strip, and
 * the axe checks at four widths in both themes and both densities. The AI cards are the card packages' (WP-34 to
 * 37), so a card is asserted by its title and by a finished, non-error state, never by its contents.
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
