import { expect, type Locator, type Page } from '@playwright/test';

import { signIn } from '../support';

/**
 * What the Citations e2e of WP-21 shares (apps/web/e2e/flows/ai-citations.spec.ts): the page and its people, the
 * way into the page and into the Citations tab of the prompt inspector, and the locators of what both draw. The
 * helpers live here because `e2e/support.ts` is frozen.
 */

/** An editor: reads AI data and exports it. */
export const EDITOR = 'priya@digibranders.test';
/** The key the theme is stored under in the browser, so a test can start in either theme. */
export const THEME_KEY = 'idraft.theme';
/** The Citations page of the Fynix mock project, whose mock answers carry the sources the tests read. */
export const FYNIX_CITATIONS = '/digibranders/fynix/ai/citations';
export const FYNIX_PROMPTS = '/digibranders/fynix/ai/prompts';
/** The first fixture prompt (`src/mocks/prompt-fixtures.ts`): it has own pages cited in some answers, not in all. */
export const FIRST_PROMPT = 'Which SEO agency is best for a SaaS startup in Germany?';
const FIRST_PROMPT_ID = '0192d1a8-e000-7a10-8e00-000000000001';

/** The inspector of the first prompt: beside the table on a wide window, a sheet over it on a narrow one. */
export const inspectorOf = (page: Page): Locator =>
  page.getByRole('complementary', { name: FIRST_PROMPT }).or(page.getByRole('dialog', { name: FIRST_PROMPT }));

/** The Domains table (a tree: a domain opens onto its pages) and the Pages table of the page. */
export const domainsTable = (page: Page): Locator => page.getByRole('treegrid', { name: 'Cited domains' });
export const pagesTable = (page: Page): Locator => page.getByRole('grid', { name: 'Cited pages' });

/** The six figures of the strip above the tables. */
export const stripOf = (page: Page): Locator => page.getByRole('group', { name: 'Citation summary' });

/**
 * The units every share of the page, or of the inspector tab, is of: from the line that says so ("Shares are of 569
 * citation units in 333 answers.", with ", counted over all engines" after it on the tab).
 */
export async function scopeUnits(root: Page | Locator): Promise<number> {
  // A paragraph: the same words are also the hidden description of a tooltip, which is no line of the page
  const note = root
    .getByRole('paragraph')
    .filter({ hasText: /^Shares are of [\d,]+ citation units? in [\d,]+ answers?[.,]/ });
  await expect(note).toBeVisible();
  const text = (await note.textContent()) ?? '';
  const units = /^Shares are of ([\d,]+) /.exec(text)?.[1];
  if (units === undefined) throw new Error(`The scope line has no units: "${text}"`);
  return Number(units.replaceAll(',', ''));
}

/** Waits until the page has drawn its tab: the heading, then the first cited domain or page. */
async function awaitTab(page: Page, params: Readonly<Record<string, string>>): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeVisible();
  const table = params['tab'] === 'pages' ? pagesTable(page) : domainsTable(page);
  await expect(table.getByRole('rowheader').first()).toBeVisible();
}

/** Opens the Citations page at `width`, as the editor, on the tab and filters `params` name (Domains with none). */
export async function openCitations(
  page: Page,
  width: number,
  params: Readonly<Record<string, string>> = {},
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  await visitCitations(page, params);
}

/** Goes to the Citations page again in the signed-in session. */
export async function visitCitations(page: Page, params: Readonly<Record<string, string>> = {}): Promise<void> {
  const query = new URLSearchParams(params).toString();
  await page.goto(query === '' ? FYNIX_CITATIONS : `${FYNIX_CITATIONS}?${query}`);
  await awaitTab(page, params);
}

/** The address of the first prompt's inspector on its Citations tab. */
const INSPECTOR_ADDRESS = `${FYNIX_PROMPTS}?${new URLSearchParams({
  tab: 'prompts',
  inspect: `prompt:${FIRST_PROMPT_ID}`,
  itab: 'citations',
}).toString()}`;

/** Goes to the Citations tab of the first prompt's inspector in the signed-in session; returns the inspector. */
export async function visitInspectorCitations(page: Page): Promise<Locator> {
  await page.goto(INSPECTOR_ADDRESS);
  const inspector = inspectorOf(page);
  await expect(inspector.getByRole('tab', { name: 'Citations' })).toHaveAttribute('aria-selected', 'true');
  // The banner is the last of the three reads the tab waits for before it says anything
  await expect(inspector.getByText(/^Cited in \d+ of \d+ answers?; last answer /)).toBeVisible();
  await expect(inspector.getByRole('table', { name: 'Most cited domains for this prompt' })).toBeVisible();
  return inspector;
}

/** Opens the Citations tab of the first prompt's inspector at `width`, as the editor. */
export async function openInspectorCitations(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  return visitInspectorCitations(page);
}
