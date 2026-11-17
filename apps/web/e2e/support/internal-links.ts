import { expect, type Locator, type Page } from '@playwright/test';

import { waitForContent } from '../support';

/** An editor: writes tiers and rules, starts crawls. */
export const EDITOR = 'priya@digibranders.test';
/** An admin of the workspace: edits the workspace's page tiers. */
export const ADMIN = 'tomas@digibranders.test';
export const THEME_STORAGE_KEY = 'idraft.theme';
export const EVENTUS_LINKS = '/digibranders/eventus-security/seo/internal-links';
export const TIERS_SETTINGS = '/digibranders/settings/tiers';
export const LINKS_SETTINGS = '/digibranders/eventus-security/settings/links';

/** The mock crawl waits 3 s in the queue and runs to 8 s: a wait for it is bounded well above that. */
export const CRAWL_WAIT = 45_000;

export const pagesGrid = (page: Page): Locator => page.getByRole('grid', { name: 'Pages' });
export const linksGrid = (page: Page): Locator => page.getByRole('grid', { name: 'Links' });
export const canvasOf = (page: Page): Locator =>
  page.getByRole('group', { name: 'Link journey canvas. The tree list shows the same journey as a table.' });
export const treeOf = (page: Page): Locator => page.getByRole('table', { name: 'Link journey as a tree' });
export const flowTable = (page: Page): Locator => page.getByRole('table', { name: 'Links between tiers' });
/** The page card for `path` on the canvas, found by its accessible name, which starts with the path. */
export const card = (page: Page, path: string): Locator =>
  canvasOf(page)
    .getByRole('button', { name: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}, `) })
    .first();
/** The inspector beside a table or the canvas, named by the path of the page it shows. */
export const inspectorOf = (page: Page, path: string): Locator =>
  page.getByRole('complementary', { name: new RegExp(path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')) });

/** Opens Internal links on Eventus Security with the query given and waits for the heading. */
export async function openLinks(page: Page, query = ''): Promise<void> {
  await page.goto(`${EVENTUS_LINKS}${query === '' ? '' : `?${query}`}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Internal links' })).toBeAttached();
}

/** The rows of the Pages table are drawn: the first page is a row header. */
export async function expectPagesLoaded(page: Page): Promise<void> {
  await expect(pagesGrid(page).getByRole('rowheader').first()).toBeVisible();
}

/** Equity share is in the API payloads and is never shown: no word of it on the page, dialogs and panels included. */
export async function expectNoEquity(page: Page): Promise<void> {
  expect(await page.locator('body').innerText()).not.toMatch(/equity/i);
}

/** The tiers' strip on Tier flow: how many pages the tier holds (the strip reads "7 pages"). */
export async function tierPageCount(page: Page, code: string): Promise<number> {
  const item = page
    .getByRole('list', { name: 'Pages by tier' })
    .getByRole('listitem')
    .filter({ hasText: code })
    .first();
  await expect(item).toBeVisible();
  const match = /(\d[\d,]*) pages?\b/.exec(await item.innerText());
  if (match?.[1] === undefined) throw new Error(`The strip of ${code} reads no page count`);
  return Number(match[1].replaceAll(',', ''));
}

/** Waits for the content a state of the visual and axe runs is made of, as a person would see it settled. */
export async function waitForState(page: Page, kind: 'pages' | 'links' | 'journey' | 'tree' | 'flow'): Promise<void> {
  await waitForContent(page);
  switch (kind) {
    case 'pages':
      await expectPagesLoaded(page);
      break;
    case 'links':
      await expect(linksGrid(page).getByRole('rowheader').first()).toBeVisible();
      break;
    case 'journey':
      await expect(canvasOf(page).getByRole('button', { name: /focus page$/ })).toBeVisible();
      break;
    case 'tree':
      await expect(treeOf(page)).toBeVisible();
      break;
    case 'flow':
      await expect(flowTable(page)).toBeVisible();
      break;
  }
}
