import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { expectAccessible, signIn, waitForContent } from '../support';

const EDITOR = 'priya@digibranders.test';
const VIEWER = 'mei@digibranders.test';
const LIST = '/digibranders/fynix/seo/keywords';
const THEME_KEY = 'idraft.theme';
/** Fixture keywords: one that ranks 10th in its last check, and one of each state without a snapshot. */
const RANKED = { id: mockId('tracked', 1), text: 'seo agency berlin' };
const PENDING = { id: mockId('tracked', 57), text: 'generative engine optimization' };
const FAILED = { id: mockId('tracked', 7), text: 'seo audit checklist' };
const ARCHIVED = { id: mockId('tracked', 60), text: 'seo newsletter' };
const TAB = '?tab=snapshots';
/** The table's height in the page: 49 rem, room for the 20 results of a latest check without an inner scroll. */
const TABLE_HEIGHT = 784;
/** The checks the mock keeps, and so the snapshots the picker lists, newest first. */
const SNAPSHOTS = 30;
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;
/** Whether the five columns (about 940 px with a 200 px result column) outgrow the table at each width. */
const SCROLLS_SIDEWAYS: Record<number, boolean> = { 1440: false, 1280: false, 1024: false, 390: true };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element has no box: it is not on screen');
  return box;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const tablePanel = (page: Page): Locator => page.getByRole('tabpanel', { name: 'SERP snapshots' });
const grid = (page: Page): Locator => page.getByRole('grid', { name: 'Organic results' });
const picker = (page: Page): Locator => page.getByRole('combobox', { name: 'Snapshot' });
const latestHeading = (page: Page): Locator => page.getByRole('heading', { level: 2, name: /^Latest check, / });

const background = (cell: Locator): Promise<string> => cell.evaluate((node) => getComputedStyle(node).backgroundColor);

/** A CSS colour as 0 to 255 red, green and blue, however the browser writes it (it may be oklch or lab). */
async function rgbOf(page: Page, css: string): Promise<[number, number, number]> {
  return page.evaluate((value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('No 2d context');
    context.fillStyle = resolved;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  }, css);
}

