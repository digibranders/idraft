import { expect, test } from '@playwright/test';

import { formatInteger } from '../../src/lib/format';
import { expectAccessible } from '../support';
import {
  drawerOf,
  expectNoHorizontalScroll,
  expectStrip,
  FIXTURE,
  FYNIX_CITATIONS,
  gapsTable,
  openCitations,
  ownersOf,
  pagesTable,
  positionOf,
  readDownload,
  REAL,
  scopeOf,
  searchOf,
  stripOf,
  THEME_KEY,
  viewsOf,
} from '../support/ai-citations';

const { enabled, chatgpt } = FIXTURE.expected;
const PAGE_COLUMNS = ['Page', 'Citations', 'Change', 'Prompts', 'Platforms', 'Trend', 'Last cited'];

test.describe('The Citations page (WP-77)', () => {
  test('Cited pages opens on your site: the strip, the owner counts, the table, the footer and the gap badge', async ({
    page,
  }) => {
    await openCitations(page, 1440);
    await expectStrip(page, enabled);
    await expect(viewsOf(page).getByRole('link', { name: 'Cited pages' })).toHaveAttribute('aria-current', 'page');
    await expect(ownersOf(page).getByRole('button', { name: /^Your site/ })).toHaveAttribute('aria-pressed', 'true');

    const table = pagesTable(page);
    // By accessible name: a header's tooltip keeps its text in a hidden node inside the cell, which `toHaveText` reads
    await expect(table.getByRole('columnheader')).toHaveCount(PAGE_COLUMNS.length);
    for (const name of PAGE_COLUMNS) {
      await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }
    await expect(table.getByRole('columnheader', { name: 'Citations' })).toHaveAttribute('aria-sort', 'descending');
    if (!REAL) {
      const owners = ownersOf(page);
      const { pages } = enabled;
      await expect(
        owners.getByRole('button', { name: `Your site ${formatInteger(pages.own)}`, exact: true }),
      ).toBeVisible();
      await expect(
        owners.getByRole('button', { name: `Competitors ${formatInteger(pages.competitor)}`, exact: true }),
      ).toBeVisible();
      await expect(
        owners.getByRole('button', { name: `Third-party ${formatInteger(pages.third_party)}`, exact: true }),
      ).toBeVisible();
      await expect(owners.getByRole('button', { name: `All ${formatInteger(pages.all)}`, exact: true })).toBeVisible();

      // The most cited page of your site is the first row, with its citations and the prompts that cite it
      const first = table.getByRole('row').nth(1);
      await expect(first).toContainText(pages.topOwn.path);
      const cells = first.getByRole('cell');
      await expect(cells.nth(1)).toHaveText(formatInteger(pages.topOwn.citations));
      await expect(cells.nth(3)).toHaveText(new RegExp(`^${String(pages.topOwn.prompts)}\\D`));

      await expect(
        page.getByText(`${formatInteger(pages.own)} pages · ${formatInteger(enabled.strip.citations)} citations`),
      ).toBeVisible();
      // ChatGPT runs at 02:10 and Gemini at 02:12: the freshness is the latest answer in scope
      await expect(page.getByText('Updated Sep 28, 02:12 · run 48')).toBeVisible();
      await expect(viewsOf(page).getByRole('link', { name: /^Gap analysis/ })).toContainText(
        formatInteger(enabled.gaps.gaps),
      );
    }
    await expectAccessible(page);
  });

  test('ChatGPT shows the preview numbers; a header sorts, All widens the table and resets the sort; Reset scope returns', async ({
    page,
  }) => {
    await openCitations(page, 1440);
    await page.getByRole('combobox', { name: 'Platform: All platforms' }).click();
    await page.getByRole('option', { name: /ChatGPT/ }).click();
    await expect(page).toHaveURL(/[?&]platform=chatgpt_web(&|$)/);
    await expect(page.getByRole('combobox', { name: 'Platform: ChatGPT' })).toBeVisible();
    await expectStrip(page, chatgpt);
    if (!REAL) {
      await expect(
        page.getByText(
          `${formatInteger(chatgpt.pages.own)} pages · ${formatInteger(chatgpt.strip.citations)} citations`,
        ),
      ).toBeVisible();
      await expect(page.getByText('Updated Sep 28, 02:10 · run 48')).toBeVisible();
    }

    // A header sorts descending first, then ascending
    const table = pagesTable(page);
    const prompts = table.getByRole('columnheader', { name: 'Prompts' });
    await prompts.getByRole('button').click();
    await expect(prompts).toHaveAttribute('aria-sort', 'descending');
    await prompts.getByRole('button').click();
    await expect(prompts).toHaveAttribute('aria-sort', 'ascending');

    // The owner group widens the table to every owner, shows the Domain type column, and puts the sort back
    await ownersOf(page).getByRole('button', { name: /^All/ }).click();
    await expect(table.getByRole('columnheader', { name: 'Domain type' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Citations' })).toHaveAttribute('aria-sort', 'descending');
    if (!REAL) await expect(page.getByText(new RegExp(`^${formatInteger(chatgpt.pages.all)} pages · `))).toBeVisible();

    // Reset scope puts Platform, Group, Runs and Competitors back; the owner is not part of the scope
    await page.getByRole('button', { name: 'Reset scope' }).click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('platform'));
    await expect(page.getByRole('button', { name: 'Reset scope' })).toHaveCount(0);
    await expectStrip(page, enabled);
  });

  test('Runs and Group change the scope, and Reset scope puts it back', async ({ page }) => {
    await openCitations(page, 1440);
    await page.getByRole('combobox', { name: 'Runs: Last 4 runs' }).click();
    if (!REAL) await expect(page.getByRole('option', { name: /^Last 4 runs/ })).toContainText('28 days');
    await page.getByRole('option', { name: /^Last run/ }).click();
    await expect(page).toHaveURL(/[?&]runs=1(&|$)/);
    await expect(page.getByRole('combobox', { name: 'Runs: Last run' })).toBeVisible();

    // The Group list is searched in its popup; a search with no match says so
    await page.getByRole('combobox', { name: 'Group: All groups' }).click();
    const find = page.getByRole('combobox', { name: 'Search groups' });
    await find.fill('zzzz');
    await expect(page.getByText(/No group matches/)).toBeVisible();
    await find.fill('');
    const second = page.getByRole('option').nth(1);
    const group = ((await second.textContent()) ?? '').trim();
    expect(group).not.toBe('');
    await second.click();
    await expect(page).toHaveURL(/[?&]group=/);
    await expect(page.getByRole('combobox', { name: `Group: ${group}` })).toBeVisible();

    await page.getByRole('button', { name: 'Reset scope' }).click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('runs') && !url.searchParams.has('group'));
    await expect(page.getByRole('combobox', { name: 'Group: All groups' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Runs: Last 4 runs' })).toBeVisible();
    await expectStrip(page, enabled);
  });

  test('"/" focuses the search; a search with no match replaces the table and Clear search brings it back', async ({
    page,
  }) => {
    await openCitations(page, 1440);
    await expect(pagesTable(page).getByRole('row').nth(1)).toBeVisible();
    await page.keyboard.press('/');
    const search = searchOf(page);
    await expect(search).toBeFocused();
    await search.fill('zzzz-no-such-page');
    await expect(page).toHaveURL(/[?&]q=zzzz-no-such-page(&|$)/);
    await expect(page.getByRole('heading', { name: 'No pages match' })).toBeVisible();
    await expect(page.getByText(/^No page of your site contains .zzzz-no-such-page.\.$/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
    await expect(pagesTable(page).getByRole('row').nth(1)).toBeVisible();
    await expect(page).toHaveURL((url) => !url.searchParams.has('q'));

    if (!REAL) {
      // The API searches the address and the title; the owner counts do not follow the search
      await search.fill('pricing');
      await expect(page).toHaveURL(/[?&]q=pricing(&|$)/);
      await expect(pagesTable(page).getByRole('row').nth(1)).toContainText('pricing');
      await expect(
        ownersOf(page).getByRole('button', { name: `Your site ${formatInteger(enabled.pages.own)}`, exact: true }),
      ).toBeVisible();
    }
  });

  test('the prompts popover opens the page drawer, which steps with J and K and has Prompts and Overview', async ({
    page,
  }) => {
    await openCitations(page, 1440, 'platform=chatgpt_web');
    const table = pagesTable(page);
    const chip = table.getByRole('button', { name: /^Prompts that cite / }).first();
    await chip.click();
    const popover = page.getByRole('dialog', { name: /^Prompts that cite / });
    await expect(popover.getByText('Cited for')).toBeVisible();
    if (!REAL) {
      const { topOwn } = chatgpt.pages;
      await expect(popover).toContainText(
        `${formatInteger(topOwn.prompts)} prompts · ${formatInteger(topOwn.citations)} citations`,
      );
      await expect(popover.getByRole('listitem')).toHaveCount(Math.min(topOwn.prompts, 10));
    }
    // Escape closes the popover and puts focus back on the chip that opened it
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(chip).toBeFocused();

    await chip.click();
    await popover.getByRole('button', { name: /^(Show all \d+ prompts|Open the page details)$/ }).click();
    await expect(page).toHaveURL(/[?&]inspect=cited-page(:|%3A)\d+(&|$)/);
    const drawer = drawerOf(page);
    await expect(drawer.getByRole('tablist', { name: 'Cited page sections' })).toBeVisible();
    await expect(positionOf(drawer)).toHaveText(/^1 of \d+$/);
    if (!REAL) {
      const { topOwn } = chatgpt.pages;
      await expect(drawer).toContainText(`${formatInteger(topOwn.citations)} citations`);
      await expect(positionOf(drawer)).toHaveText(`1 of ${formatInteger(chatgpt.pages.own)}`);
      // Prompts: one row for each prompt that cites the page
      await expect(drawer.getByRole('table', { name: 'Prompts that cite this page' }).getByRole('row')).toHaveCount(
        topOwn.prompts + 1,
      );
    }

    // Overview: the summary, the trend, the platforms and the domains cited beside the page
    await drawer.getByRole('tab', { name: 'Overview' }).click();
    await expect(drawer.getByRole('heading', { name: 'Summary' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Citations per run' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Cited alongside' })).toBeVisible();
    // One engine is in scope: the header row and one row
    await expect(drawer.getByRole('table', { name: 'By platform' }).getByRole('row')).toHaveCount(2);
    if (!REAL) {
      await expect(drawer.getByRole('definition').first()).toContainText(formatInteger(chatgpt.pages.topOwn.citations));
    }
    await expectAccessible(page);

    // J and K step through the table's order, from inside the drawer
    await drawer.getByRole('heading', { level: 2 }).focus();
    await page.keyboard.press('j');
    await expect(positionOf(drawer)).toHaveText(/^2 of \d+$/);
    await page.keyboard.press('k');
    await expect(positionOf(drawer)).toHaveText(/^1 of \d+$/);

    // Escape closes the drawer and puts focus back on the row that opened it
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL((url) => !url.searchParams.has('inspect'));
    await expect(table.getByRole('button', { name: /^Open / }).first()).toBeFocused();
  });

  test('Gap analysis: the table, the gap drawer on both tabs, the competitors popover, Only gaps and no competitors', async ({
    page,
  }) => {
    await openCitations(page, 1440);
    await viewsOf(page)
      .getByRole('link', { name: /^Gap analysis/ })
      .click();
    await expect(page).toHaveURL(/\/ai\/citations\/gaps/);
    await expect(viewsOf(page).getByRole('link', { name: /^Gap analysis/ })).toHaveAttribute('aria-current', 'page');
    const table = gapsTable(page);
    await expect(table).toBeVisible();
    // Prompt, Group, you, the three default competitors, Lost on
    await expect(table.getByRole('columnheader')).toHaveCount(7);
    await expect(table.getByRole('columnheader', { name: 'Lost on' })).toHaveAttribute('aria-sort', 'descending');
    const { gaps } = enabled;
    if (!REAL) {
      await expect(
        page.getByText(
          `${formatInteger(gaps.gaps)} of ${formatInteger(gaps.prompts)} prompts lost to a competitor on at least one platform`,
        ),
      ).toBeVisible();
      await expect(page.getByText(`${formatInteger(gaps.gaps)} prompts with a gap`)).toBeVisible();
      await expect(table.getByRole('row').nth(1)).toContainText(gaps.first);
    }
    await expect(page.getByRole('checkbox', { name: 'Only gaps' })).toBeChecked();
    await expectAccessible(page);

    // The gap drawer: who is cited, then the same by platform
    const open = table.getByRole('button', { name: /^Open / }).first();
    await open.click();
    await expect(page).toHaveURL(/[?&]inspect=gap-prompt(:|%3A)/);
    const drawer = drawerOf(page);
    await expect(drawer.getByRole('tablist', { name: 'Prompt gap sections' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Open answers' })).toBeVisible();
    const who = drawer.getByRole('table', { name: 'Who is cited' });
    await expect(who).toBeVisible();
    if (!REAL) {
      await expect(drawer.getByRole('heading', { level: 2 })).toHaveText(gaps.first);
      await expect(positionOf(drawer)).toHaveText(`1 of ${formatInteger(gaps.gaps)}`);
      // You and the three competitors, under the header row
      await expect(who.getByRole('row')).toHaveCount(5);
    }
    await expect(drawer.getByRole('heading', { name: 'Pages competitors win with' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Your closest page' })).toBeVisible();
    await drawer.getByRole('tab', { name: 'By platform' }).click();
    const byPlatform = drawer.getByRole('table', { name: 'By platform' });
    await expect(byPlatform).toBeVisible();
    // Platform, you and three competitors; one row for each platform in scope
    await expect(byPlatform.getByRole('columnheader')).toHaveCount(5);
    if (!REAL) await expect(byPlatform.getByRole('row')).toHaveCount(3);
    await expectAccessible(page);
    await drawer.getByRole('tab', { name: 'Gap' }).click();
    await drawer.getByRole('heading', { level: 2 }).focus();
    await page.keyboard.press('j');
    await expect(positionOf(drawer)).toHaveText(/^2 of \d+$/);
    await page.keyboard.press('k');
    await expect(positionOf(drawer)).toHaveText(/^1 of \d+$/);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();

    // The competitors popover: three of five, a fourth adds a column, and the choice is in the address
    await page.getByRole('button', { name: /^Competitors: / }).click();
    const picker = page.getByRole('dialog', { name: 'Competitors to compare' });
    await expect(picker.getByText('3 of 5')).toBeVisible();
    const boxes = picker.getByRole('checkbox');
    if (!REAL) await expect(boxes).toHaveCount(5);
    // A row's label stretches over it, so a click lands on the label and the box takes it
    await boxes.nth(3).check({ force: true });
    await expect(picker.getByText('4 of 5')).toBeVisible();
    await expect(page).toHaveURL(/[?&]comp=/);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(table.getByRole('columnheader')).toHaveCount(8);

    // Only gaps off lists every prompt with an answer
    await page.getByRole('checkbox', { name: 'Only gaps' }).uncheck();
    await expect(page).toHaveURL(/[?&]gaps=all(&|$)/);
    if (!REAL) await expect(page.getByText(`${formatInteger(gaps.prompts)} prompts`, { exact: true })).toBeVisible();

    // No competitors: the table gives way to the way to choose them
    await page.getByRole('button', { name: /^Competitors: / }).click();
    for (let index = 0; index < 4; index += 1) await boxes.nth(index).uncheck({ force: true });
    await expect(picker.getByText('0 of 5')).toBeVisible();
    await expect(page).toHaveURL(/[?&]comp=(&|$)/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Choose competitors to compare' })).toBeVisible();
    await page.getByRole('button', { name: 'Choose competitors' }).click();
    await expect(picker).toBeVisible();
  });

  test('Export writes the CSV of the tab on screen', async ({ page }) => {
    await openCitations(page, 1440);
    await expect(pagesTable(page).getByRole('row').nth(1)).toBeVisible();
    const [pages] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);
    expect(pages.suggestedFilename()).toBe('cited-pages.csv');
    const [pagesHeader = '', ...pageRows] = await readDownload(pages);
    expect(pagesHeader).toMatch(
      /^URL,Title,Domain type,Brand,Citations,Citations before,Prompts,Top prompt,Last cited,ChatGPT citations/,
    );
    if (!REAL) expect(pageRows).toHaveLength(enabled.pages.own);
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(/Exported \d+ rows?/);

    await viewsOf(page)
      .getByRole('link', { name: /^Gap analysis/ })
      .click();
    await expect(gapsTable(page).getByRole('row').nth(1)).toBeVisible();
    const [gapsFile] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);
    expect(gapsFile.suggestedFilename()).toBe('gap-analysis.csv');
    const [gapsHeader = '', ...gapRows] = await readDownload(gapsFile);
    expect(gapsHeader).toMatch(/^Prompt,Group,.+,Lost on,Lost to$/);
    if (!REAL) expect(gapRows).toHaveLength(enabled.gaps.gaps);
  });

  test('an old link moves onto the new keys, and the query does not follow to another page', async ({ page }) => {
    await openCitations(page, 1440, 'tab=domains&role=third_party&win=7d&cmp=off');
    await expect(page).toHaveURL(/\/ai\/citations\?owner=third$/);
    await expect(ownersOf(page).getByRole('button', { name: /^Third-party/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Topics & Prompts' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeAttached();
    await expect(page).not.toHaveURL(/owner=third/);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`at 375 px in the ${theme} theme the scope is two columns, the panel keeps 384 px and the drawer is a sheet`, async ({
      page,
    }) => {
      await page.addInitScript(
        ([key, value]) => {
          window.localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
      await openCitations(page, 375);
      // Two columns, and no Reset scope while the scope is the default
      const columns = await scopeOf(page).evaluate(
        (group) => getComputedStyle(group).gridTemplateColumns.split(' ').length,
      );
      expect(columns).toBe(2);
      await expect(page.getByRole('button', { name: 'Reset scope' })).toHaveCount(0);
      await expect(stripOf(page)).toBeVisible();
      const panel = pagesTable(page).locator('xpath=ancestor::section[1]');
      expect((await panel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(384);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);

      await pagesTable(page)
        .getByRole('button', { name: /^Open / })
        .first()
        .click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('tab', { name: 'Prompts' })).toBeVisible();
      await sheet.getByRole('button', { name: 'Back to Citations' }).click();
      await expect(sheet).toBeHidden();

      // Gap analysis at the same width: the panel scrolls sideways, not the page
      await viewsOf(page)
        .getByRole('link', { name: /^Gap analysis/ })
        .click();
      await expect(gapsTable(page)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
    });
  }

  for (const width of [768, 1024] as const) {
    test(`is accessible at ${String(width)} px with the drawer open`, async ({ page }) => {
      await openCitations(page, width, 'platform=chatgpt_web');
      await expectAccessible(page);
      await pagesTable(page)
        .getByRole('button', { name: /^Open / })
        .first()
        .click();
      await expect(drawerOf(page).getByRole('tablist', { name: 'Cited page sections' })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
    });
  }
});

test.describe('The Citations address', () => {
  test('lands on Cited pages at /ai/citations and Gap analysis at /ai/citations/gaps', async ({ page }) => {
    await openCitations(page, 1440);
    await expect(page).toHaveURL(new RegExp(`${FYNIX_CITATIONS}$`));
    await page.goto(`${FYNIX_CITATIONS}/gaps`);
    await expect(gapsTable(page)).toBeVisible();
  });
});
