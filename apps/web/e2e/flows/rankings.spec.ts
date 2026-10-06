import { writeFileSync } from 'node:fs';

import { expect, test, type Locator } from '@playwright/test';

import { expectAccessible, signIn } from '../support';

const EDITOR = 'priya@digibranders.test';

/** The header of the column `name`: its accessible name is the label and the name of its options button. */
function headerOf(grid: Locator, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return grid.getByRole('columnheader', { name: new RegExp(`^${escaped} ${escaped} column options$`) });
}

/** The place of a column among the cells of a row. */
async function indexOf(grid: Locator, name: string): Promise<number> {
  const index = await headerOf(grid, name).evaluate((cell) =>
    cell instanceof HTMLTableCellElement ? cell.cellIndex : -1,
  );
  if (index < 0) throw new Error(`The column ${name} has no cell index`);
  return index;
}

/** The cell of `row` under the column `name` (the row header is the first cell of a row). */
async function cellOf(grid: Locator, row: Locator, name: string): Promise<Locator> {
  return row.locator('th, td').nth(await indexOf(grid, name));
}

/**
 * The text of every body cell under the column `name`, row by row in the order shown. With `visible` the words
 * that are only for a screen reader are left out: a rank cell reads "12" though it also says "stale".
 */
async function columnOf(
  grid: Locator,
  name: string,
  { visible = false }: { visible?: boolean } = {},
): Promise<string[]> {
  const index = await indexOf(grid, name);
  return grid.locator('tbody tr[role="row"]').evaluateAll(
    (rows, [at, shown]) => {
      const read = (node: Node): string =>
        node instanceof Element && node.classList.contains('sr-only')
          ? ''
          : node.nodeType === Node.TEXT_NODE
            ? (node.textContent ?? '')
            : [...node.childNodes].map(read).join('');
      return rows.flatMap((tr) => {
        const cell = tr instanceof HTMLTableRowElement ? tr.cells[Number(at)] : undefined;
        return cell === undefined ? [] : [shown === true ? read(cell) : (cell.textContent ?? '')];
      });
    },
    [index, visible] as const,
  );
}

