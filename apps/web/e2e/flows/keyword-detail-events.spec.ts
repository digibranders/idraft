import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { expectAccessible, signIn, waitForContent } from '../support';

const EDITOR = 'priya@digibranders.test';
const LIST = '/digibranders/fynix/seo/keywords';
const THEME_KEY = 'idraft.theme';
const RANKED = { id: mockId('tracked', 1), text: 'seo agency berlin' };
/** Ranks below 20 in its deep checks: the axis is deeper and its labels were once the trouble. */
const DEEP = { id: mockId('tracked', 2), text: 'seo agency germany' };
/** The widths of 19-responsive-behavior.md: the Events rail sits beside the chart from 1280 px. */
const WIDTHS = [
  { width: 1440, height: 900, share: 'column' },
  { width: 1280, height: 800, share: 'column' },
  { width: 1024, height: 768, share: 'full' },
  { width: 390, height: 844, share: 'full' },
] as const;
/** Measured in the screenshots: the date labels begin 24 CSS pixels above the bottom of the 240 px canvas. */
const DATE_LABEL_ROOM = 24;

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

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const chartPanel = (page: Page): Locator =>
  page.getByRole('heading', { level: 2, name: 'Rank history' }).locator('xpath=ancestor::section[1]');
const eventsPanel = (page: Page): Locator => page.getByRole('region', { name: 'Events' });

/** The page's text colour as 0 to 255 red, green and blue: the colour the event glyphs are drawn in. */
async function inkOf(page: Page): Promise<[number, number, number]> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--foreground)';
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
  });
}

interface InkBox {
  count: number;
  /** The rows the pixels span, in CSS pixels from the top of the canvas, and the canvas height. */
  minY: number;
  maxY: number;
  height: number;
}

async function inkBox(chart: Locator, ink: readonly number[]): Promise<InkBox> {
  return chart
    .locator('canvas')
    .first()
    .evaluate((canvas, wanted) => {
      const empty = { count: 0, minY: 0, maxY: 0, height: 0 };
      if (!(canvas instanceof HTMLCanvasElement)) return empty;
      const context = canvas.getContext('2d');
      if (context === null) return empty;
      const scale = canvas.height / canvas.clientHeight;
      const { data, width } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = 0;
      for (let index = 0; index < data.length; index += 4) {
        const near = [0, 1, 2].every((offset) => Math.abs((data[index + offset] ?? 0) - (wanted[offset] ?? 0)) <= 10);
        if (!near || (data[index + 3] ?? 0) < 200) continue;
        const y = Math.floor(index / 4 / width) / scale;
        count += 1;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return { count, minY: count === 0 ? 0 : minY, maxY, height: canvas.clientHeight };
    }, ink);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`rank events in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const { width, height, share } of WIDTHS) {
      test(`lays the events feed and the chart glyphs out at ${String(width)} px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await signIn(page, EDITOR);
        await page.goto(`${LIST}/${RANKED.id}?show=events`);
        await expect(page.getByRole('heading', { level: 1, name: RANKED.text })).toBeVisible();
        const chart = chartPanel(page);
        const feed = eventsPanel(page);
        await expect(chart).toBeVisible();
        await expect(feed.getByRole('listitem')).toHaveCount(50);
        await waitForContent(page);
        const ink = await inkOf(page);
        await expect.poll(async () => (await inkBox(chart, ink)).count).toBeGreaterThan(20);

        const content = await boxOf(page.getByRole('tabpanel', { name: 'Overview' }));
        const chartBox = await boxOf(chart);
        const feedBox = await boxOf(feed);
        const placements = {
          // The rail: right of the chart, from its top, inside the page
          column: (): void => {
            expect(feedBox.x).toBeGreaterThanOrEqual(chartBox.x + chartBox.width);
            expect(Math.abs(feedBox.y - chartBox.y)).toBeLessThanOrEqual(2);
            expect(feedBox.x + feedBox.width).toBeLessThanOrEqual(width);
            expect(feedBox.width / content.width).toBeGreaterThan(0.25);
            expect(feedBox.width / content.width).toBeLessThan(0.38);
          },
          // Below 1280 px: under the chart, the width of the page
          full: (): void => {
            expect(feedBox.y).toBeGreaterThanOrEqual(chartBox.y + chartBox.height);
            expect(feedBox.width / content.width).toBeGreaterThan(0.99);
            expect(feedBox.width / content.width).toBeLessThan(1.01);
          },
        } as const;
        placements[share]();

        // Rows are at least 28 px high and hold their text; a day's first row has a 64 px date column
        const rows = await feed.getByRole('listitem').evaluateAll((items) =>
          items.map((item) => ({
            height: item.getBoundingClientRect().height,
            clipped: item.scrollWidth > item.clientWidth,
          })),
        );
        expect(rows).toHaveLength(50);
        expect(Math.min(...rows.map((row) => row.height))).toBeGreaterThanOrEqual(28);
        expect(rows.filter((row) => row.clipped)).toHaveLength(0);
        const date = await boxOf(feed.getByRole('listitem').first().locator('span').first());
        expect(date.width).toBe(64);
        for (const control of [
          feed.getByRole('group', { name: 'Event types' }),
          feed.getByRole('button', { name: 'Show older events' }),
        ]) {
          const box = await boxOf(control);
          expect(box.x).toBeGreaterThanOrEqual(feedBox.x);
          expect(box.x + box.width).toBeLessThanOrEqual(feedBox.x + feedBox.width + 1);
        }

        // The glyphs sit inside the plot, clear of the date labels under it
        await page.screenshot({ path: testInfo.outputPath(`keyword-detail-events-${String(width)}-${theme}.png`) });
        const glyphs = await inkBox(chart, ink);
        expect(glyphs.minY).toBeGreaterThan(0);
        expect(glyphs.maxY).toBeLessThanOrEqual(glyphs.height - DATE_LABEL_ROOM);

        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await page.screenshot({ path: testInfo.outputPath(`keyword-detail-events-${String(width)}-${theme}.png`) });
      });
    }

    for (const { width, height } of WIDTHS.filter((entry) => entry.width === 1440 || entry.width === 390)) {
      test(`keeps the glyphs clear of the axis on a deep keyword at ${String(width)} px`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height });
        await signIn(page, EDITOR);
        await page.goto(`${LIST}/${DEEP.id}?show=deep,events`);
        await expect(page.getByRole('heading', { level: 1, name: DEEP.text })).toBeVisible();
        const chart = chartPanel(page);
        await expect(chart).toBeVisible();
        const ink = await inkOf(page);
        await expect.poll(async () => (await inkBox(chart, ink)).count).toBeGreaterThan(5);
        const glyphs = await inkBox(chart, ink);
        expect(glyphs.maxY).toBeLessThanOrEqual(glyphs.height - DATE_LABEL_ROOM);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page);
        await page.screenshot({
          path: testInfo.outputPath(`keyword-detail-events-deep-${String(width)}-${theme}.png`),
        });
      });
    }
  });
}
