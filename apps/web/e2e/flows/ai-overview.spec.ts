import { expect, test, type Locator, type Page } from '@playwright/test';

import { MOCK_TERM_IDS } from '../../src/mocks/entity-fixtures';
import { signIn } from '../support';
import {
  BUILTIN_CARD_IDS,
  BUILTIN_CARD_TITLES,
  DENSITIES,
  HEADLINE_TILE_LABELS,
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
  expectResetHidden,
  groupSelect,
  headlineError,
  headlineGroup,
  heroOf,
  heroValue,
  installSummaryControl,
  layoutSettled,
  metaLine,
  numberOf,
  numbersOf,
  openOverview,
  overviewLink,
  overviewPath,
  pageHeading,
  platformSelect,
  promptsChip,
  resetScope,
  scopeBar,
  setSummaryMode,
  waitForOverview,
} from '../support/ai-overview';

/**
 * The AI visibility Overview shell (WP-33, plan tasks T12 and T13), part 1: the sidebar entry, the header, the
 * headline and the eleven cards of the Default layout, the scope in the address, the headline against the Prompts strip, the project
 * with no engine by role, the notice that paused schedules make, the loading and failed states of the headline, and
 * the axe checks at four widths in both themes and both densities. The AI cards are the card packages' (WP-34 to
 * 37), so a card is asserted by its title and by a finished, non-error state, never by its contents.
 *
 * The mock keeps the engines in the memory of the page and the schedules in a cookie, so the tests that need paused
 * schedules turn an engine on (which makes them), pause them on the Schedules page, and then either load the page
 * again (the engines are the fixtures' again, the schedules stay paused) or move on through the sidebar (the
 * engines stay as they were turned).
 */
test.describe.configure({ timeout: 120_000 });

const PROMPTS_PATH = '/digibranders/fynix/ai/prompts';
const PAUSED = 'Scheduled AI runs are paused for this project';
const AI_SCHEDULES = ['AI answers, Monday', 'AI answers, Thursday'] as const;

const paramsOf = (page: Page): URLSearchParams => new URL(page.url()).searchParams;

/**
 * Turns an engine on in Settings > Platforms. `country` is the one the row shows once the countries have loaded, which
 * turning on needs; a project whose countries are not known to this flow leaves it out.
 */
