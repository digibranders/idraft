import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible } from '../support';

const THEME_STORAGE_KEY = 'idraft.theme';
const SLUG = '/design-system/chart-grids';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/**
 * The chart grids of WP-06 (the heat-map table and the small multiples) as the gallery shows them, in the production
 * build. jsdom has no layout, no stylesheet, no focus order and no canvas, so contrast, overflow, the keyboard path,
 * the row heights and the connected crosshair are checked here.
 */

async function open(page: Page, theme: Theme, width: number): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.setViewportSize({ width, height: 900 });
  await page.goto(SLUG);
  await page.getByRole('heading', { level: 2, name: 'Heat-map table', exact: true }).waitFor();
}

/** The topic heat-map (CH-04) and its frame. */
function topics(page: Page): { frame: Locator; grid: Locator } {
  const frame = page.locator('#mention-rate-by-topic');
  return { frame, grid: frame.getByRole('treegrid', { name: 'Mention rate by topic and engine' }) };
}

/** The `data-cell` (row:column) of the cell that has the focus, or null when the focus is not in a heat-map cell. */
const focusedCell = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.closest('[data-cell]')?.getAttribute('data-cell') ?? null);

/** Presses Tab at most this many times to reach the heat-map: more than the frame's own buttons need. */
const TAB_LIMIT = 8;

/**
 * Puts the keyboard's starting point on the title of the topic heat-map, then presses Tab until the focus is in
 * the grid: the heat-map is reached from the keyboard.
 */
async function tabIntoTopics(page: Page): Promise<Locator> {
  const { frame, grid } = topics(page);
  const title = frame.getByRole('heading', { name: 'Mention rate by topic and engine', exact: true });
  await title.scrollIntoViewIfNeeded();
  await title.click();
  for (let press = 0; press < TAB_LIMIT; press += 1) {
    await page.keyboard.press('Tab');
    if (await grid.evaluate((node) => node.contains(document.activeElement))) return grid;
  }
  throw new Error(`Tab did not reach the heat-map within ${String(TAB_LIMIT)} presses`);
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`chart grids at ${String(width)} px in the ${theme} theme: no accessibility violation and no sideways page scroll`, async ({
      page,
    }) => {
      await open(page, theme, width);
      await expectAccessible(page);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    });
  }
}

test('at 390 px the heat-map scrolls inside its own wrapper, and the page does not', async ({ page }) => {
  await open(page, 'light', 390);
  const wrapper = topics(page).grid.locator('xpath=..');
  await expect(wrapper).toHaveCSS('overflow-x', 'auto');
  const size = await wrapper.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(size.scroll).toBeGreaterThan(size.client);
});

test.describe('the heat-map table at 1280 px in the light theme', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('Tab reaches exactly one cell, and one more Tab leaves the table', async ({ page }) => {
    await expect(topics(page).grid.locator('[tabindex="0"]')).toHaveCount(1);
    const grid = await tabIntoTopics(page);
    // The first cell is the first tab stop, the CRM row header
    expect(await focusedCell(page)).toBe('0:0');
    await page.keyboard.press('Tab');
    expect(await grid.evaluate((node) => node.contains(document.activeElement))).toBe(false);
  });

  test('the arrows move the focus between cells, and the tab stop follows it', async ({ page }) => {
    const grid = await tabIntoTopics(page);
    // Down to the Email marketing row header, then right through Prompts to its ChatGPT cell
    await page.keyboard.press('ArrowDown');
    expect(await focusedCell(page)).toBe('1:0');
    await page.keyboard.press('ArrowRight');
    expect(await focusedCell(page)).toBe('1:1');
    await page.keyboard.press('ArrowRight');
    expect(await focusedCell(page)).toBe('1:2');
    const name = /^Email marketing on ChatGPT: .*27 of 96 answers/;
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', name);
    await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
    await expect(grid.locator('[data-cell="1:2"]')).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedCell(page)).toBe('1:1');
  });

  test('Right on the CRM row header opens the row, and Left closes it', async ({ page }) => {
    const grid = await tabIntoTopics(page);
    const crm = grid.locator('tbody tr').first();
    const child = grid.getByRole('rowheader', { name: 'CRM for startups', exact: true });
    await expect(crm).toHaveAttribute('aria-expanded', 'false');
    await expect(child).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(crm).toHaveAttribute('aria-expanded', 'true');
    await expect(child).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: 'CRM for enterprise', exact: true })).toBeVisible();
    // The focus stays on the CRM row header, and Right again goes into the first child
    expect(await focusedCell(page)).toBe('0:0');
    await page.keyboard.press('ArrowRight');
    expect(await focusedCell(page)).toBe('1:0');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedCell(page)).toBe('0:0');
    await page.keyboard.press('ArrowLeft');
    await expect(crm).toHaveAttribute('aria-expanded', 'false');
    await expect(child).toHaveCount(0);
  });

  test('Enter on a linked cell follows its link', async ({ page }) => {
    await tabIntoTopics(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await focusedCell(page)).toBe('1:2');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/design-system/charts');
  });

  test('a hatched cell says "3 ans" and no percent, and a cell with no answers says "n/a"', async ({ page }) => {
    const { grid } = topics(page);
    // Analytics on ChatGPT has 3 answers
    const hatched = grid.getByRole('link', { name: /^Analytics on ChatGPT: / });
    await expect(hatched).toHaveText('3 ans');
    await expect(hatched).toHaveAttribute('aria-label', /3 answers, fewer than 4/);
    expect(await hatched.getAttribute('aria-label')).not.toContain('%');
    await expect(hatched).not.toContainText('%');
    // Analytics on Gemini has none: nothing to open, and never a 0%
    const none = grid.locator('td[aria-label^="Analytics on Gemini"]');
    await expect(none).toHaveText('n/a');
    await expect(none).toHaveAttribute('aria-label', /No answers/);
    expect(await none.getAttribute('aria-label')).not.toMatch(/\b0%/);
    await expect(none.locator('a')).toHaveCount(0);
  });

  test('a row is as high as a table row on Default density, and as a compact row on Compact', async ({ page }) => {
    const { grid } = topics(page);
    const firstRow = grid.locator('tbody tr').first();
    // The tokens' own sizes, resolved by the browser: no pixel is written here
    const tokenHeight = (name: string): Promise<number> =>
      page.evaluate((variable) => {
        const probe = document.createElement('div');
        probe.style.height = `var(${variable})`;
        document.body.append(probe);
        const { height } = probe.getBoundingClientRect();
        probe.remove();
        return height;
      }, name);
    const rowHeight = async (): Promise<number> => (await firstRow.boundingBox())?.height ?? 0;

    const normal = await tokenHeight('--size-row');
    const compact = await tokenHeight('--size-row-compact');
    expect(compact).toBeLessThan(normal);

    // Compact is the density every table opens in (table-state.ts), so the specimens start there
    await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked();
    expect(await rowHeight()).toBeCloseTo(compact, 1);
    await page.getByRole('radio', { name: 'Default' }).click();
    await expect.poll(rowHeight).toBeCloseTo(normal, 1);
    await page.getByRole('radio', { name: 'Compact' }).click();
    await expect.poll(rowHeight).toBeCloseTo(compact, 1);
  });
});

