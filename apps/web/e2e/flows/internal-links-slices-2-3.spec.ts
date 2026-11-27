import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { expectAccessible, signIn } from '../support';
import {
  EDITOR,
  canvasOf,
  card,
  expectNoEquity,
  expectPagesLoaded,
  inspectorOf,
  openPages,
  pagesGrid,
  tierPageCount,
} from '../support/internal-links';
import {
  THEME_STORAGE_KEY,
  alertDialog,
  anyRoute,
  crawlButton,
  editorialRoute,
  lostAlert,
  openChanges,
  openOpportunities,
  openPathFinder,
  openTierCanvas,
  opportunitiesGrid,
  saveAlertThreshold,
  suggestionsTable,
} from '../support/internal-links-slices-2-3';

/**
 * Internal links, slices 2 and 3 (plan 05 task 20, spec section 11) against the test build with every route mocked.
 * The mock API keeps its state in the page's memory, so a change is read back through the app's own tabs, never
 * through a reload. No step waits on a timer: each wait is an expect that retries.
 */

const LATEST_HOST = 'eventussecurity.com';

test.describe('Internal links, slices 2 and 3', () => {
  test('picks an older crawl, and Back to latest clears it', async ({ page }) => {
    await signIn(page, EDITOR);
    await openPages(page);
    await expectPagesLoaded(page);
    await expect(crawlButton(page)).toBeVisible();
    await crawlButton(page).click();
    await page.getByRole('menuitemradio', { name: /7 Nov/ }).click();
    await expect(page).toHaveURL(/[?&]run=/);
    await expect(page.getByText('Older crawl')).toBeVisible();
    await expectPagesLoaded(page);
    await expectNoEquity(page);
    await page.getByRole('button', { name: 'Back to latest' }).click();
    await expect(page).not.toHaveURL(/[?&]run=/);
    await expect(page.getByText('Older crawl')).toHaveCount(0);
  });

  test('Changes: the alert, all lost links, the priority and the alert rules', async ({ page }) => {
    await signIn(page, EDITOR);
    await openChanges(page);
    await expect(lostAlert(page)).toBeVisible();
    await expectNoEquity(page);

    await page.getByRole('button', { name: 'Show all lost links' }).click();
    await expect(page.getByText('Lost to T1').first()).toBeVisible();
    await expect(page.getByText(/^Still linked from /).first()).toBeVisible();

    await saveAlertThreshold(page, 3);
    await expect(lostAlert(page)).toHaveCount(0);
    await saveAlertThreshold(page, 1);
    await expect(lostAlert(page)).toBeVisible();
  });

  test('Pages: the rank and citations columns, and the suggested tiers', async ({ page }) => {
    await signIn(page, EDITOR);
    await openPages(page);
    await expectPagesLoaded(page);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('checkbox', { name: 'Average rank' }).click();
    await page.getByRole('checkbox', { name: 'AI citations' }).click();
    await page.keyboard.press('Escape');
    await expect(pagesGrid(page).getByRole('columnheader', { name: /^Average rank/ })).toBeVisible();
    await expect(pagesGrid(page).getByRole('columnheader', { name: /^AI citations/ })).toBeVisible();
    await expectNoEquity(page);

    const before = await tierPageCount(page, 'T2').catch(() => 0);
    await page.getByRole('button', { name: /^Suggested tiers \d+$/ }).click();
    await expect(suggestionsTable(page)).toBeVisible();
    await page
      .getByRole('button', { name: /^Accept the suggestion for / })
      .first()
      .click();
    await expect(page.getByText(/^\d+ pages? moved$/)).toBeVisible();
    await expectNoEquity(page);

    // The Tier flow tab reads the tier the page moved to
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Tier flow' }).click();
    await expect.poll(async () => tierPageCount(page, 'T2')).toBeGreaterThan(before);
  });

  test('Opportunities: accept, copy, dismiss in bulk, and the planned fixes CSV', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, EDITOR);
    await openOpportunities(page);
    const grid = opportunitiesGrid(page);

    await grid
      .getByRole('button', { name: /^Accept: / })
      .first()
      .click();
    await expect(page.getByText('Planned', { exact: true }).first()).toBeVisible();
    await expect(grid.getByText('Accepted').first()).toBeVisible();

    await grid
      .getByRole('button', { name: /^Copy instruction: / })
      .first()
      .click();
    await expect(page.getByText('Instruction copied').first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(LATEST_HOST);

    await grid
      .getByRole('checkbox', { name: /^Select / })
      .nth(1)
      .click();
    await grid
      .getByRole('checkbox', { name: /^Select / })
      .nth(2)
      .click();
    await expect(page.getByText('2 opportunities selected')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByText('2 opportunities dismissed')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Planned fixes' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('internal-links-planned-fixes.csv');
    const text = await readFile(await download.path(), 'utf8');
    expect(text).toContain(LATEST_HOST);
    expect(text).not.toMatch(/equity/i);
    await expectNoEquity(page);
  });

  test('Journey: the By tier lanes, opened cards, the info panel, the selection, zoom, the map and a reload', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openTierCanvas(page);
    const canvas = canvasOf(page);
    await expect(canvas.getByRole('heading', { level: 3, name: /^T4/ })).toBeVisible();
    await expect(canvas.getByText('No T2 page in view')).toBeVisible();

    // A lane chip hides its lane and brings it back
    const chip = page.getByRole('group', { name: 'Tiers shown' }).getByRole('button', { name: /^T4 / });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('heading', { level: 3, name: /^T4/ })).toHaveCount(0);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // One card open at a time
    await card(page, '/pricing').click();
    await expect(card(page, '/pricing')).toHaveAttribute('aria-expanded', 'true');
    await card(page, '/contact').click();
    await expect(card(page, '/contact')).toHaveAttribute('aria-expanded', 'true');
    await expect(card(page, '/pricing')).toHaveAttribute('aria-expanded', 'false');

    // The info panel of a card
    await card(page, '/contact').hover();
    const info = canvas.getByRole('button', { name: 'Info about /contact' });
    await info.click();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expectNoEquity(page);

    // Two cards selected with Shift, then their links
    await card(page, '/pricing').click({ modifiers: ['Shift'] });
    await card(page, '/contact').click({ modifiers: ['Shift'] });
    await expect(page.getByText('2 cards selected')).toBeVisible();
    await page.getByRole('button', { name: 'Show their links' }).click();

    // Zoom with Ctrl and the wheel, and the map
    const percent = page.getByRole('button', { name: /%, return to 100%$/ });
    await canvas.hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect(percent).not.toHaveText('100%');
    await page.getByRole('button', { name: 'Show the map' }).click();
    await expect(page.getByRole('img', { name: 'Map of the journey' })).toBeVisible();

    // The layout comes back from the address
    await page.reload();
    await expect(page.getByRole('radio', { name: 'By tier' })).toBeChecked();
    await expect(canvasOf(page).getByRole('heading', { level: 3, name: /^T4/ })).toBeVisible();
    await expect(inspectorOf(page, '/contact')).toHaveCount(0);
  });

  test('Path finder: the two routes, the note, and Open in canvas', async ({ page }) => {
    await signIn(page, EDITOR);
    await openPathFinder(page, '103');
    await expect(anyRoute(page)).toBeVisible();
    await expect(editorialRoute(page)).toBeVisible();
    await expectNoEquity(page);

    // A page the home page reaches only through menus: one route, and the sentence that says so
    await openPathFinder(page, '114');
    await expect(page.getByText(/No editorial links lead here from the home page\./)).toBeVisible();
    await expect(editorialRoute(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Open in canvas' }).click();
    await expect(page).not.toHaveURL(/[?&]jv=paths/);
    await expect(canvasOf(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Focus page: .*\. Change it\.$/ })).toBeVisible();
  });

  test('Export: the client summary downloads as an HTML file that names the host', async ({ page }) => {
    await signIn(page, EDITOR);
    await openPages(page);
    await expectPagesLoaded(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Client summary (HTML)' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('internal-links-summary.html');
    const html = await readFile(await download.path(), 'utf8');
    expect(html).toContain(LATEST_HOST);
    expect(html).not.toMatch(/equity/i);
  });

  for (const theme of ['light', 'dark'] as const) {
    const withTheme = async (page: Page): Promise<void> => {
      await page.addInitScript(
        ([key, value]) => {
          window.localStorage.setItem(key, value);
        },
        [THEME_STORAGE_KEY, theme] as const,
      );
    };

    test(`has no axe violations on Changes, Opportunities, the Path finder and the By tier canvas in the ${theme} theme`, async ({
      page,
    }) => {
      await withTheme(page);
      await signIn(page, EDITOR);

      await openChanges(page);
      await expect(lostAlert(page)).toBeVisible();
      await expectAccessible(page);
      await expectNoEquity(page);

      await openOpportunities(page);
      await expectAccessible(page);
      await expectNoEquity(page);

      await openPathFinder(page, '103');
      await expect(editorialRoute(page)).toBeVisible();
      await expectAccessible(page);
      await expectNoEquity(page);

      await openTierCanvas(page);
      await expectAccessible(page);
      await expectNoEquity(page);
    });

    test(`has no axe violations on the suggestions popover and the alert dialog in the ${theme} theme`, async ({
      page,
    }) => {
      await withTheme(page);
      await signIn(page, EDITOR);

      await openPages(page);
      await expectPagesLoaded(page);
      await page.getByRole('button', { name: /^Suggested tiers \d+$/ }).click();
      await expect(suggestionsTable(page)).toBeVisible();
      await expectAccessible(page);
      await expectNoEquity(page);
      await page.keyboard.press('Escape');

      await openChanges(page);
      await page.getByRole('button', { name: 'Change alert rules' }).click();
      await expect(alertDialog(page)).toBeVisible();
      await expectAccessible(page);
      await expectNoEquity(page);
    });
  }
});
