import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { expectAccessible, signIn, waitForContent } from '../support';

const EDITOR = 'priya@digibranders.test';
const VIEWER = 'mei@digibranders.test';
const LIST = '/digibranders/fynix/seo/keywords';
const DETAIL = /\/digibranders\/fynix\/seo\/keywords\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const THEME_KEY = 'idraft.theme';
/** The ranked fixture keyword the layout tests open, and the stale and pending ones the states tests open. */
const RANKED = { id: mockId('tracked', 1), text: 'seo agency berlin' };
const STALE = { id: mockId('tracked', 34), text: 'fynix reviews' };
const DEEP = { id: mockId('tracked', 2), text: 'seo agency germany' };
const ARCHIVED = { id: mockId('tracked', 60), text: 'seo newsletter' };
/** The widths of 19-responsive-behavior.md the plan names, with a height that fits the whole header. */
const WIDTHS = [
  { width: 1440, height: 900, actions: 'beside' },
  { width: 1280, height: 800, actions: 'beside' },
  { width: 1024, height: 768, actions: 'beside' },
  { width: 390, height: 844, actions: 'below' },
] as const;
const CONTROL = 36;
const CONTROL_SM = 32;
const TAB_ROW = 44;

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

/** The page does not scroll sideways (19 section 3). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const rowHeader = (page: Page, keyword: string): Locator =>
  page
    .getByRole('grid', { name: 'Tracked keywords' })
    .getByRole('rowheader')
    .filter({ hasText: new RegExp(`^\\s*${keyword}\\b`) })
    .first();

/** The widths the chart is laid out at: the evidence column is 8 of 12 from 1280 px and the full width below. */
const CHART_WIDTHS = [
  { width: 1440, height: 900, share: 'column' },
  { width: 1280, height: 800, share: 'column' },
  { width: 1024, height: 768, share: 'full' },
  { width: 390, height: 844, share: 'full' },
] as const;

/** The share of the Overview panel's width the chart card takes. */
/** Rows of controls the toolbar may take: one from 1024 px, two at 390 px. */
const ROWS_MAX: Record<number, number> = { 1440: 1, 1280: 1, 1024: 1, 390: 2 };
/** The most pixels the page may spend above the chart canvas, per width (screen 1: header, tabs, the card's head). */
const CHART_TOP_MAX: Record<number, number> = { 1440: 440, 1280: 440, 1024: 440, 390: 600 };
const SHARE = { column: [0.6, 0.72], full: [0.99, 1.01] } as const;

/** A CSS colour (a custom property too) as red, green, blue and alpha, each 0 to 255, however the browser writes it. */
async function rgbaOf(page: Page, css: string): Promise<[number, number, number, number]> {
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
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a];
  }, css);
}

/** The colour without its alpha: for a colour that is known to be opaque. */
async function rgbOf(page: Page, css: string): Promise<[number, number, number]> {
  const [r, g, b] = await rgbaOf(page, css);
  return [r, g, b];
}

/** `top` laid over the opaque `under`, as the eye sees them. */
function compositeOver(top: readonly number[], under: readonly number[]): number[] {
  const alpha = (top[3] ?? 255) / 255;
  return [0, 1, 2].map((offset) => Math.round(alpha * (top[offset] ?? 0) + (1 - alpha) * (under[offset] ?? 0)));
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

/** How many pixels of the chart's canvas, from `fromFraction` of its height down, are within 40 per channel of `colour`. */
async function pixelsNear(panel: Locator, colour: readonly number[], fromFraction = 0): Promise<number> {
  return panel
    .locator('canvas')
    .first()
    .evaluate(
      (canvas, [wanted, fromFraction]) => {
        if (!(canvas instanceof HTMLCanvasElement)) return 0;
        const context = canvas.getContext('2d');
        if (context === null) return 0;
        const top = Math.floor(canvas.height * fromFraction);
        const { data } = context.getImageData(0, top, canvas.width, canvas.height - top);
        let hits = 0;
        for (let index = 0; index < data.length; index += 4) {
          const near = [0, 1, 2].every((offset) => Math.abs((data[index + offset] ?? 0) - (wanted[offset] ?? 0)) <= 40);
          if (near && (data[index + 3] ?? 0) > 200) hits += 1;
        }
        return hits;
      },
      [colour, fromFraction] as const,
    );
}

const chartPanel = (page: Page): Locator =>
  page.getByRole('heading', { level: 2, name: 'Rank history' }).locator('xpath=ancestor::section[1]');

/** How many distinct colours the chart's canvas holds, scanned over the whole canvas. */
async function distinctCanvasColours(panel: Locator): Promise<number> {
  return panel
    .locator('canvas')
    .first()
    .evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return 0;
      const context = canvas.getContext('2d');
      if (context === null) return 0;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const colours = new Set<string>();
      for (let index = 0; index < data.length; index += 28) {
        colours.add(
          `${String(data[index])},${String(data[index + 1])},${String(data[index + 2])},${String(data[index + 3])}`,
        );
      }
      return colours.size;
    });
}