test.describe('the small multiples at 1280 px in the light theme', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('the Table view is one table with a column for each panel', async ({ page }) => {
    const frame = page.locator('#mention-rate-by-engine');
    await frame.scrollIntoViewIfNeeded();
    const views = frame.getByRole('group', { name: 'Mention rate by engine view' });
    await views.getByRole('button', { name: 'Table' }).click();
    const table = frame.getByRole('table');
    await expect(table).toHaveCount(1);
    await expect(table.getByRole('columnheader')).toHaveText(['Week', 'ChatGPT', 'Gemini', 'AI Mode']);
    // AI Mode has no answers in the week of Aug 31: a gap, not a 0%
    const aug31 = table.getByRole('row', { name: /^Aug 31/ });
    await expect(aug31.getByRole('cell').nth(2)).toHaveText('No data');
  });

  test('a crosshair over the first chart appears on the second, and only the first shows a tooltip box', async ({
    page,
  }) => {
    const figures = page.locator('#mention-rate-by-engine figure');
    await expect(figures).toHaveCount(3);
    const [first, second, third] = [figures.nth(0), figures.nth(1), figures.nth(2)];
    for (const figure of [first, second, third]) await expect(figure.locator('canvas').first()).toBeVisible();
    await first.scrollIntoViewIfNeeded();

    // The drawing of a chart, its labels and its crosshair, as pixels
    const pixelsOf = (figure: Locator): Promise<Buffer> => figure.locator('[role="img"]').screenshot();
    // A box ECharts shows: absolutely placed inside the chart, with words in it
    const boxesIn = (figure: Locator): Promise<number> =>
      figure.evaluate(
        (node) =>
          Array.from(node.querySelectorAll<HTMLElement>('[role="img"] div')).filter((element) => {
            const style = getComputedStyle(element);
            return (
              style.position === 'absolute' &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0' &&
              (element.textContent ?? '').trim() !== ''
            );
          }).length,
      );

    await page.mouse.move(0, 0);
    expect(await boxesIn(first)).toBe(0);
    const before = await pixelsOf(second);
    // Nothing else moves the drawing: a second look is the same
    expect((await pixelsOf(second)).equals(before)).toBe(true);

    const box = await first.locator('[role="img"]').boundingBox();
    if (box === null) throw new Error('The first chart has no box');
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.6 + 2, box.y + box.height * 0.5);

    // The crosshair of the connected chart: its pixels change while the pointer is over the first
    await expect.poll(async () => (await pixelsOf(second)).equals(before)).toBe(false);
    await expect.poll(() => boxesIn(first)).toBe(1);
    expect(await boxesIn(second)).toBe(0);
    expect(await boxesIn(third)).toBe(0);

    // Leaving the chart takes the crosshair away again
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await pixelsOf(second)).equals(before)).toBe(true);
    await expect.poll(() => boxesIn(first)).toBe(0);
  });
});
