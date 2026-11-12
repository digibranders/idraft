import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

import { expectAccessible, waitForContent } from '../support';

/**
 * The HTML chart parts of the AI visibility package (WP-05) on their design-system page: every part in both themes at
 * the widths the app supports, the row links reached by keyboard, and the frame's views and CSV used with a part
 * inside. The page is the one place where every part renders with its frame.
 */
const THEME_STORAGE_KEY = 'idraft.theme';
const PAGE = '/design-system/chart-parts';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

// The specimens of the page and what they are given (chart-parts-section.tsx)
const SOV_TITLE = 'Share of voice vs competitors';
const SOV_CAPTION = 'Share of voice on ChatGPT';
const SOV_FILE_NAME = 'share-of-voice';
const SOV_COUNT_TEXT = '466 of 1,412 answers';
const OUTCOME_TITLE = 'Named and cited, by engine';
const FUNNEL_GROUP = 'ChatGPT';

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
}

async function openPage(page: Page, theme: Theme = 'light'): Promise<void> {
  await setTheme(page, theme);
  await page.goto(PAGE);
  await waitForContent(page);
}

/** The frame of one chart, found by its title: the innermost section that holds the title's heading. */
const frameOf = (page: Page, title: string): Locator =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
    .last();

const menuTrigger = (page: Page, title: string): Locator =>
  page.getByRole('button', { name: `More actions for ${title}`, exact: true });

/** Focuses the menu button and opens the menu with Enter; the focus has moved into the menu when this returns. */
async function openMenuByKeyboard(page: Page, title: string): Promise<void> {
  await menuTrigger(page, title).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toBeFocused();
}

/** Moves down to the item with ArrowDown, as far as it is below the first, and chooses it with Enter. */
async function chooseByKeyboard(page: Page, name: string): Promise<void> {
  const names = await page.getByRole('menuitem').allTextContents();
  const index = names.findIndex((text) => text.trim() === name);
  expect(index, `the menu has "${name}"`).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < index; step += 1) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name, exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
}

async function downloadByKeyboard(page: Page, title: string, name: string): Promise<Download> {
  await openMenuByKeyboard(page, title);
  const [download] = await Promise.all([page.waitForEvent('download'), chooseByKeyboard(page, name)]);
  return download;
}

/** The byte order mark the CSV starts with, so Excel reads it as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** An outline or a shadow is drawn: the link shows where the focus is. */
async function expectFocusRing(link: Locator): Promise<void> {
  const style = await link.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth, boxShadow: computed.boxShadow };
  });
  const outlined = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
  expect(outlined || style.boxShadow !== 'none', `the focused link draws a ring: ${JSON.stringify(style)}`).toBe(true);
}

for (const theme of THEMES) {
  test.describe(`the chart parts page in the ${theme} theme`, () => {
    for (const width of WIDTHS) {
      test(`has no accessibility violation and no horizontal scroll at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openPage(page, theme);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
        await expectAccessible(page);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      });
    }
  });
}

test.describe('the row links', () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  test('of the bar list are reached in row order, show a ring and open their address', async ({ page }) => {
    // Another list on the page has a row for idraft.ai too, so the links are looked for in this chart's frame
    const frame = frameOf(page, SOV_TITLE);
    const first = frame.getByRole('link', { name: /^HubSpot:/ });
    const second = frame.getByRole('link', { name: /^idraft\.ai:/ });
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(second).toBeFocused();
    await expectFocusRing(second);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#sov-idraft');
  });

  test('of the step bars are reached in step order and show a ring', async ({ page }) => {
    const links = page.getByRole('list', { name: FUNNEL_GROUP, exact: true }).getByRole('link');
    await expect(links).toHaveCount(2);
    await links.nth(0).focus();
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(links.nth(1)).toBeFocused();
    await expectFocusRing(links.nth(1));
  });

  test('stay out of the tab order for a row without an address', async ({ page }) => {
    // The mention rate panel has no link on any row, so its list holds no tab stop
    const list = page.getByRole('list', { name: 'Mention rate by engine', exact: true });
    await expect(list).toBeVisible();
    await expect(list.getByRole('link')).toHaveCount(0);
  });
});

test.describe('the views of a chart that holds a part', () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  test('the Table view shows the numbers with their caption and the list returns', async ({ page }) => {
    const frame = frameOf(page, SOV_TITLE);
    const toggle = page.getByRole('group', { name: `${SOV_TITLE} view`, exact: true }).getByRole('button', {
      name: 'Table',
      exact: true,
    });
    const list = frame.getByRole('list', { name: SOV_CAPTION, exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(list).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const table = frame.getByRole('table', { name: SOV_CAPTION, exact: true });
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toHaveText(SOV_CAPTION);
    await expect(table).toContainText(SOV_COUNT_TEXT);
    await expect(list).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(list).toBeVisible();
    await expect(table).toHaveCount(0);
  });

  test('Patterns puts a pattern in every segment of the first bar', async ({ page }) => {
    const frame = frameOf(page, OUTCOME_TITLE);
    const bar = frame.getByRole('img', { name: /^ChatGPT:/ });
    const segments = bar.locator('[data-slot="share-segment"]');
    const segmentCount = await segments.count();
    expect(segmentCount).toBeGreaterThan(1);
    await expect(bar.locator('svg pattern')).toHaveCount(0);
    const toggle = page.getByRole('group', { name: `${OUTCOME_TITLE} view`, exact: true }).getByRole('button', {
      name: 'Patterns',
      exact: true,
    });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    for (let index = 0; index < segmentCount; index += 1) {
      await expect(segments.nth(index).locator('svg pattern')).toHaveCount(1);
    }
    await toggle.click();
    await expect(bar.locator('svg pattern')).toHaveCount(0);
  });

  test('the menu downloads the CSV with the counts, by keyboard', async ({ page }) => {
    const download = await downloadByKeyboard(page, SOV_TITLE, 'Download CSV');
    expect(download.suggestedFilename()).toBe(`${SOV_FILE_NAME}.csv`);
    const text = (await readFile(await download.path())).toString('utf8');
    const lines = text.startsWith(BOM) ? text.slice(BOM.length).split(/\r?\n/) : text.split(/\r?\n/);
    expect(lines[0]).toContain('Brand');
    expect(lines[0]).toContain('Answers');
    expect(lines.join('\n')).toContain(SOV_COUNT_TEXT);
  });
});

test('the density control changes the height of the rows and of the bars', async ({ page }) => {
  await openPage(page);
  const list = page.getByRole('list', { name: SOV_CAPTION, exact: true });
  const bar = list.locator('[data-slot="bar-list-bar"]').first();
  const row = list.getByRole('listitem').first();
  const choose = async (name: 'Default' | 'Compact'): Promise<void> => {
    const radio = page.getByRole('radio', { name, exact: true });
    await radio.click();
    await expect(radio).toBeChecked();
  };

  // The page opens in the app's own density, so each one is chosen here and the order does not matter
  await choose('Default');
  await expect(bar).toHaveCSS('height', '24px');
  const defaultRow = (await row.boundingBox())?.height ?? 0;
  expect(defaultRow).toBeGreaterThan(0);

  await choose('Compact');
  await expect(bar).toHaveCSS('height', '16px');
  const compactRow = (await row.boundingBox())?.height ?? 0;
  expect(compactRow).toBeGreaterThan(0);
  expect(compactRow).toBeLessThan(defaultRow);

  await choose('Default');
  await expect(bar).toHaveCSS('height', '24px');
});