/** WCAG relative luminance contrast of two colours. */
function contrastOf(a: readonly number[], b: readonly number[]): number {
  const luminance = (rgb: readonly number[]): number => {
    const [r = 0, g = 0, bl = 0] = rgb.map((channel) => {
      const unit = channel / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Console output the page writes while a test runs: any error or warning fails the test that checks it. */
function watchConsole(page: Page): string[] {
  const written: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      written.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => written.push(`pageerror: ${error.message}`));
  return written;
}

test.describe('keyword detail, SERP snapshots tab', () => {
  test('shows the top 20 of the last check with the own row marked, and steps to an older snapshot and back', async ({
    page,
  }) => {
    const written = watchConsole(page);
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}${TAB}`);
    await expect(latestHeading(page)).toBeVisible();

    // The header row and the 20 results of the last check
    await expect(grid(page).getByRole('row')).toHaveCount(21);
    const own = grid(page).getByRole('gridcell', { name: 'You' });
    await expect(own).toHaveCount(1);
    await expect(grid(page).getByRole('gridcell', { name: 'Brightwave Digital' })).toHaveCount(1);
    await expect(grid(page).getByRole('gridcell', { name: 'Northlight SEO' })).toHaveCount(1);
    // The own row is on the accent tone, a third party row is not
    const ownBackground = await background(own);
    const otherBackground = await background(grid(page).getByRole('gridcell', { name: 'Not tracked' }).first());
    expect(ownBackground).not.toBe(otherBackground);
    // All 20 results are in view without scrolling the table: the own one and the last one
    const region = await boxOf(grid(page).locator('xpath=..'));
    const ownBox = await boxOf(own);
    expect(ownBox.y).toBeGreaterThanOrEqual(region.y);
    expect(ownBox.y + ownBox.height).toBeLessThanOrEqual(region.y + region.height);
    const lastRow = await boxOf(grid(page).getByRole('row').nth(20));
    expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(region.y + region.height + 1);

    // More than the latest check to choose from
    await picker(page).click();
    await expect(page.getByRole('option')).toHaveCount(SNAPSHOTS);
    const second = page.getByRole('option').nth(1);
    const depth = Number(/top (\d+)/.exec((await second.textContent()) ?? '')?.[1]);
    expect(depth).toBeGreaterThan(0);
    await second.click();
    await expect(page).toHaveURL(/[?&]obs=\d+/);
    await expect(page.getByRole('heading', { level: 2, name: /^Snapshot of / })).toBeVisible();
    // The snapshot returned as many results as it asked for, and the table has a row for each
    await expect(grid(page).getByRole('row')).toHaveCount(depth + 1);

    // Back is the browser's: the address loses obs and the latest check is on show again
    await page.goBack();
    await expect(page).not.toHaveURL(/obs=/);
    await expect(page).toHaveURL(/tab=snapshots/);
    await expect(latestHeading(page)).toBeVisible();
    await expect(grid(page).getByRole('row')).toHaveCount(21);
    expect(written).toEqual([]);
  });

  test('steps with Previous snapshot and Next snapshot by keyboard, keeping the focus on the button', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}${TAB}`);
    await expect(latestHeading(page)).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(0);

    // The tab order: picker, Previous, Next, then the table
    await picker(page).focus();
    await page.keyboard.press('Tab');
    const previous = page.getByRole('button', { name: 'Previous snapshot' });
    const next = page.getByRole('button', { name: 'Next snapshot' });
    await expect(previous).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('searchbox', { name: 'Search in table' })).toBeFocused();

    // On the newest snapshot Next says why it does nothing
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(next).toHaveAccessibleDescription('This is the newest snapshot');

    await previous.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]obs=\d+/);
    await expect(previous).toBeFocused();
    const firstObs = new URL(page.url()).searchParams.get('obs');
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('obs')).not.toBe(firstObs);
    await expect(previous).toBeFocused();
    // The focus ring is drawn on the button
    expect(await previous.evaluate((node) => Number.parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThan(
      0,
    );

    // Next goes back to the first, and to the latest check from there
    await next.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('obs')).toBe(firstObs);
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/obs=/);
    await expect(latestHeading(page)).toBeVisible();
  });

  test('chooses an option with the keyboard and the focus is back on the picker', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}${TAB}`);
    await expect(latestHeading(page)).toBeVisible();
    await picker(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option')).toHaveCount(SNAPSHOTS);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]obs=\d+/);
    await expect(picker(page)).toBeFocused();
  });

  test('says there is no snapshot for a keyword never checked or whose checks failed, and shows an archived one', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${PENDING.id}${TAB}`);
    await expect(page.getByRole('heading', { level: 2, name: 'No SERP snapshot yet' })).toBeVisible();
    await expect(page.getByText('The first check creates one.')).toBeVisible();
    await expect(picker(page)).toHaveCount(0);
    await expectAccessible(page);

    await page.goto(`${LIST}/${FAILED.id}${TAB}`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'The check failed, so there is no snapshot' }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.goto(`${LIST}/${ARCHIVED.id}${TAB}`);
    await expect(latestHeading(page)).toBeVisible();
    await picker(page).click();
    await expect(page.getByRole('option')).toHaveCount(6);
  });

  test('a link to a snapshot that is gone says so and one button shows the latest check', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}${TAB}&obs=999999`);
    await expect(page.getByRole('heading', { level: 2, name: 'This snapshot is no longer available' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Show the latest check' }).click();
    await expect(page).not.toHaveURL(/obs=/);
    await expect(latestHeading(page)).toBeVisible();
  });

  test('a viewer reads the tab', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${LIST}/${RANKED.id}${TAB}`);
    await expect(latestHeading(page)).toBeVisible();
    await expect(grid(page).getByRole('row')).toHaveCount(21);
    await expectAccessible(page);
  });

  for (const theme of ['light', 'dark'] as const) {
    test.describe(`in the ${theme} theme`, () => {
      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          ([key, value]) => {
            localStorage.setItem(key, value);
          },
          [THEME_KEY, theme] as const,
        );
      });

      for (const { width, height } of WIDTHS) {
        test(`lays the tab out at ${String(width)} px`, async ({ page }, testInfo) => {
          const written = watchConsole(page);
          await page.setViewportSize({ width, height });
          await signIn(page, EDITOR);
          await page.goto(`${LIST}/${RANKED.id}${TAB}`);
          await expect(latestHeading(page)).toBeVisible();
          await expect(grid(page).getByRole('row')).toHaveCount(21);
          await waitForContent(page);

          const panel = await boxOf(tablePanel(page));
          const heading = await boxOf(latestHeading(page));
          const select = await boxOf(picker(page));
          const previous = await boxOf(page.getByRole('button', { name: 'Previous snapshot' }));
          const next = await boxOf(page.getByRole('button', { name: 'Next snapshot' }));
          const table = await boxOf(grid(page).locator('xpath=ancestor::div[h2][1]'));

          // Nothing leaves the panel to the side, and nothing in the picker row lies over another
          for (const box of [heading, select, previous, next, table]) {
            expect(box.x).toBeGreaterThanOrEqual(panel.x - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
          }
          expect(overlaps(heading, select)).toBe(false);
          expect(overlaps(select, previous)).toBe(false);
          expect(overlaps(previous, next)).toBe(false);
          // The step buttons follow the picker (to its right, or under it on a narrow screen)
          expect(previous.x >= select.x + select.width - 1 || previous.y >= select.y + select.height - 1).toBe(true);
          // The table is as high as the page gives it, under the picker, and as wide as the panel
          expect(table.height).toBe(TABLE_HEIGHT);
          expect(table.y).toBeGreaterThanOrEqual(select.y + select.height);
          expect(table.width).toBeGreaterThan(panel.width - 2);

          // Wide enough, the columns fit; narrow, the table scrolls inside its own region and the page does not
          const scroll = await grid(page)
            .locator('xpath=..')
            .evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
          testInfo.annotations.push({
            type: 'table-scroll',
            description: `${String(scroll.scroll)} of ${String(scroll.client)}`,
          });
          expect(scroll.scroll > scroll.client + 1).toBe(SCROLLS_SIDEWAYS[width]);
          await expectNoHorizontalScroll(page);

          // Scrolled to its end, the table shows its last column whole, at every width
          const region = grid(page).locator('xpath=..');
          await region.evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
          const regionBox = await boxOf(region);
          const lastHeader = await boxOf(grid(page).getByRole('columnheader', { name: 'Snippet' }));
          expect(lastHeader.x).toBeGreaterThanOrEqual(regionBox.x - 1);
          expect(lastHeader.x + lastHeader.width).toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);

          await expectAccessible(page);
          expect(written).toEqual([]);
          await page.screenshot({
            path: testInfo.outputPath(`keyword-detail-snapshots-${String(width)}-${theme}.png`),
            fullPage: true,
          });
        });
      }

      test(`keeps the own row's text at 4.5:1 against its tone, and the tone apart from the surface`, async ({
        page,
      }) => {
        await signIn(page, EDITOR);
        await page.goto(`${LIST}/${RANKED.id}${TAB}`);
        await expect(grid(page).getByRole('row')).toHaveCount(21);
        const own = grid(page).getByRole('gridcell', { name: 'You' });
        const other = grid(page).getByRole('gridcell', { name: 'Not tracked' }).first();
        const tone = await rgbOf(page, await background(own));
        const surface = await rgbOf(page, await background(other));
        expect(tone).not.toEqual(surface);
        const text = await rgbOf(
          page,
          await own.evaluate((node) => getComputedStyle(node.querySelector('span:not([aria-hidden])') ?? node).color),
        );
        expect(contrastOf(text, tone)).toBeGreaterThanOrEqual(4.5);
        // The tone itself is a faint tint: told apart from the surface by eye, not a second text colour
        expect(contrastOf(tone, surface)).toBeLessThan(1.5);
      });
    });
  }
});
