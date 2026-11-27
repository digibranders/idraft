import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { expectAccessible, signIn } from '../support';
import {
  ADMIN,
  CRAWL_WAIT,
  EDITOR,
  EVENTUS_PAGES_ALL,
  LINKS_SETTINGS,
  THEME_STORAGE_KEY,
  TIERS_SETTINGS,
  canvasOf,
  card,
  expectNoEquity,
  expectPagesLoaded,
  flowTable,
  inspectorOf,
  linksGrid,
  openLinks,
  openPages,
  pagesGrid,
  tierPageCount,
  treeOf,
  waitForState,
} from '../support/internal-links';

/**
 * Internal links (spec 11) against the test build with every route mocked (decision W21). The mock API keeps its
 * state in the page's memory, so a change is read back through the app's own tabs, never through a reload. A
 * mocked crawl waits 3 s in the queue and runs to 8 s; every wait for it is a bounded expect, never a sleep.
 * The crawls are on in the mock world and nothing in a run switches them off, so the "crawls are not switched on"
 * notice is covered by the unit tests only.
 */

/** Opens the page's More actions menu (the header's, which comes before the table's) and picks `item`. */
async function pickFromMore(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'More actions', exact: true }).first().click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('Internal links (spec 11)', () => {
  test('a new project with the box ticked shows its first crawl in progress', async ({ page }) => {
    // The mock crawl takes about 30 s to leave the queue, longer than the default test timeout
    test.setTimeout(2 * CRAWL_WAIT);
    await signIn(page, EDITOR);
    await page.goto('/digibranders/onboarding');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Map Test');
    await page.getByRole('textbox', { name: 'Site' }).fill('map-test.example');
    await expect(page.getByRole('checkbox', { name: /Map this site’s internal links/ })).toBeChecked();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/digibranders\/map-test(\/|$)/);
    // A client navigation: the mock API keeps its state in the page's memory, so no reload
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Internal links' }).click();
    await expect(page.getByRole('heading', { name: /^Mapping / })).toBeVisible();
    const progress = page.getByRole('progressbar', { name: 'URLs found against the crawl limit' });
    await expect(progress).toBeVisible();
    // Queued first, then crawling: the count of pages found leaves zero. The mock never finishes this crawl.
    await expect(progress).not.toHaveAttribute('aria-valuenow', '0', { timeout: CRAWL_WAIT });
    // While it runs there is no table and no tab to switch to
    await expect(page.getByRole('grid')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Set up tier rules' })).toBeVisible();
    await expectAccessible(page);
    await expectNoEquity(page);
  });

  test('Crawl now runs from queued through crawling to ready', async ({ page }) => {
    test.setTimeout(2 * CRAWL_WAIT);
    await signIn(page, EDITOR);
    await openPages(page);
    await expectPagesLoaded(page);
    await expect(page.getByText(/^Crawled .*pages?$/)).toBeVisible();
    await page.getByRole('button', { name: 'Crawl now' }).click();
    await expect(page.getByRole('heading', { name: 'Crawl started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crawling' })).toBeVisible();
    // The banner shows once the crawl leaves the queue; the tables keep showing the last crawl
    await expect(page.getByText(/Crawling now: /)).toBeVisible({ timeout: CRAWL_WAIT });
    await expectPagesLoaded(page);
    await expectAccessible(page);
    // The crawl ends by itself: the button is Crawl now again and the banner is gone
    await expect(page.getByRole('button', { name: 'Crawl now' })).toBeVisible({ timeout: CRAWL_WAIT });
    await expect(page.getByText(/Crawling now: /)).toHaveCount(0);
    await expectPagesLoaded(page);
  });

  test('the Pages tab filters, sorts, opens a page, and exports the table', async ({ page }) => {
    await signIn(page, EDITOR);
    await openPages(page);
    const grid = pagesGrid(page);
    await expectPagesLoaded(page);
    await expectNoEquity(page);
    const all = await grid.getByRole('rowheader').count();
    expect(all).toBeGreaterThan(1);

    // A filter by tier through the chip editor, kept in the address
    await page.getByRole('button', { name: 'Add a filter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tier', exact: true }).click();
    await page.getByRole('dialog').getByRole('checkbox', { name: /^T1/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/[?&]tier=/);
    await expect(page.getByRole('button', { name: /^Tier: .*Edit filter$/ })).toBeVisible();
    await expect.poll(async () => grid.getByRole('rowheader').count()).toBeLessThan(all);
    await expect(grid.getByRole('rowheader').first()).toBeVisible();
    await page.getByRole('button', { name: /^Remove filter Tier/ }).click();
    await expect.poll(async () => grid.getByRole('rowheader').count()).toBe(all);

    // A sort by Clicks (a default column; the table opens sorted by address), in the address and on the header
    const header = grid.getByRole('columnheader', { name: /^Clicks/ });
    await header.getByRole('button', { name: 'Clicks', exact: true }).click();
    await expect(header).toHaveAttribute('aria-sort', /^(ascending|descending)$/);
    await expect(page).toHaveURL(/[?&]sort=-?clicks/);

    // A row opens its inspector over the table; no equity there either
    await grid
      .getByRole('rowheader', { name: /\/pricing/ })
      .first()
      .click();
    await expect(inspectorOf(page, '/pricing')).toBeVisible();
    await expect(page).toHaveURL(/[?&]inspect=page(%3A|:)/);
    await expectNoEquity(page);

    // The card lays over the page header's actions, so the export waits until it is closed
    await page.keyboard.press('Escape');
    await expect(inspectorOf(page, '/pricing')).toBeHidden();

    // The export is a CSV of this tab with the server's columns: none of them is equity
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export this tab (CSV)' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('internal-links-pages.csv');
    const text = await readFile(await download.path(), 'utf8');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/equity/i);
  });

  test('sets the tier of the blog pages in bulk and by rule, and the Tier flow follows', async ({ page }) => {
    await signIn(page, EDITOR);
    await openLinks(page, 'tab=flow');
    await expect(flowTable(page)).toBeVisible();
    await expectNoEquity(page);
    const before = await tierPageCount(page, 'T4');

    // Bulk: every blog page to T4 through the bulk bar
    // Client navigations, not reloads: the mock API's changes live in the page's memory
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Pages', exact: true }).click();
    await page.getByRole('navigation', { name: 'Pages views' }).getByRole('link', { name: 'All pages' }).click();
    await page.getByRole('searchbox', { name: 'Search in table' }).fill('/blog');
    await expect(page).toHaveURL(/[?&]q=/);
    const grid = pagesGrid(page);
    await expect(grid.getByRole('rowheader', { name: /\/blog/ }).first()).toBeVisible();
    await grid.getByRole('checkbox', { name: /^Select all \d+ pages? loaded$/ }).click();
    const bar = page.getByRole('group', { name: /^Bulk actions/ });
    await bar.getByRole('button', { name: 'Set tier' }).click();
    const dialog = page.getByRole('dialog', { name: /^Set the tier of \d+ pages?$/ });
    await dialog.getByRole('radio', { name: /^T4 Utility pages/ }).click();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/pages? (is|are) now T4 Utility pages\.$/)).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expectNoEquity(page);

    // A rule: everything under /industries/ to T2, added as the third rule
    // The rules are edited from the More actions menu of Internal links; the Pages screen has no such item
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Internal links' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Internal links' })).toBeVisible();
    await pickFromMore(page, 'Tier rules');
    const rules = page.getByRole('dialog', { name: 'Tier rules' });
    await rules.getByRole('button', { name: 'Add rule' }).click();
    await rules.getByRole('textbox', { name: 'Rule 3 path' }).fill('/industries/');
    await rules.getByRole('combobox', { name: 'Rule 3 tier' }).click();
    await page.getByRole('option', { name: /^T2 Supporting pages/ }).click();
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(page.getByText('3 rules saved.')).toBeVisible();
    await expect(rules).toBeHidden();

    await page.getByRole('tab', { name: 'Tier flow' }).click();
    await expect(flowTable(page)).toBeVisible();
    await expect.poll(async () => tierPageCount(page, 'T4')).toBeGreaterThan(before);
    await expectNoEquity(page);
  });

  test('checks a CSV of tiers before it applies, and names the line that needs fixing', async ({ page }) => {
    await signIn(page, EDITOR);
    await openLinks(page);
    await pickFromMore(page, 'Import tiers from CSV');
    const dialog = page.getByRole('dialog', { name: 'Import tiers from CSV' });
    const field = dialog.getByRole('textbox', { name: 'Tiers as CSV' });

    await field.fill('url,tier\nhttps://eventussecurity.com/pricing,T1\nhttps://eventussecurity.com/contact,T9');
    await dialog.getByRole('button', { name: 'Check' }).click();
    await expect(dialog.getByText(/Line 3: .* is not a tier of this workspace\./)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply tiers' })).toBeDisabled();

    await field.fill('url,tier\nhttps://eventussecurity.com/pricing,T1\nhttps://eventussecurity.com/contact,T1');
    await dialog.getByRole('button', { name: 'Check' }).click();
    await expect(dialog.getByRole('heading', { name: '2 rows are ready' })).toBeVisible();
    await expect(dialog.getByRole('table', { name: 'Rows to import' })).toBeVisible();
    await expectNoEquity(page);
    await dialog.getByRole('button', { name: 'Apply 2 tiers' }).click();
    await expect(page.getByText('Tiers imported')).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test('the Links tab lists links, changes its scope, and opens from a Tier flow cell', async ({ page }) => {
    await signIn(page, EDITOR);
    await openLinks(page, 'tab=links');
    await waitForState(page, 'links');
    await expectNoEquity(page);

    await page.getByRole('button', { name: /^Link scope:/ }).click();
    await page.getByRole('menuitemradio', { name: 'All links' }).click();
    await expect(page).toHaveURL(/[?&]scope=all/);
    await expect(linksGrid(page).getByRole('rowheader').first()).toBeVisible();

    // A cell of the Tier flow with links in it opens the Links tab on those links
    await page.getByRole('tab', { name: 'Tier flow' }).click();
    await expect(flowTable(page)).toBeVisible();
    await flowTable(page)
      .getByRole('link', { name: /, show them$/ })
      .first()
      .click();
    await expect(page).toHaveURL(/[?&]tab=links/);
    await waitForState(page, 'links');
    await expectNoEquity(page);
  });

  test('follows a journey out and in, changes its layout, opens a page, re-centers and keeps the view on reload', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await openLinks(page, 'tab=journey&focus=103');
    await waitForState(page, 'journey');
    await expect(canvasOf(page).getByRole('heading', { name: 'Step 1 out' })).toBeVisible();
    await expect(canvasOf(page).getByRole('heading', { name: 'Step 1 in' })).toBeVisible();
    await expect(card(page, '/pricing')).toBeVisible();

    // A second step out: opening /pricing shows what it links to
    await card(page, '/pricing').click();
    await expect(card(page, '/pricing')).toHaveAttribute('aria-expanded', 'true');
    await expect(canvasOf(page).getByRole('heading', { name: 'Step 2 out' })).toBeVisible();
    await expect(card(page, '/compare/eventus-vs-in-house-soc')).toBeVisible();

    // The layout by tier keeps the same cards
    await page.getByRole('radio', { name: 'By tier' }).click();
    await expect(page.getByRole('radio', { name: 'By tier' })).toBeChecked();
    await expect(card(page, '/pricing')).toBeVisible();
    await page.getByRole('radio', { name: 'By step' }).click();
    await expect(page.getByRole('radio', { name: 'By step' })).toBeChecked();

    // A card's details open the inspector, which shows no equity
    await card(page, '/contact').hover();
    await canvasOf(page).getByRole('button', { name: 'Details of /contact' }).click();
    await expect(inspectorOf(page, '/contact')).toBeVisible();
    await expect(page).toHaveURL(/[?&]inspect=page(%3A|:)/);
    await expectNoEquity(page);

    // The card lays over the right of the canvas, so the next steps wait until it is closed
    await page.keyboard.press('Escape');
    await expect(inspectorOf(page, '/contact')).toBeHidden();

    // Re-center on /pricing, then the tree list of the same journey
    await card(page, '/pricing').hover();
    await canvasOf(page).getByRole('button', { name: 'Make /pricing the focus' }).click();
    await expect(page).toHaveURL(/[?&]focus=108/);
    await page.getByRole('radio', { name: 'Tree list' }).click();
    await expect(treeOf(page)).toBeVisible();
    await expectNoEquity(page);

    // A reload shows the same view from the address
    await page.reload();
    await expect(treeOf(page)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Focus page: /pricing. Change it.' })).toBeVisible();
  });

  test('the settings screens for page tiers and for the project crawl open and read', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto(TIERS_SETTINGS);
    await expect(page.getByRole('heading', { level: 2, name: 'Page tiers' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Page tiers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add tier' })).toBeVisible();
    await expectNoEquity(page);

    await page.goto(LINKS_SETTINGS);
    await expect(page.getByRole('heading', { level: 2, name: 'Internal links' })).toBeVisible();
    await expect(page.getByText('Recent crawls')).toBeVisible();
    await expectNoEquity(page);

    // The Pages screen's own menu, on All pages
    await page.goto(EVENTUS_PAGES_ALL);
    await expectPagesLoaded(page);
    await pickFromMore(page, 'Crawl settings');
    await expect(page).toHaveURL(/\/eventus-security\/settings\/links$/);
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

    test(`has no axe violations on every tab, density and panel in the ${theme} theme`, async ({ page }) => {
      await withTheme(page);
      await signIn(page, EDITOR);
      // Each state is checked for contrast as drawn: Pages and Links at both densities, the inspector beside
      // a table and beside the canvas, the canvas, its tree list and the Tier flow
      const states = [
        { query: '', kind: 'pages' },
        { query: 'density=default', kind: 'pages' },
        { query: 'inspect=page%3A108', kind: 'pages' },
        { query: 'tab=links', kind: 'links' },
        { query: 'tab=links&density=default', kind: 'links' },
        { query: 'tab=journey&focus=103&open=o%3A108', kind: 'journey' },
        { query: 'tab=journey&focus=103&inspect=page%3A108', kind: 'journey' },
        { query: 'tab=journey&focus=103&jv=tree', kind: 'tree' },
        { query: 'tab=flow', kind: 'flow' },
      ] as const;
      for (const { query, kind } of states) {
        await (kind === 'pages' ? openPages(page, query) : openLinks(page, query));
        await waitForState(page, kind);
        await expectAccessible(page);
        await expectNoEquity(page);
      }

      // The two dialogs of All pages
      await openPages(page);
      await expectPagesLoaded(page);
      await pickFromMore(page, 'Tier rules');
      await expect(
        page.getByRole('dialog', { name: 'Tier rules' }).getByRole('list', { name: 'Rules in order' }),
      ).toBeVisible();
      await expectAccessible(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Tier rules' })).toBeHidden();
      await pickFromMore(page, 'Import tiers from CSV');
      const dialog = page.getByRole('dialog', { name: 'Import tiers from CSV' });
      await dialog
        .getByRole('textbox', { name: 'Tiers as CSV' })
        .fill('url,tier\nhttps://eventussecurity.com/pricing,T1\nhttps://eventussecurity.com/contact,T9');
      await dialog.getByRole('button', { name: 'Check' }).click();
      await expect(dialog.getByText(/is not a tier of this workspace\./)).toBeVisible();
      await expectAccessible(page);
    });

    test(`has no axe violations on the settings screens in the ${theme} theme`, async ({ page }) => {
      await withTheme(page);
      await signIn(page, ADMIN);
      await page.goto(TIERS_SETTINGS);
      await expect(page.getByRole('table', { name: 'Page tiers' })).toBeVisible();
      await expectAccessible(page);
      await page.goto(LINKS_SETTINGS);
      await expect(page.getByText('Recent crawls')).toBeVisible();
      await expectAccessible(page);
    });
  }
});
