import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible, signIn } from '../support';

const THEME_STORAGE_KEY = 'idraft.theme';
const EDITOR = 'priya@digibranders.test';
/** The project has groups, so the keywords page opens By group. */
const GROUPED = '/digibranders/fynix/seo/keywords?loc=0';
const GALLERY = '/design-system/tables';

/** The panel of one gallery specimen, found by its heading. */
function panelOf(page: Page, title: string): Locator {
  return page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::section[1]');
}

/** Two animation frames: a render that an event would have caused has happened by then. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/**
 * What the table's own `contextmenu` handler decided for the next event on `target`: whether the default (the
 * browser's menu) was prevented. Read at the document, after the table has handled the event. A headless
 * browser draws no native menu, so this is how "the browser keeps its menu" is observed.
 */
function nextContextMenuPrevented(target: Locator): Promise<boolean> {
  return target.evaluate(
    (node) =>
      new Promise<boolean>((resolve) => {
        node.ownerDocument.addEventListener('contextmenu', (event) => resolve(event.defaultPrevented), { once: true });
      }),
  );
}

test.describe('row context menu on Rankings By group', () => {
  test('right click opens the row menu at the pointer, Escape returns focus to the cell, and Shift keeps the browser menu', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto(GROUPED);
    const tree = page.getByRole('treegrid', { name: 'Tracked keywords' });
    const cell = tree.getByRole('rowheader', { name: /^Local, 10 keywords$/ });
    await expect(cell).toBeVisible();
    const box = await cell.boundingBox();
    if (box === null) throw new Error('The group row has no box');
    // Over the group's name, clear of its disclosure button
    const point = { x: box.x + 100, y: box.y + box.height / 2 };

    // Shift plus right click is how a person asks for the browser's menu: the table does not take it
    const shiftPrevented = nextContextMenuPrevented(cell);
    await cell.click({ button: 'right', modifiers: ['Shift'], position: { x: 100, y: box.height / 2 } });
    expect(await shiftPrevented).toBe(false);
    await settle(page);
    await expect(page.getByRole('menu')).toHaveCount(0);

    // A plain right click opens the same menu as the row's More button, at the pointer
    const prevented = nextContextMenuPrevented(cell);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    expect(await prevented).toBe(true);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Open group/ })).toBeVisible();
    const menuBox = await menu.boundingBox();
    if (menuBox === null) throw new Error('The menu has no box');
    // Below and to the right of the pointer, 4 px off it, not at the row's More button
    expect(Math.abs(menuBox.x - point.x)).toBeLessThanOrEqual(8);
    expect(menuBox.y - point.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y - point.y).toBeLessThanOrEqual(16);

    // The right click did not open the group, choose it or open its inspector
    await expect(tree.getByRole('button', { name: 'Expand Local group, 10 keywords' })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]inspect=/);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(page.getByRole('group', { name: /Bulk actions/ })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(cell).toBeFocused();
    await expect(page).not.toHaveURL(/[?&]inspect=/);
  });
});