test.describe('rankings', () => {
  test('a project opens on Rankings, and a filter and the archived view live in the URL', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix');
    await expect(page).toHaveURL(/\/digibranders\/fynix\/seo\/rankings$/);
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(grid.getByRole('rowheader').first()).toContainText('seo agency');
    await expect(page.getByText('59 keywords', { exact: true }).first()).toBeVisible();
    await expectAccessible(page);

    // Intent: Commercial through the chip editor
    await page.getByRole('button', { name: 'Add a filter' }).click();
    // The field picker, not the Intent column's header
    await page.getByRole('dialog').getByRole('button', { name: 'Intent' }).click();
    await page.getByRole('dialog').getByRole('checkbox', { name: 'Commercial' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/[?&]intent=commercial/);
    await expect(page.getByRole('button', { name: 'Intent: Commercial. Edit filter' })).toBeVisible();
    await expect(page.getByText('24 keywords', { exact: true }).first()).toBeVisible();

    // The archived view, kept across a reload
    await page.getByRole('button', { name: 'Remove filter Intent: Commercial' }).click();
    await page.getByRole('radio', { name: 'Archived' }).click();
    await expect(page).toHaveURL(/[?&]archived=true/);
    await page.reload();
    await expect(page.getByText('3 keywords', { exact: true }).first()).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: /seo meme/ })).toBeVisible();
    await expectAccessible(page);
  });

  test('Rank, Change and the ranking URL show for the keywords, sort by rank, and filter by a bucket', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    for (const name of ['Rank', 'Change', 'Ranking URL']) {
      await expect(headerOf(grid, name)).toBeVisible();
    }
    // Ranked keywords show a number and an arrow, a keyword beyond the depth shows the depth it was checked at,
    // and the one still waiting for its first check says so
    await expect(grid.getByText(/^[↑↓]\d+$/).first()).toBeVisible();
    await expect(grid.getByText(/^>\d+$/).first()).toBeVisible();
    await expect(grid.getByText('Pending').first()).toBeVisible();
    await expect(grid.getByRole('img', { name: 'Check failed' })).toHaveCount(1);
    await expectAccessible(page);

    // Best rank first, and the keywords with no rank last
    await grid.getByRole('button', { name: 'Rank', exact: true }).click();
    await expect(headerOf(grid, 'Rank')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/[?&]sort=current_rank/);
    const places = await columnOf(grid, 'Rank', { visible: true });
    const ranked = places.filter((text) => /^\d+$/.test(text)).map(Number);
    expect(ranked.length).toBeGreaterThan(5);
    expect(ranked).toEqual([...ranked].sort((a, b) => a - b));
    expect(places.slice(0, ranked.length).every((text) => /^\d+$/.test(text))).toBe(true);
    expect(places.slice(ranked.length).some((text) => /^\d+$/.test(text))).toBe(false);

    // Rank 4 to 10 only, through the chip
    await page.getByRole('button', { name: 'Add a filter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Rank' }).click();
    await page.getByRole('dialog').getByRole('radio', { name: '4 to 10' }).click();
    await expect(page).toHaveURL(/[?&]rank=top10/);
    await expect(page.getByRole('button', { name: 'Rank: 4 to 10. Edit filter' })).toBeVisible();
    await expect.poll(async () => (await columnOf(grid, 'Rank')).length).toBeGreaterThan(0);
    const inRange = (await columnOf(grid, 'Rank', { visible: true })).map(Number);
    expect(inRange.every((place) => place >= 4 && place <= 10)).toBe(true);
    await expectAccessible(page);
  });

  test('the Keyword column keeps its room at 1280, 1440 and 1680 px, with the rank columns in view', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    const RANK = ['Rank', 'Change', 'Ranking URL', 'Volume', 'KD', 'CPC (USD)'];
    for (const [width, columns, room, updated] of [
      [1280, RANK, 320, false],
      [1440, [...RANK, 'Intent', 'Priority', 'Group'], 280, false],
      // Every column of the set shows: the Keyword column is at its 200 px minimum, and the others give up width
      [1680, [...RANK, 'Intent', 'Priority', 'Group', 'Tags', 'Updated', 'Added'], 200, true],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/digibranders/fynix/seo/rankings');
      const grid = page.getByRole('grid', { name: 'Tracked keywords' });
      await expect(grid.getByRole('rowheader').first()).toBeVisible();
      for (const name of columns) {
        await expect(headerOf(grid, name)).toBeVisible();
      }
      // The tiers: Updated waits for 1680 px, Best rank for the chooser
      await expect(headerOf(grid, 'Updated')).toHaveCount(updated ? 1 : 0);
      await expect(headerOf(grid, 'Best rank')).toHaveCount(0);
      const keyword = await headerOf(grid, 'Keyword').boundingBox();
      if (keyword === null) throw new Error('The Keyword header has no box');
      expect(keyword.width).toBeGreaterThanOrEqual(room);
      // The header of each rank column shows its whole name, not cut short, and Change keeps 84 px at any width
      for (const name of ['Rank', 'Change', 'Ranking URL']) {
        const label = headerOf(grid, name).locator('.truncate').first();
        expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      const change = await headerOf(grid, 'Change').boundingBox();
      expect(change?.width ?? 0).toBeGreaterThanOrEqual(84);
    }
  });

  test('a stale rank is marked in the Rank cell at every width, and a long ranking URL keeps its end in view', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    for (const width of [1280, 1680]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/digibranders/fynix/seo/rankings');
      const grid = page.getByRole('grid', { name: 'Tracked keywords' });
      await expect(grid.getByRole('rowheader').first()).toBeVisible();

      // The API flags four fixture keywords stale: one has a rank, one a rank and failed checks since, one never
      // had a good check. Each says so in its Rank cell, however narrow the table; Updated shows it from 1680 px
      const ranks = await columnOf(grid, 'Rank');
      expect(ranks.filter((text) => text.includes('stale'))).toHaveLength(4);
      expect(ranks.filter((text) => text.includes('last check failed'))).toHaveLength(1);
      await expect(headerOf(grid, 'Updated')).toHaveCount(width >= 1680 ? 1 : 0);
      if (width >= 1680) {
        const updated = await columnOf(grid, 'Updated');
        expect(updated.filter((text) => text.includes('Stale'))).toHaveLength(4);
        // The keyword whose every check failed says so and carries the marker too
        expect(updated.filter((text) => text.includes('Check failed') && text.includes('Stale'))).toHaveLength(1);
      }
      // No Updated cell or Ranking URL cell spills out of its column over the next one
      const spill = await grid.locator('tbody tr[role="row"]').evaluateAll((rows) => {
        const names = [...document.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
        const found: string[] = [];
        for (const tr of rows) {
          if (!(tr instanceof HTMLTableRowElement)) continue;
          [...tr.cells].forEach((cell, at) => {
            const name = names[at] ?? '';
            if (!/^(Updated|Ranking URL)/.test(name)) return;
            const room = cell.getBoundingClientRect();
            for (const child of cell.querySelectorAll('*')) {
              if (child.closest('.sr-only')) continue;
              const box = child.getBoundingClientRect();
              if (box.width > 0 && (box.right > room.right + 0.5 || box.left < room.left - 0.5)) found.push(name);
            }
          });
        }
        return found;
      });
      expect(spill).toEqual([]);

      // A path of 28 or more characters: its last characters are in view, inside its cell, never cut by an ellipsis
      const long = grid.getByRole('gridcell').filter({ hasText: '/blog/how-to-choose-an-seo-agency' }).first();
      await expect(long).toBeVisible();
      const tail = long.locator('.shrink-0').first();
      await expect(tail).toHaveText(/seo-agency$/);
      const cellBox = await long.boundingBox();
      const tailBox = await tail.boundingBox();
      if (cellBox === null || tailBox === null) throw new Error('The ranking URL cell has no box');
      expect(tailBox.x + tailBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 0.5);
      expect(await tail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
  });

  test('a keyword and its ranking URL copy from the row, and the URL opens in a new tab while the inspector stays shut', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(grid.getByRole('rowheader').first()).toBeVisible();
    // The first keyword that ranks with a URL; its row header is named by the keyword alone
    const opens = /^Open \/.* in a new tab$/;
    const row = grid
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: opens }) })
      .first();
    const keyword = await row.getByRole('rowheader').getAttribute('aria-label');
    if (keyword === null || keyword === '') throw new Error('The keyword row header has no name');
    const clipboard = (): Promise<string> => page.evaluate(() => navigator.clipboard.readText());
    const copyKeyword = row.getByRole('button', { name: `Copy keyword ${keyword}` });
    const link = row.getByRole('link', { name: opens });
    const copyUrl = row.getByRole('button', { name: 'Copy ranking URL' });

    // Drawn on hover only (by opacity: the button is in the page the whole time)
    await expect(copyKeyword.locator('..')).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(copyKeyword.locator('..')).toHaveCSS('opacity', '1');
    await expect(copyUrl.locator('..')).toHaveCSS('opacity', '1');
    await expectAccessible(page);

    // The keyword, then a check for a moment, then the glyph again
    await copyKeyword.click();
    await expect.poll(clipboard).toBe(keyword);
    await expect(row.getByRole('button', { name: 'Copied' })).toHaveCount(1);
    await expect(copyKeyword).toBeVisible();

    // The whole address as the API sent it, which is what the link opens
    const href = await link.getAttribute('href');
    if (href === null) throw new Error('The ranking URL link has no href');
    expect(href).toMatch(/^https:\/\//);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await copyUrl.click();
    await expect.poll(clipboard).toBe(href);

    // Clicking a control never opens the keyword
    await expect(page.getByRole('complementary', { name: keyword })).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]inspect=/);

    // The link opens a tab of its own. The fixture addresses are made up: the request is answered here
    await context.route(href, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }));
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(new URL(href).href);
    await popup.close();
    await expect(page.getByRole('complementary', { name: keyword })).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]inspect=/);

    // From the keyboard: F2 into the cell, Tab between its controls, Enter copies, Escape comes back
    await page.evaluate(() => navigator.clipboard.writeText(''));
    const urlCell = await cellOf(grid, row, 'Ranking URL');
    await urlCell.focus();
    await page.keyboard.press('F2');
    await expect(link).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(copyUrl).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(clipboard).toBe(href);
    await page.keyboard.press('Escape');
    await expect(urlCell).toBeFocused();
    await expect(page.getByRole('complementary', { name: keyword })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('a keyword opens in the inspector, steps with J, and saves a setting in place', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await grid.getByRole('rowheader').first().click();
    const inspector = page.getByRole('complementary', { name: 'seo agency' });
    await expect(inspector).toBeVisible();
    await expect(page).toHaveURL(/[?&]inspect=keyword%3A|[?&]inspect=keyword:/);
    await expect(inspector.getByText('1 of 59')).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'Search volume by month' })).toBeVisible();
    await expectAccessible(page);

    await page.keyboard.press('j');
    const next = page.getByRole('complementary', { name: 'backlink checker' });
    await expect(next.getByText('2 of 59')).toBeVisible();

    await next.getByRole('button', { name: 'Edit Tracking' }).click();
    await next.getByRole('combobox', { name: 'Priority' }).click();
    await page.getByRole('option', { name: '2' }).click();
    await next.getByRole('button', { name: 'Save' }).click();
    await expect(next.getByRole('button', { name: 'Save' })).toBeHidden();
    await expect(next.getByText('2', { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test('a setting saved in the inspector is still there after a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await grid.getByRole('rowheader').first().click();
    const inspector = page.getByRole('complementary', { name: 'seo agency' });
    await inspector.getByRole('button', { name: 'Edit Tracking' }).click();
    await inspector.getByRole('textbox', { name: 'Target URL' }).fill('https://fynix.example/seo-agency');
    await inspector.getByRole('button', { name: 'Save' }).click();
    await expect(inspector.getByRole('button', { name: 'Save' })).toBeHidden();
    await expect(inspector.getByText('https://fynix.example/seo-agency', { exact: true })).toBeVisible();

    // The URL still names the keyword, so the inspector opens on it again; the target comes from the API
    await page.reload();
    const reopened = page.getByRole('complementary', { name: 'seo agency' });
    await expect(reopened.getByText('https://fynix.example/seo-agency', { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test('chosen keywords get a new priority from the bulk bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('checkbox', { name: 'Select seo agency, desktop, United States', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    await expect(bar.getByText('2 selected')).toBeVisible();
    await bar.getByRole('button', { name: 'Set priority' }).click();
    const dialog = page.getByRole('dialog', { name: 'Priority for 2 keywords' });
    await dialog.getByRole('combobox', { name: 'Priority' }).click();
    await page.getByRole('option', { name: '5, lowest' }).click();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Set for 2 keywords' }).click();
    await expect(page.getByText('Priority 5 set for 2 keywords')).toBeVisible();
    await expect(bar).toBeHidden();
  });

  test('the bulk bar at 1280 px with the inspector open keeps every action in sight, Archive and Delete in the More menu', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await grid.getByRole('rowheader').first().click();
    await expect(page.getByRole('complementary', { name: 'seo agency' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    await expect(bar.getByText('1 selected')).toBeVisible();

    // At 1280 px the card lays over the list. Every control the bar shows is inside the bar, in view and
    // clear of the card, so none is clipped or covered yet reachable by Tab
    const barBox = await bar.boundingBox();
    const cardBox = await page.getByRole('complementary', { name: 'seo agency' }).boundingBox();
    if (barBox === null || cardBox === null) throw new Error('The bulk bar or the inspector has no box');
    expect(cardBox.x).toBeLessThan(barBox.x + barBox.width);
    for (const button of await bar.getByRole('button').all()) {
      const box = await button.boundingBox();
      if (box === null) throw new Error('A button of the bulk bar has no box');
      expect(box.x).toBeGreaterThanOrEqual(barBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x);
      await expect(button).toBeInViewport({ ratio: 1 });
    }

    // What did not fit is in the More menu, with Delete last
    await bar.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    const items = await page.getByRole('menuitem').allTextContents();
    expect(items.at(-1)).toBe('Delete');
    await page.keyboard.press('Escape');
    await expectAccessible(page);
  });

  test('chosen keywords move to a group, are archived, and come back with Undo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(page.getByText('59 keywords', { exact: true }).first()).toBeVisible();
    const rowOf = (keyword: string): Locator =>
      grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${keyword}`) }) });
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    const choose = async (): Promise<void> => {
      await page.getByRole('checkbox', { name: 'Select seo agency, desktop, United States', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
      await expect(bar.getByText('2 selected')).toBeVisible();
    };

    // Neither keyword is in a group; the move puts both in Brand, an existing one
    await expect(rowOf('backlink checker')).not.toContainText('Brand');
    await choose();
    await bar.getByRole('button', { name: 'Move to group' }).click();
    const move = page.getByRole('dialog', { name: 'Move 2 keywords' });
    await move.getByRole('combobox', { name: 'Group' }).click();
    await page.getByRole('option', { name: /^Brand/ }).click();
    await move.getByRole('button', { name: 'Move 2 keywords' }).click();
    await expect(page.getByText('2 keywords moved to Brand')).toBeVisible();
    await expect(rowOf('backlink checker')).toContainText('Brand');
    await expect(rowOf('seo agency').first()).toContainText('Brand');

    // Archiving needs no question below 100 keywords: the rows leave and the toast offers Undo
    await choose();
    await bar.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('2 keywords archived')).toBeVisible();
    await expect(page.getByText('57 keywords', { exact: true }).first()).toBeVisible();
    await expect(rowOf('backlink checker')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('2 keywords unarchived')).toBeVisible();
    await expect(page.getByText('59 keywords', { exact: true }).first()).toBeVisible();
    await expect(rowOf('backlink checker')).toContainText('Brand');
    await expectAccessible(page);
  });

  test('a group is created while moving keywords, then renamed in Manage groups', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('checkbox', { name: 'Select seo agency, desktop, United States', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    await bar.getByRole('button', { name: 'Move to group' }).click();
    const move = page.getByRole('dialog', { name: 'Move 2 keywords' });
    await move.getByRole('combobox', { name: 'Group' }).fill('E2E/Group');
    await page.getByRole('option', { name: 'Create group “E2E/Group”' }).click();
    await expectAccessible(page);
    await move.getByRole('button', { name: 'Move 2 keywords' }).click();
    await expect(page.getByText('2 keywords moved to E2E/Group')).toBeVisible();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Manage groups' }).click();
    const manage = page.getByRole('dialog', { name: 'Manage groups' });
    const tree = manage.getByRole('tree', { name: 'Keyword groups' });
    await tree.getByRole('treeitem', { name: 'E2E' }).click();
    await page.keyboard.press('ArrowRight');
    await tree.getByRole('treeitem', { name: 'Group', exact: true }).click();
    await manage.getByRole('button', { name: 'Rename' }).click();
    await manage.getByRole('textbox', { name: 'Rename Group' }).fill('Renamed');
    await expectAccessible(page);
    await manage.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Group renamed to Renamed')).toBeVisible();
    await expect(tree.getByRole('treeitem', { name: 'Renamed' })).toHaveAttribute('aria-selected', 'true');
    await manage.getByRole('button', { name: 'Close' }).last().click();
    await expect(manage).toBeHidden();
  });

  test('keywords are added from the header, appear pending, and fill with metrics once they arrive', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    // The mocks read the page's clock: Labs answers 2 minutes after a keyword is added, and the screen asks
    // again every 30 seconds while a row waits. The clock is moved by hand instead of waited for.
    await page.clock.install();
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('button', { name: 'Add keywords' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add keywords' });
    await dialog.getByRole('textbox', { name: 'Keywords' }).fill('seo reporting tool\nSEO Reporting Tool');
    await expect(dialog.getByText('1 keyword · 1 repeat left out')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Add 1 keyword' }).click();
    await expect(page.getByText('1 keyword added')).toBeVisible();
    await page.getByRole('searchbox', { name: /Search/ }).fill('seo reporting');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    const row = grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /seo reporting tool/ }) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Pending').first()).toBeVisible();
    // Before its first check the rank and the ranking URL say Pending, and the metrics do (3 more cells)
    const waiting = await row.getByText('Pending').count();
    expect(waiting).toBeGreaterThanOrEqual(5);

    // The 2 minutes pass: the next poll brings the metrics, and the row stops waiting for them. Its first
    // rank check comes a minute later, so the rank and the ranking URL still say Pending
    await page.clock.runFor(150_000);
    await expect(row.getByText('Pending')).toHaveCount(2);
    await expect(row.getByRole('gridcell').filter({ hasText: /^\d[\d,]*$/ })).not.toHaveCount(0);

    // The first check has run: the poll that follows fills the rank in, with no reload
    await page.clock.runFor(60_000);
    await expect(row.getByText('Pending')).toHaveCount(0);
    const rank = await cellOf(grid, row, 'Rank');
    await expect(rank).toHaveText(/^(\d+|>\d+not in top \d+)$/);
  });

  test('metrics are refreshed from More actions, and the run is followed in the header', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await expect(page.getByText('59 keywords', { exact: true }).first()).toBeVisible();

    // The menu says how many manual runs the project has left today
    await page.getByRole('button', { name: 'More actions' }).click();
    const item = page.getByRole('menuitem', { name: /Refresh metrics/ });
    await expect(item).toContainText('20 of 20 left today');
    await expect(page.getByRole('menuitem', { name: 'Manage groups' })).toBeVisible();
    await item.click();

    const dialog = page.getByRole('dialog', { name: 'Refresh metrics' });
    await expect(dialog.getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
    await expect(dialog.getByText('20 of 20 manual runs left today.')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Refresh metrics' }).click();
    await expect(dialog).toBeHidden();

    // Queued at once, then running; the run ends with one toast
    // (the live region says it aloud too, so the header is named)
    const header = page.locator('#main-content');
    await expect(header.getByText('Metrics refresh queued')).toBeVisible();
    await expect(header.getByText('Refreshing metrics')).toBeVisible({ timeout: 15_000 });
    await expectAccessible(page);
    await expect(page.getByText(/^Metrics refreshed: \d+ of \d+ read$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('progressbar')).toBeHidden();

    // The day's count moved on with the run
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Refresh metrics/ })).toContainText('19 of 20 left today');
  });

  test('keywords are imported from a CSV file, and the write is followed in the header', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(page.getByText('59 keywords', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page).toHaveURL(/\/seo\/rankings\/import$/);
    const dialog = page.getByRole('dialog', { name: 'Import keywords' });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);

    // Three new keywords and one that Fynix tracks already
    const file = testInfo.outputPath('keywords.csv');
    writeFileSync(
      file,
      'keyword,tags\nimport test one,e2e\nimport test two,e2e\nseo audit,e2e\nimport test three,e2e\n',
    );
    await dialog.locator('input[type="file"]').setInputFiles(file);
    await expect(dialog.getByText(/^keywords\.csv, /)).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    // The file's columns, read in the browser; the tags need the vocabulary they belong to
    await expect(dialog.getByText(/^Choose what each column of the file holds/)).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'keyword' })).toContainText('Keyword');
    await expect(dialog.getByText('Choose the vocabulary these terms belong to.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Vocabulary for tags' }).click();
    await page.getByRole('option', { name: 'Topics' }).click();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Continue' }).click();

    const summary = dialog.getByRole('group', { name: 'Rows by outcome' });
    await expect(summary).toContainText('New3');
    await expect(summary).toContainText('Duplicate1');
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('3 keywords are tracked')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Import 3 keywords' }).click();

    // The dialog is gone, the table stays, and the header follows the write until the report is ready
    await expect(page).toHaveURL(/\/seo\/rankings$/);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
    await expect(page.getByRole('progressbar', { name: 'Importing keywords' })).toBeVisible();
    await expect(page.getByText('Import finished: 3 added, 1 skipped')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('progressbar', { name: 'Importing keywords' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Download report' })).toBeVisible();

    await page.getByRole('searchbox', { name: /Search/ }).fill('import test');
    await expect(grid.getByRole('rowheader', { name: /import test one/ })).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: /import test three/ })).toBeVisible();
  });

  test('the review step lists an invalid row with its reason and a duplicate, and the choice changes the outcome', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings/import');
    const dialog = page.getByRole('dialog', { name: 'Import keywords' });
    await expect(dialog).toBeVisible();

    // One new keyword, one search operator (not tracked) and one that Fynix tracks already
    const file = testInfo.outputPath('review.csv');
    writeFileSync(file, 'keyword\nimport review one\nsite:fynix.example\nseo audit\n');
    await dialog.locator('input[type="file"]').setInputFiles(file);
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText(/^Choose what each column of the file holds/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    const summary = dialog.getByRole('group', { name: 'Rows by outcome' });
    await expect(summary).toContainText('New1');
    await expect(summary).toContainText('Duplicate1');
    await expect(summary).toContainText('Invalid1');

    // The invalid row says why, in words
    const invalid = dialog.getByRole('region', { name: 'Invalid' });
    await expect(invalid.getByText('Row 2')).toBeVisible();
    await expect(invalid.getByText('site:fynix.example')).toBeVisible();
    await expect(invalid.getByText('Search operators such as site: are not tracked.')).toBeVisible();
    const duplicates = dialog.getByRole('region', { name: 'Duplicate' });
    await expect(duplicates.getByRole('radio', { name: 'Skip them' })).toBeChecked();
    await expect(duplicates.getByText('seo audit')).toBeVisible();
    await expect(duplicates.getByText('Row 3')).toBeVisible();
    await expectAccessible(page);

    // Skipped by default: only the new keyword is written, and the other two rows go to the report
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('1 keyword is tracked')).toBeVisible();
    await expect(dialog.getByText('2 rows are skipped and listed in the report')).toBeVisible();

    // Back on Review, merging the duplicates changes what Confirm says
    await dialog.getByRole('button', { name: 'Back' }).click();
    await duplicates.getByRole('radio', { name: 'Add their groups and tags to the tracked keywords' }).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText("1 tracked keyword gets the file's groups and tags")).toBeVisible();
    await expect(dialog.getByText('1 row is skipped and listed in the report')).toBeVisible();
    await dialog.getByRole('button', { name: 'Import 1 keyword' }).click();
    await expect(page.getByText(/^Import finished: 1 added, 1 updated, 1 skipped$/)).toBeVisible({ timeout: 30_000 });
  });
});