test.describe('keyword detail', () => {
  test('opens from the inspector with Open page, and Back returns to the list with the inspector open', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(LIST);
    const header = rowHeader(page, 'seo agency');
    const keyword = ((await header.locator('.truncate').first().textContent()) ?? '').trim();
    expect(keyword).toBe('seo agency');
    await header.click();
    const inspector = page.getByRole('complementary', { name: keyword });
    await expect(inspector).toBeVisible();
    await inspector.getByRole('button', { name: 'Open page' }).click();

    await expect(page).toHaveURL(DETAIL);
    const id = DETAIL.exec(page.url())?.[1] ?? '';
    expect(id).not.toBe('');
    await expect(page.getByRole('heading', { level: 1, name: keyword })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Keyword sections' }).getByRole('tab')).toHaveCount(2);
    await expectNoHorizontalScroll(page);

    // Back is the browser's: the list comes back with the inspector on the same keyword
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?inspect=keyword(:|%3A)${id}$`));
    await expect(page.getByRole('complementary', { name: keyword })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: keyword })).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${LIST}$`));

    // The list still steps with J and K once an inspector is open again
    await rowHeader(page, 'seo agency').click();
    await expect(page.getByRole('complementary', { name: keyword })).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.getByRole('complementary', { name: 'backlink checker' })).toBeVisible();
  });

  test('the back link returns to the list as it was left, filters included', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}?intent=commercial`);
    await expect(page.getByRole('button', { name: 'Intent: Commercial. Edit filter' })).toBeVisible();
    await page.getByRole('grid', { name: 'Tracked keywords' }).getByRole('rowheader').first().click();
    await page.getByRole('complementary').getByRole('button', { name: 'Open page' }).click();
    await expect(page).toHaveURL(DETAIL);
    const back = page.getByRole('main').getByRole('link', { name: 'Keywords', exact: true });
    await expect(back).toHaveAttribute('href', `${LIST}?intent=commercial`);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?intent=commercial$`));
    await expect(page.getByRole('button', { name: 'Intent: Commercial. Edit filter' })).toBeVisible();
  });

  test('a Ctrl or Cmd click on a row opens its page in a new tab and leaves this tab alone', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(LIST);
    await expect(rowHeader(page, 'backlink checker')).toBeVisible();
    const before = page.url();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      rowHeader(page, 'backlink checker').click({ modifiers: ['ControlOrMeta'] }),
    ]);
    await popup.waitForLoadState();
    await expect(popup).toHaveURL(DETAIL);
    await expect(popup.getByRole('heading', { level: 1, name: 'backlink checker' })).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await popup.close();
  });

  test('an address with no keyword behind it shows the not-found state, and one that is no id is the 404 page', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/00000000-0000-4000-8000-000000000000`);
    await expect(page.getByRole('heading', { level: 1, name: 'This keyword is no longer tracked' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Keywords' })).toHaveAttribute('href', LIST);
    await expectAccessible(page);

    // Mocked builds answer 200 with the 404 page (the response starts before the page decides), as auth.spec notes
    await page.goto(`${LIST}/not-a-keyword`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This page does not exist or you do not have access to it' }),
    ).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
  });

  test('a viewer reads the page and has no Check now, no archive and no change of depth', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${LIST}/${RANKED.id}`);
    await expect(page.getByRole('heading', { level: 1, name: RANKED.text })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Change depth' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expectAccessible(page);
  });

  test('an archived keyword says so and offers Restore; a stale one says Stale', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${ARCHIVED.id}`);
    await expect(page.getByRole('heading', { level: 1, name: ARCHIVED.text })).toBeVisible();
    await expect(page.getByText('Archived', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Restore' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`${LIST}/${STALE.id}`);
    await expect(page.getByRole('heading', { level: 1, name: STALE.text })).toBeVisible();
    await expect(page.getByText('Stale', { exact: true })).toBeVisible();
  });

  test('the tabs move with the arrow keys and live in the address', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}`);
    await expect(page.getByRole('heading', { level: 1, name: RANKED.text })).toBeVisible();
    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'SERP snapshots', selected: true })).toBeFocused();
    await expect(page).toHaveURL(/[?&]tab=snapshots/);
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Overview', selected: true })).toBeVisible();
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('the page action is the primary 36 px Check now, where the inspector has a 32 px secondary one', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(LIST);
    await rowHeader(page, 'seo agency').click();
    const inspector = page.getByRole('complementary', { name: 'seo agency' });
    const small = await boxOf(inspector.getByRole('button', { name: 'Check now' }));
    expect(small.height).toBe(CONTROL_SM);
    await inspector.getByRole('button', { name: 'Open page' }).click();
    await expect(page).toHaveURL(DETAIL);
    const check = page.getByRole('button', { name: 'Check now' });
    await expect(check).toBeVisible();
    expect((await boxOf(check)).height).toBe(CONTROL);
  });

  test('draws the rank history with the own site and its competitors, a table, a window and the absolute rank', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}`);
    await expect(page.getByRole('heading', { level: 1, name: RANKED.text })).toBeVisible();
    const panel = chartPanel(page);
    await expect(panel).toBeVisible();
    const legend = panel.getByRole('list', { name: 'Series in Rank history' }).getByRole('button');
    const names = (await legend.allTextContents()).map((name) => name.trim());
    expect(names[0]).toBe('Fynix (you)');
    expect(names.length).toBeGreaterThan(1);
    expect(names.length).toBeLessThanOrEqual(6);

    // The canvas holds a drawing: a background, lines, guides and a band make several colours
    await expect.poll(() => distinctCanvasColours(panel)).toBeGreaterThan(2);

    await panel.getByRole('button', { name: 'Table' }).click();
    const table = panel.getByRole('table', { name: 'Rank history' });
    await expect(table).toBeVisible();
    const longRows = await table.getByRole('rowheader').count();
    expect(longRows).toBeGreaterThan(5);
    expect(await table.getByRole('rowheader').first().textContent()).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText(/^\d+$/);

    await panel.getByRole('combobox', { name: 'Window' }).click();
    await page.getByRole('option', { name: 'Last 30 days' }).click();
    await expect(page).toHaveURL(/[?&]win=30d/);
    await expect(panel.getByText(/^Last 30 days · /)).toBeVisible();
    const shortRows = await table.getByRole('rowheader').count();
    expect(shortRows).toBeGreaterThan(0);
    expect(shortRows).toBeLessThanOrEqual(30);
    expect(shortRows).toBeLessThanOrEqual(longRows);

    await expect(legend).toHaveCount(names.length);
    await panel.getByRole('button', { name: 'Absolute', exact: true }).click();
    await expect(legend).toHaveCount(names.length + 1);
    await expect(legend.filter({ hasText: 'Fynix (you) (absolute)' })).toHaveCount(1);
  });

  test('the window, competitors and layers of the address come back when the link is opened', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}?win=7d&show=absolute&comp=none`);
    const panel = chartPanel(page);
    await expect(panel.getByText(/^Last 7 days · /)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Absolute', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // No competitor, so the legend holds the own site and its absolute rank only
    await expect(panel.getByRole('list', { name: 'Series in Rank history' }).getByRole('button')).toHaveCount(2);
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

      for (const { width, height, actions } of WIDTHS) {
        test(`lays the header out at ${String(width)} px`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height });
          await signIn(page, EDITOR);
          await page.goto(`${LIST}/${RANKED.id}`);
          const title = page.getByRole('heading', { level: 1, name: RANKED.text });
          await expect(title).toBeVisible();
          await waitForContent(page);

          const back = await boxOf(page.getByRole('main').getByRole('link', { name: 'Keywords', exact: true }));
          const titleBox = await boxOf(title);
          const more = await boxOf(page.getByRole('button', { name: 'More actions' }));
          const check = await boxOf(page.getByRole('button', { name: 'Check now' }));
          const open = await boxOf(page.getByRole('link', { name: 'Open ranking page in a new tab' }));
          const tabs = await boxOf(page.getByRole('tablist', { name: 'Keyword sections' }));
          const tab = await boxOf(page.getByRole('tab', { name: 'Overview' }));

          // The back link is above the title, on a line of its own
          expect(back.y + back.height).toBeLessThanOrEqual(titleBox.y + 1);
          // The actions read in one order, left to right, on one row
          expect(open.x + open.width).toBeLessThanOrEqual(more.x + 1);
          expect(more.x + more.width).toBeLessThanOrEqual(check.x + 1);
          expect(Math.abs(open.y - more.y)).toBeLessThanOrEqual(2);
          expect(Math.abs(more.y - check.y)).toBeLessThanOrEqual(2);
          expect(check.height).toBe(CONTROL);
          // The icon button is as high as the buttons beside it, and square
          expect(more.height).toBe(CONTROL);
          expect(more.width).toBe(CONTROL);
          expect(open.height).toBe(CONTROL);
          // The tabs are the 44 px row under the header and span the content
          expect(tabs.y).toBeGreaterThan(check.y + check.height);
          expect(tab.height).toBe(TAB_ROW);
          expect(tabs.width).toBeGreaterThan(width * 0.6);

          const placements = {
            // Beside the title, with the right edge of the actions at the content edge
            beside: (): void => {
              expect(check.y).toBeLessThanOrEqual(titleBox.y + titleBox.height);
              expect(check.x).toBeGreaterThan(titleBox.x + 100);
              expect(check.x + check.width).toBeGreaterThan(width - 80);
            },
            // Under the title, on a row of their own (PageHeader below 768 px)
            below: (): void => {
              expect(open.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
              expect(open.x).toBeLessThan(width / 2);
            },
          } as const;
          placements[actions]();
          expect(check.x + check.width).toBeLessThanOrEqual(width);
          await expectNoHorizontalScroll(page);
          await expectAccessible(page);
          await page.screenshot({ path: testInfo.outputPath(`keyword-detail-${String(width)}-${theme}.png`) });
        });
      }

      for (const { width, height } of CHART_WIDTHS) {
        test(`draws deep checks on a keyword that ranks below 20, at ${String(width)} px`, async ({
          page,
        }, testInfo) => {
          await page.setViewportSize({ width, height });
          await signIn(page, EDITOR);
          await page.goto(`${LIST}/${DEEP.id}?show=deep`);
          await expect(page.getByRole('heading', { level: 1, name: DEEP.text })).toBeVisible();
          const panel = chartPanel(page);
          await expect(panel.getByRole('button', { name: 'Deep checks', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          // The plot is not empty: the own series is in it, and the canvas holds a drawing
          const brand = await rgbOf(page, 'var(--chart-1)');
          await expect.poll(() => pixelsNear(panel, brand)).toBeGreaterThan(40);
          // Its checks are below rank 20, so the series is in the lower three quarters of the canvas
          await expect.poll(() => pixelsNear(panel, brand, 0.25)).toBeGreaterThan(40);
          await expect.poll(() => distinctCanvasColours(panel)).toBeGreaterThan(2);
          await expectNoHorizontalScroll(page);
          await expectAccessible(page);
          await page.screenshot({ path: testInfo.outputPath(`keyword-detail-deep-${String(width)}-${theme}.png`) });
        });

        test(`keeps the Table view reachable and accessible at ${String(width)} px`, async ({ page }) => {
          await page.setViewportSize({ width, height });
          await signIn(page, EDITOR);
          await page.goto(`${LIST}/${RANKED.id}`);
          const panel = chartPanel(page);
          await expect(panel).toBeVisible();
          // Seven columns: the five competitors, the own site and its absolute rank
          await panel.getByRole('button', { name: 'Absolute', exact: true }).click();
          await panel.getByRole('button', { name: 'Table', exact: true }).click();
          const region = panel.getByRole('region', { name: 'Table of Rank history' });
          await expect(region).toBeVisible();
          await region.focus();
          await expect(region).toBeFocused();
          // A date stays on one line, so a row keeps its 32 px however narrow the table gets
          expect(
            await region
              .getByRole('rowheader')
              .first()
              .evaluate((cell) => getComputedStyle(cell).whiteSpace),
          ).toBe('nowrap');
          const dates = region.getByRole('rowheader');
          expect(await dates.count()).toBeGreaterThan(5);
          for (let index = 0; index < 6; index += 1) {
            expect((await boxOf(dates.nth(index))).height).toBeLessThanOrEqual(33);
          }
          await expectAccessible(page);
        });
      }

      test('shows a toggle that is on with 3:1 against the card, and the same for Table', async ({ page }) => {
        await signIn(page, EDITOR);
        await page.goto(`${LIST}/${RANKED.id}`);
        const panel = chartPanel(page);
        await expect(panel).toBeVisible();
        const absolute = panel.getByRole('button', { name: 'Absolute', exact: true });
        const table = panel.getByRole('button', { name: 'Table', exact: true });
        await absolute.click();
        await table.click();
        const surface = await panel.evaluate((card) => getComputedStyle(card).backgroundColor);
        const card = await rgbOf(page, surface);
        for (const toggle of [absolute, table]) {
          await expect(toggle).toHaveAttribute('aria-pressed', 'true');
          // The outline fades in over a few tenths of a second: poll until it has arrived
          await expect
            .poll(async () => {
              const outline = await toggle.evaluate((button) => getComputedStyle(button).borderTopColor);
              const [r, g, b, a] = await rgbaOf(page, outline);
              // A transparent outline is no outline: it must be opaque, and then it is measured as it is drawn
              return a === 255 ? contrastOf(compositeOver([r, g, b, a], card), card) : 0;
            })
            .toBeGreaterThanOrEqual(3);
        }
      });

      for (const { width, height, share } of CHART_WIDTHS) {
        test(`lays the rank history out at ${String(width)} px`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height });
          await signIn(page, EDITOR);
          await page.goto(`${LIST}/${RANKED.id}`);
          await expect(page.getByRole('heading', { level: 1, name: RANKED.text })).toBeVisible();
          const panel = chartPanel(page);
          await expect(panel).toBeVisible();
          await expect.poll(() => distinctCanvasColours(panel)).toBeGreaterThan(2);
          // The own series is drawn in the brand colour, chart 1
          const brand = await rgbOf(page, 'var(--chart-1)');
          await expect.poll(() => pixelsNear(panel, brand)).toBeGreaterThan(40);
          await waitForContent(page);

          // The card clears the rule under the tabs
          const tabs = await boxOf(page.getByRole('tablist', { name: 'Keyword sections' }));
          const cardTop = (await boxOf(panel)).y;
          expect(cardTop - (tabs.y + tabs.height)).toBeGreaterThanOrEqual(12);

          const content = await boxOf(page.getByRole('tabpanel', { name: 'Overview' }));
          const card = await boxOf(panel);
          const ratio = card.width / content.width;
          // The evidence column is 8 of 12 less its share of the gaps from 1280 px, the whole width below
          const [least, most] = SHARE[share];
          expect(ratio).toBeGreaterThan(least);
          expect(ratio).toBeLessThan(most);
          // The controls are one toolbar row from 1024 px and two at most below, inside the card
          const toolbar = [
            panel.getByRole('combobox', { name: 'Window' }),
            panel.getByRole('button', { name: 'Competitors (5)' }),
            panel.getByRole('button', { name: 'Absolute', exact: true }),
            panel.getByRole('button', { name: 'Deep checks' }),
            panel.getByRole('button', { name: 'Table', exact: true }),
          ];
          const boxes = await Promise.all(toolbar.map((control) => boxOf(control)));
          for (const control of boxes) {
            expect(control.x).toBeGreaterThanOrEqual(card.x);
            expect(control.x + control.width).toBeLessThanOrEqual(card.x + card.width + 1);
          }
          const rows = new Set(boxes.map((control) => Math.round(control.y / 8)));
          expect(rows.size).toBeLessThanOrEqual(ROWS_MAX[width] ?? 1);
          const layers = await boxOf(panel.getByRole('group', { name: 'Chart layers' }));
          expect(layers.x + layers.width).toBeLessThanOrEqual(card.x + card.width + 1);
          // The canvas is 240 px high, as the page chart is
          const canvas = await boxOf(panel.getByRole('img', { name: 'Rank history' }));
          expect(canvas.height).toBe(240);
          expect(canvas.width).toBeGreaterThan(card.width * 0.8);
          // The chart starts above the fold with room to read: the chrome before it is bounded
          expect(canvas.y).toBeLessThan(CHART_TOP_MAX[width] ?? 0);
          expect(canvas.y + canvas.height).toBeLessThan(height);
          await expectNoHorizontalScroll(page);
          await expectAccessible(page);
          await page.screenshot({ path: testInfo.outputPath(`keyword-detail-chart-${String(width)}-${theme}.png`) });
        });
      }
    });
  }
});
