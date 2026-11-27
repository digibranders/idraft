import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, type Locator, type Page } from '@playwright/test';

import { formatInteger, formatPercent, formatRelativeChange } from '../../src/lib/format';
import { CITATIONS_FIXTURE_SHAPE, type CitationsFixture } from '../../src/mocks/citations-v2-shape';
import { signIn } from '../support';

/**
 * What the Citations e2e of WP-77 shares (apps/web/e2e/flows/ai-citations.spec.ts): the page and its people, the
 * locators of what the screen draws, and the fixture's `expected` block. The mock answers are the design preview's
 * data (src/mocks/fixtures/citations-v2.json), so the numbers on screen are the fixture's. `E2E_CITATIONS_REAL=1` runs
 * the same walk against the dev API, where the numbers are not the fixture's and only the structure is checked.
 */

/** An editor: reads AI data and exports it. */
export const EDITOR = 'priya@digibranders.test';
/** The key the theme is stored under in the browser, so a test can start in either theme. */
export const THEME_KEY = 'idraft.theme';
/** The Citations page of the Fynix mock project (ChatGPT and Gemini on, Google AI Mode off). */
export const FYNIX_CITATIONS = '/digibranders/fynix/ai/citations';
export const REAL = process.env.E2E_CITATIONS_REAL === '1';

// Read from disk: `package.json` is an ES module, which takes no bare JSON import
export const FIXTURE: CitationsFixture = CITATIONS_FIXTURE_SHAPE.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../src/mocks/fixtures/citations-v2.json', import.meta.url)), 'utf8'),
  ),
);
/** The strip, page and gap numbers of one platform choice. */
export type Expected = CitationsFixture['expected']['enabled'];

export const stripOf = (page: Page): Locator => page.getByRole('group', { name: 'Citation measures' });
/** A strip figure: the tab stop named "<label>: <value>. <what it means>". */
export const figureOf = (page: Page, label: string): Locator => stripOf(page).getByLabel(new RegExp(`^${label}: `));
export const scopeOf = (page: Page): Locator => page.getByRole('group', { name: 'Scope' });
export const ownersOf = (page: Page): Locator => page.getByRole('group', { name: 'Domain type' });
export const viewsOf = (page: Page): Locator => page.getByRole('navigation', { name: 'Citations views' });
export const searchOf = (page: Page): Locator => page.getByRole('searchbox', { name: 'Search in table' });
export const pagesTable = (page: Page): Locator => page.getByRole('table', { name: 'Cited pages' });
export const gapsTable = (page: Page): Locator => page.getByRole('table', { name: 'Gap analysis' });
/** The drawer, a card laid over the page from 900 px; below that it is a sheet, a dialog. */
export const drawerOf = (page: Page): Locator => page.getByRole('complementary');
/** The drawer's "3 of 148" in its header; the first of the matches, since its tables hold "k of n" counts too. */
export const positionOf = (drawer: Locator): Locator => drawer.getByText(/^\d+ of \d+$/).first();

const exact = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The figure shows `value`: waits for it, since the strip keeps the old value while a new scope loads. */
export async function expectFigure(page: Page, label: string, value: string): Promise<void> {
  await expect(figureOf(page, label)).toHaveAttribute(
    'aria-label',
    new RegExp(`^${exact(label)}: ${exact(value)}\\. `),
  );
}

/** The six figures the strip must show for `expected` (brief 5.2). Not checked against the dev API. */
export async function expectStrip(page: Page, expected: Expected): Promise<void> {
  if (REAL) return;
  const { strip } = expected;
  await expectFigure(page, 'Total citations', formatInteger(strip.citations));
  await expectFigure(page, 'Citation rate', formatPercent(strip.frequency, { decimals: 1 }));
  await expectFigure(page, 'Prompt coverage', formatPercent(strip.coverage, { decimals: 1 }));
  await expectFigure(page, 'Unique cited URLs', formatInteger(strip.urls));
  await expectFigure(page, 'Unique cited domains', formatInteger(strip.domains));
  await expectFigure(
    page,
    'Citation growth',
    formatRelativeChange((strip.citations - strip.previousCitations) / strip.previousCitations),
  );
}

/** Opens the Citations page at `width` as the editor, with `query`, and waits for the strip to have its figures. */
export async function openCitations(page: Page, width: number, query = '', path = FYNIX_CITATIONS): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  await page.goto(query === '' ? path : `${path}?${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeAttached();
  await expect(figureOf(page, 'Total citations')).toBeVisible();
}

/** The page does not scroll sideways: the tables scroll inside their panel (19 section 3). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The byte order mark that tells Excel a CSV is UTF-8 (`src/lib/csv/csv-write.ts`). */
const BOM = String.fromCharCode(0xfeff);

/** Reads a downloaded CSV as lines, without its byte order mark. */
export async function readDownload(download: { path: () => Promise<string> }): Promise<string[]> {
  const text = readFileSync(await download.path(), 'utf8');
  return (text.startsWith(BOM) ? text.slice(1) : text).trim().split(/\r?\n/);
}