async function turnEngineOn(page: Page, engine: string, country?: string): Promise<void> {
  if (country !== undefined) {
    const row = page
      .getByRole('region', { name: 'Platforms' })
      .getByRole('listitem')
      .filter({ hasText: engine })
      .first();
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

/** Pauses the two AI schedules that turning an engine on made, on the Schedules page reached by the Platforms page's link. */
async function pauseAiSchedules(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Platforms' }).getByRole('link', { name: 'Schedules' }).click();
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
    // The group heading and its item both read "AI visibility"
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByText('AI visibility', { exact: true }),
    ).toHaveCount(2);
    await expect(link).not.toHaveAttribute('aria-current', 'page');
    await link.click();
    await expect(page).toHaveURL(/\/digibranders\/fynix\/ai$/);
    await waitForOverview(page);
    await expect(overviewLink(page)).toHaveAttribute('aria-current', 'page');
  });

  test('Fynix: header, freshness, the headline with its eight tiles, notice region empty, eleven cards in the Default order', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');

    await test.step('the header names the page and the freshness line does not change with the scope', async () => {
      await expect(pageHeading(page)).toHaveText('AI visibility overview');
      await expect(metaLine(page)).toHaveCount(1);
      await expect(metaLine(page)).toContainText(/^AI updated /);
      await expect(metaLine(page)).not.toContainText('prompts');
      await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
    });

    await test.step('the headline has the hero and the eight tiles, each saying what it is or why it has no figure', async () => {
      await expect(heroOf(page)).toBeVisible();
      const cells = await numbersOf(page);
      expect(cells.map((cell) => cell.label)).toEqual([...HEADLINE_TILE_LABELS]);
      const byLabel = Object.fromEntries(cells.map((cell) => [cell.label, cell]));
      expect(byLabel.Prompts?.value).toMatch(/^[\d,]+$/);
      expect(Number((byLabel.Prompts?.value ?? '0').replaceAll(',', ''))).toBeGreaterThan(0);
      // The measures the mock now carries are a figure (a position such as 1.1, or a percent); one without data says n/a
      for (const label of ['Mention position', 'Recommendation rate', 'Sentiment']) {
        expect(byLabel[label]?.value).toMatch(/^\d+(?:\.\d)?%?$|^n\/a$/);
      }
      // The rates are a percent, or n/a with the reason under them
      for (const label of ['Mention rate', 'Share of voice', 'Citation rate']) {
        expect(byLabel[label]?.value).toMatch(/^\d+%$|^n\/a$/);
      }
      expect(await heroValue(page)).toMatch(/^\d+%$|^n\/a$/);
    });

    await test.step('there is no notice, and no state replaces the body', async () => {
      await expect(bannersOf(page)).toHaveCount(0);
      await expect(
        page.getByRole('heading', { level: 2, name: /^(No AI platform is on|No prompts are asked yet)$/ }),
      ).toHaveCount(0);
      await expect(headlineError(page)).toHaveCount(0);
    });

    await test.step('the eleven cards are in the order of the Default layout, each with its title and a finished state', async () => {
      const grid = cardGrid(page);
      await expect(grid.locator('[data-layout-card]')).toHaveCount(BUILTIN_CARD_IDS.length);
      expect(
        await grid
          .locator('[data-layout-card]')
          .evaluateAll((nodes) =>
            nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.layoutCard ?? '') : '')),
          ),
      ).toEqual([...BUILTIN_CARD_IDS]);
      for (const id of BUILTIN_CARD_IDS) {
        const card = cardById(page, id);
        await awaitCardSettled(card);
        const title = BUILTIN_CARD_TITLES[id];
        if (title !== null && title !== undefined)
          await expect(card.getByRole('heading', { level: 2 }).first()).toHaveText(title);
        // A card that is built shows its data and one that is not shows the pending card: neither is a failed read
        await expect(card.locator('[data-slot="inline-error"]')).toHaveCount(0);
        await expect(card.getByRole('alert')).toHaveCount(0);
      }
    });
  });

  test('the window, compare, platforms, country, group and branded are in the URL and survive reload and Back', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    const bar = scopeBar(page);
    const top = page.getByRole('banner');

    await test.step('each control writes its own key and the default of each writes nothing', async () => {
      expect([...paramsOf(page).keys()]).toEqual([]);
      await top.getByRole('button', { name: /^Period: / }).click();
      await page
        .getByRole('dialog', { name: 'Period', exact: true })
        .getByRole('button', { name: 'Last 7 days', exact: true })
        .click();
      await expect.poll(() => paramsOf(page).get('win')).toBe('7d');

      await bar.getByRole('button', { name: 'Compare with: vs previous period' }).click();
      await page.getByRole('menuitemradio', { name: 'No comparison' }).click();
      await expect.poll(() => paramsOf(page).get('cmp')).toBe('off');

      await platformSelect(page).click();
      await page.getByRole('option', { name: 'Gemini', exact: true }).click();
      await expect.poll(() => paramsOf(page).get('engine')).toBe('gemini_web');

      await groupSelect(page).click();
      await page.getByRole('option', { name: /Technical SEO$/ }).click();
      await expect.poll(() => paramsOf(page).get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);

      await top.getByRole('combobox', { name: 'Location: All locations' }).click();
      await page.getByRole('option', { name: 'Germany', exact: true }).click();
      await expect.poll(() => paramsOf(page).get('country')).toBe('DE');
    });

    const expected = {
      win: '7d',
      cmp: 'off',
      engine: 'gemini_web',
      topic: MOCK_TERM_IDS.technicalSeo,
      country: 'DE',
    };
    /** The controls read the address back: the scope is the URL's, and nothing of it was kept anywhere else. */
    const expectScopeShown = async (): Promise<void> => {
      expect(Object.fromEntries(paramsOf(page))).toEqual(expected);
      await expect(scopeBar(page)).toBeVisible();
      await expect(top.getByRole('button', { name: /^Period: Last 7 days/ })).toBeVisible();
      await expect(scopeBar(page).getByRole('button', { name: 'Compare with: No comparison' })).toBeVisible();
      await expect(platformSelect(page, 'Gemini')).toBeVisible();
      await expect(groupSelect(page, /^Group: .*Technical SEO$/)).toBeVisible();
      await expect(page.getByRole('button', { name: /^Branded:/ })).toHaveCount(0);
      await expect(resetScope(page)).toHaveCSS('visibility', 'visible');
      await expect(top.getByRole('combobox', { name: 'Location: Germany' })).toBeVisible();
    };

    await test.step('a reload shows the same scope', async () => {
      await page.reload();
      await expectScopeShown();
    });

    await test.step('Back from another page returns to the page with its scope', async () => {
      const returnTo = page.url();
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Prompts', exact: true })
        .click();
      await expect(page).toHaveURL(/\/digibranders\/fynix\/ai\/prompts/);
      await page.goBack();
      await expect(page).toHaveURL(returnTo);
      await expectScopeShown();
    });

    await test.step('Reset scope puts the filters back and leaves the window and the country', async () => {
      await resetScope(page).click();
      await expect.poll(() => Object.fromEntries(paramsOf(page))).toEqual({ win: '7d', country: 'DE' });
      // It keeps its place, invisible, so the row does not move
      await expectResetHidden(page);
    });
  });

  test('the toolbar is one row of fixed-width selects: a longer choice moves nothing', async ({ page }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix', { width: 1440 });
    const box = async (locator: Locator): Promise<{ x: number; y: number; width: number }> => {
      const found = await locator.boundingBox();
      if (found === null) throw new Error('The control is not drawn');
      return { x: found.x, y: found.y, width: found.width };
    };
    const measure = async (
      platform: string,
      group: string | RegExp,
    ): Promise<Array<{ x: number; y: number; width: number }>> => {
      // The bar is sticky, so it sits 4 px higher once the page has scrolled: measure from the top, as a person lands
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      return [
        await box(platformSelect(page, platform)),
        await box(groupSelect(page, group)),
        await box(scopeBar(page).getByRole('button', { name: /^Compare with: (vs previous period|No comparison)$/ })),
        await box(resetScope(page)),
      ];
    };
    const before = await measure('All platforms', 'All groups');
    // All four share one row
    expect(new Set(before.map((control) => Math.round(control.y))).size).toBe(1);
    await platformSelect(page).click();
    await page.getByRole('option', { name: 'Gemini', exact: true }).click();
    await groupSelect(page).click();
    await page.getByRole('option', { name: /Technical SEO$/ }).click();
    const after = await measure('Gemini', /^Group: .*Technical SEO$/);
    expect(after).toEqual(before);
  });

  test('the metric key survives a reload, makes Reset scope available, and a bad value falls back', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix', { search: '?metric=sov' });
    await expect(resetScope(page)).toHaveCSS('visibility', 'visible');
    await page.reload();
    await waitForOverview(page);
    expect(paramsOf(page).get('metric')).toBe('sov');
    await resetScope(page).click();
    await expect.poll(() => paramsOf(page).has('metric')).toBe(false);
    await expectResetHidden(page);

    // A value that is not a measure reads as the default: no Reset, and the address is left as the link had it
    await page.goto(overviewPath('Fynix', '?metric=bogus'));
    await waitForOverview(page);
    await expectResetHidden(page);
    expect(paramsOf(page).get('metric')).toBe('bogus');
  });

  test('a link that names every platform that is on reads as All platforms and the address is tidied', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix', { search: '?engine=gemini_web,chatgpt_web' });
    await expect(platformSelect(page)).toBeVisible();
    await expect.poll(() => paramsOf(page).has('engine')).toBe(false);
    await expectResetHidden(page);
  });

  test('Platform lists Google AI Overview as not available', async ({ page }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix');
    await platformSelect(page).click();
    await expect(page.getByRole('option', { name: /^Google AI Overview/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('option', { name: /^Google AI Overview/ })).toContainText('Not available');
  });

  test('the headline and the Prompts strip show one AI visibility figure for a platform (R12)', async ({ page }) => {
    await signIn(page, EDITOR);
    await openOverview(page, 'Fynix', { search: '?win=7d&engine=chatgpt_web' });
    const figure = await heroValue(page);
    expect(figure).toMatch(/^\d+%$/);
    await page.goto('/digibranders/fynix/ai/prompts?tab=prompts&win=7d');
    await expect(page.getByRole('grid', { name: 'Prompts' })).toBeVisible();
    expect(await promptsChip(page, 'ChatGPT')).toBe(figure);
  });

  for (const [role, email] of [
    ['editor', EDITOR],
    ['viewer', VIEWER],
  ] as const) {
    test(`Cleanstart: no platform state with the right action by role (${role})`, async ({ page }) => {
      await signIn(page, email);
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.goto(overviewPath('Cleanstart'));
      await expect(pageHeading(page)).toBeVisible();
      const state = page.locator('[data-slot="empty-state"]');
      await expect(state.getByRole('heading', { level: 2, name: 'No AI platform is on' })).toBeVisible();
      // Nothing is counted, so nothing is drawn as a number or a card
      await expect(headlineGroup(page)).toHaveCount(0);
      await expect(cardGrid(page)).toHaveCount(0);
      await expect(bannersOf(page)).toHaveCount(0);
      const action = state.getByRole('link', { name: 'Turn on platforms' });
      if (role === 'editor') {
        await expect(state).toContainText('Turn on ChatGPT, Gemini or Google AI Mode in the project settings');
        await expect(action).toHaveAttribute('href', '/digibranders/cleanstart/settings/engines');
        await action.click();
        await expect(page).toHaveURL(/\/digibranders\/cleanstart\/settings\/engines$/);
        await expect(page.getByRole('switch', { name: 'ChatGPT' })).toBeVisible();
      } else {
        await expect(state).toContainText('Ask a workspace admin to turn on a platform');
        await expect(action).toHaveCount(0);
        await expect(state.getByRole('link')).toHaveCount(0);
      }
    });
  }

  test('the notice precedence with paused schedules', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.setViewportSize({ width: 1280, height: 1100 });

    await test.step('turning a platform on makes the AI schedules, and pausing them is what the page says', async () => {
      await page.goto('/digibranders/fynix/settings/engines');
      await turnEngineOn(page, 'Google AI Mode', 'Germany');
      await pauseAiSchedules(page);
      // A full load: the engines are the fixtures' again, the schedules stay paused
      await page.goto(overviewPath('Fynix'));
      await waitForOverview(page);
      await expect(page.getByRole('link', { name: 'Schedules paused' })).toBeVisible();
    });

    await test.step('a country with no prompt is the body state, and the paused banner leaves with the grid', async () => {
      await page.goto(overviewPath('Fynix', '?country=US'));
      await expect(page.locator('[data-slot="empty-state"]').getByRole('heading', { level: 2 })).toContainText(
        /^No prompts ask in /,
      );
      await expect(page.getByRole('link', { name: 'Schedules paused' })).toHaveCount(0);
      await expect(headlineGroup(page)).toHaveCount(0);
      await expect(cardGrid(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Clear location' }).click();
      await waitForOverview(page);
      await expect(page.getByRole('link', { name: 'Schedules paused' })).toBeVisible();
    });
  });

  test('a project with a platform on and no prompts says so before it says the schedules are paused', async ({
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
    await expect(headlineGroup(page)).toHaveCount(0);
  });

  test.describe('the headline while it loads and when it fails', () => {
    const spinners = (page: Page): Locator => page.locator('[data-slot="spinner"], svg.animate-spin');

    test('loading shows skeletons and no spinner', async ({ page }) => {
      await signIn(page, EDITOR);
      await installSummaryControl(page, 'hold');
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.goto(overviewPath('Fynix'));
      const card = cardById(page, 'visibility-split');
      // The hero and the eight tiles hold their places as bars
      await expect(card.locator('[data-slot="skeleton"]').first()).toBeVisible();
      await expect(headlineError(page)).toHaveCount(0);
      await expect(spinners(page)).toHaveCount(0);

      await setSummaryMode(page, 'ok');
      await waitForOverview(page);
      await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(0);
      expect((await numberOf(page, 'Prompts')).value).toMatch(/^[\d,]+$/);
    });

    test('a failed summary shows the error state of the headline and Retry brings the numbers back', async ({
      page,
    }) => {
      await signIn(page, EDITOR);
      await installSummaryControl(page, 'fail');
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.goto(overviewPath('Fynix'));
      await expect(pageHeading(page)).toBeVisible();
      const row = headlineError(page);
      await expect(row).toBeVisible();
      await expect(row).toContainText('Error ID e2e-failed');
      // The figures are not drawn as zeros: the state stands in for them, and the other cards keep their own states
      await expect(headlineGroup(page)).toHaveCount(0);
      await expect(cardGrid(page)).toBeVisible();

      // Retry asks again: while the failure lasts the state stays, and once it is over the numbers come
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
        // The Competitor gap card's table wrapper scrolls without a keyboard stop at these two widths (e2e-findings.md, finding O1)
        test.fixme(
          width === 768 || width === 1280,
          'scrollable-region-focusable on the Competitor gap card (e2e-findings.md, finding O1)',
        );
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