test.describe('table extensions in the design-system gallery', () => {
  test('a group cell spans its columns, and a group of one column keeps one tall header', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(GALLERY);
    const panel = panelOf(page, 'DataTable extension: column groups');
    const grid = panel.getByRole('grid', { name: 'Keywords, column groups' });
    await expect(grid).toBeVisible();

    // Demand has two columns: one group cell over them, each column keeping its own header in the second row
    const groups = grid.locator('thead th[scope="colgroup"]');
    await expect(groups).toHaveCount(1);
    await expect(groups).toHaveText('Demand');
    await expect(groups).toHaveAttribute('colspan', '2');
    const second = grid.locator('thead tr').nth(1).locator('th[scope="col"]');
    await expect(second).toHaveCount(2);
    const [group, volume, difficulty] = await Promise.all([
      groups.boundingBox(),
      second.nth(0).boundingBox(),
      second.nth(1).boundingBox(),
    ]);
    if (group === null || volume === null || difficulty === null) throw new Error('A header cell has no box');
    expect(group.y + group.height).toBeLessThanOrEqual(volume.y + 1);
    expect(Math.abs(group.x - volume.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(group.x + group.width - (difficulty.x + difficulty.width))).toBeLessThanOrEqual(1);

    // Cost has one column: no group cell, one header spanning both rows, like Intent and the actions column
    await expect(groups.filter({ hasText: 'Cost' })).toHaveCount(0);
    await expect(grid.locator('thead th[scope="col"]', { hasText: 'CPC' })).toHaveAttribute('rowspan', '2');

    // Hide KD in the chooser: Demand is down to one column too, so the header is one row again
    await panel.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByRole('checkbox', { name: 'KD', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(groups).toHaveCount(0);
    await expect(grid.locator('thead tr')).toHaveCount(1);
    await expect(grid.locator('thead th[rowspan]')).toHaveCount(0);
  });

  test('three levels: Right Arrow opens and moves in, Left Arrow closes and moves to the parent', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(GALLERY);
    const tree = panelOf(page, 'DataTable extension: three levels').getByRole('treegrid', {
      name: 'Citations by topic, three levels',
    });
    await expect(tree).toBeVisible();
    const focused = (): Promise<{ level: string | null; expanded: string | null }> =>
      page.evaluate(() => {
        const row = document.activeElement?.closest('tr');
        return { level: row?.getAttribute('aria-level') ?? null, expanded: row?.getAttribute('aria-expanded') ?? null };
      });
    const runs = tree.locator('tbody tr[aria-level="3"]');

    // The first topic is open and its prompts are closed
    await tree.locator('tbody tr[aria-level="1"]').first().getByRole('rowheader').focus();
    await expect.poll(focused).toEqual({ level: '1', expanded: 'true' });
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toEqual({ level: '2', expanded: 'false' });
    await expect(runs).toHaveCount(0);

    // Right opens the prompt, and again moves to its first run
    await page.keyboard.press('ArrowRight');
    await expect.poll(focused).toEqual({ level: '2', expanded: 'true' });
    await expect(runs).toHaveCount(3);
    await page.keyboard.press('ArrowRight');
    await expect.poll(focused).toEqual({ level: '3', expanded: null });
    await expect(runs.first()).toHaveAttribute('aria-posinset', '1');
    await expect(runs.first()).toHaveAttribute('aria-setsize', '3');

    // Left goes from the run to its prompt (level 2, not the topic), closes it, then goes to the topic
    await page.keyboard.press('ArrowLeft');
    await expect.poll(focused).toEqual({ level: '2', expanded: 'true' });
    await page.keyboard.press('ArrowLeft');
    await expect.poll(focused).toEqual({ level: '2', expanded: 'false' });
    await expect(runs).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(focused).toEqual({ level: '1', expanded: 'true' });
  });

  for (const width of [390, 1280]) {
    test(`pinned actions stay in view at ${String(width)} px, clear of the Keyword column, with the edge only while columns are behind them`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(GALLERY);
      const grid = panelOf(page, 'DataTable extension: pinned actions').getByRole('grid', {
        name: 'Keywords, pinned actions',
      });
      await expect(grid).toBeVisible();

      /** Scrolls the table's region to `edge` and measures the first row's Keyword and actions cells against it. */
      const measure = (edge: 'start' | 'end') =>
        grid.evaluate(async (table, target) => {
          const region = table.closest('div.overflow-auto');
          const row = table.querySelector('tbody tr[role="row"]');
          if (!(region instanceof HTMLElement) || !(row instanceof HTMLTableRowElement)) {
            throw new Error('The table has no scroll region or no row');
          }
          region.scrollLeft = target === 'end' ? region.scrollWidth : 0;
          // The pinned edge follows the scroll event: wait until it has rendered
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });
          const keyword = row.cells[1];
          const actions = row.cells[row.cells.length - 1];
          if (keyword === undefined || actions === undefined) throw new Error('The row has no Keyword or actions cell');
          const view = region.getBoundingClientRect();
          return {
            overflows: region.scrollWidth > region.clientWidth,
            viewRight: view.left + region.clientLeft + region.clientWidth,
            keywordRight: keyword.getBoundingClientRect().right,
            actionsLeft: actions.getBoundingClientRect().left,
            actionsRight: actions.getBoundingClientRect().right,
            edge: getComputedStyle(actions).borderLeftWidth,
          };
        }, edge);

      // Not scrolled: columns are behind the actions, so the edge is drawn
      const start = await measure('start');
      expect(start.overflows).toBe(true);
      expect(Math.abs(start.actionsRight - start.viewRight)).toBeLessThanOrEqual(1);
      expect(start.keywordRight).toBeLessThanOrEqual(start.actionsLeft);
      expect(start.edge).toBe('1px');

      // Scrolled to the end: still at the right edge, still clear of the Keyword column, and no edge
      const end = await measure('end');
      expect(Math.abs(end.actionsRight - end.viewRight)).toBeLessThanOrEqual(1);
      expect(end.keywordRight).toBeLessThanOrEqual(end.actionsLeft);
      expect(end.edge).toBe('0px');
    });
  }

  test('Select all N matching keeps focus in the bulk bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(GALLERY);
    const panel = panelOf(page, 'DataTable, server mode');
    const grid = panel.getByRole('grid', { name: 'Keywords, server mode' });
    await expect(grid).toBeVisible();
    await grid.getByRole('checkbox', { name: /^Select all [\d,]+ keywords loaded$/ }).click();
    const bar = panel.getByRole('group', { name: /^Bulk actions/ });
    await bar.getByRole('button', { name: 'Select all 300 matching' }).click();
    // The button is gone once every matching row is chosen; focus did not fall to the page
    await expect(bar.getByRole('button', { name: /matching$/ })).toHaveCount(0);
    await expect(bar.locator('[data-slot="bulk-count"]')).toBeFocused();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`the tables page in the ${theme} theme`, () => {
    for (const width of [390, 768, 1024, 1280]) {
      test(`has no accessibility violation at ${String(width)} px`, async ({ page }) => {
        await page.addInitScript(
          ([key, value]) => {
            localStorage.setItem(key, value);
          },
          [THEME_STORAGE_KEY, theme] as const,
        );
        await page.setViewportSize({ width, height: 900 });
        await page.goto(GALLERY);
        await expectAccessible(page);
      });
    }
  });
}
