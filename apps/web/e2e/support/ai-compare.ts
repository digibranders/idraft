import { expect, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { COMPARE_DETECTABLE_COOKIE } from '../../src/mocks/session';
import { signIn } from '../support';

/**
 * What the compare e2e of WP-19 shares (apps/web/e2e/flows/ai-compare.spec.ts): the page and its people, the way into
 * Topics & Prompts with or without the detectable change the mock can draw, the locators of what the page draws, and the
 * reading of every change drawn in a region (its text, how it is spoken, its colour). The helpers live here because
 * `e2e/support.ts` is frozen.
 */

/** An editor: reads AI data. */
export const EDITOR = 'priya@digibranders.test';
/** The key the theme is stored under in the browser, so a test can start in either theme. */
export const THEME_KEY = 'idraft.theme';
export const FYNIX_PROMPTS = '/digibranders/fynix/ai/prompts';
/** The topics of the Fynix fixtures (`src/mocks/entity-fixtures.ts`): SEO holds two topics; Paid Search stands alone. */
export const SEO = mockId('term', 1);
export const PAID_SEARCH = mockId('term', 6);
/** The first fixture prompt (`src/mocks/prompt-fixtures.ts`), in the topic SEO. */
export const FIRST_PROMPT = 'Which SEO agency is best for a SaaS startup in Germany?';
export const FIRST_PROMPT_ID = '0192d1a8-e000-7a10-8e00-000000000001';
/**
 * The prompts of Paid Search, the smallest topic: with the `mock-compare-detectable` cookie their Mention change, and
 * the topic's, is the one the interim test finds (`withDetectableChange` in `src/mocks/handlers/compare.ts`).
 */
export const PAID_SEARCH_PROMPTS = [
  'What is the best way to manage paid search on a small budget?',
  'How do I lower the cost per click of search ads?',
];

/** One change as the page draws it: the text a person sees, what a screen reader says, and its colour. */
export interface DrawnChange {
  /** "+58.3 pts". */
  text: string;
  /** "up 58.3 pts, detectable, interim test". */
  spoken: string;
  /** The tone class of `Delta`: `text-positive-text`, `text-negative-text` or `text-foreground-secondary`. */
  tone: string;
  /** The computed colour of the text. */
  color: string;
}

/** The changes drawn inside `region`, in page order: a number of points, drawn aria-hidden beside its spoken form. */
export async function changesIn(region: Locator): Promise<DrawnChange[]> {
  return region.evaluateAll((roots) =>
    roots.flatMap((root) =>
      [...root.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')]
        // A number then "pts" ("Prompts", a word, is not one)
        .filter((element) => /\d pts$/.test(element.textContent ?? ''))
        .map((element) => ({
          text: element.textContent ?? '',
          spoken: element.nextElementSibling?.textContent ?? '',
          tone: [...element.classList].find((name) => name.startsWith('text-')) ?? '',
          color: getComputedStyle(element).color,
        })),
    ),
  );
}

/** The changes drawn in `region` that are coloured: detectable ones. */
export const colouredIn = async (region: Locator): Promise<DrawnChange[]> =>
  (await changesIn(region)).filter((change) => change.tone !== 'text-foreground-secondary');

/** The tooltip that is open: the page keeps its closed ones in the document, so only the open one counts. */
export const openTip = (page: Page): Locator => page.locator('[data-slot="tooltip"][data-open]');

/** The summary strip above the tables: one chip per engine. */
export const stripOf = (page: Page): Locator => page.getByRole('group', { name: 'Summary of the prompts in view' });
export const topicsGrid = (page: Page): Locator => page.getByRole('treegrid', { name: 'Topics' });
export const promptsGrid = (page: Page): Locator => page.getByRole('grid', { name: 'Prompts' });
export const compareSelect = (page: Page): Locator => page.getByRole('combobox', { name: 'Compare with' });

/** The inspector of the first prompt: beside the table on a wide window, a sheet over it on a narrow one. */
export const inspectorOf = (page: Page): Locator =>
  page.getByRole('complementary', { name: FIRST_PROMPT }).or(page.getByRole('dialog', { name: FIRST_PROMPT }));

/** The drawer of a topic. */
export const drawerOf = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name }).or(page.getByRole('dialog', { name }));

/** The value of a card or an item of the strip of an inspector: the definition that follows its term. */
export const valueOf = (region: Locator, term: string): Locator =>
  region.getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::*[1]');

/** The address of the first prompt's inspector. */
export const INSPECT_FIRST_PROMPT = `${FYNIX_PROMPTS}?${new URLSearchParams({
  tab: 'prompts',
  inspect: `prompt:${FIRST_PROMPT_ID}`,
}).toString()}`;

export const inspectTopic = (topicId: string, params: Readonly<Record<string, string>> = {}): string =>
  `${FYNIX_PROMPTS}?${new URLSearchParams({ inspect: `topic:${topicId}`, ...params }).toString()}`;

/**
 * Makes the prompts summary draw one detectable change (or stops it): the mock reads the cookie on every request, so it
 * takes effect at once. The page must be one of the app's, and the context is fresh for each test.
 */
export async function setDetectable(page: Page, on: boolean): Promise<void> {
  await page.evaluate(
    ([name, value]) => {
      document.cookie =
        value === '' ? `${name}=; Path=/; Secure; Max-Age=0` : `${name}=${value}; Path=/; Secure; SameSite=Lax`;
    },
    [COMPARE_DETECTABLE_COOKIE, on ? 'on' : ''] as const,
  );
}

/** Waits until the page has drawn its table: Topics, or the Prompts tab when the address asks for it. */
async function awaitTable(page: Page, params: Readonly<Record<string, string>>): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeAttached();
  if (params['tab'] === 'prompts') {
    await expect(promptsGrid(page).getByRole('row').nth(1)).toBeVisible();
  } else if ((page.viewportSize()?.width ?? 1280) < 768) {
    // A phone has no tree table: the topics are a list of buttons
    await expect(
      page
        .getByRole('list', { name: /^Topics, \d+ results?$/ })
        .getByRole('listitem')
        .first(),
    ).toBeVisible();
  } else {
    await expect(topicsGrid(page).getByRole('row').nth(1)).toBeVisible();
  }
}

export interface OpenOptions {
  /** Draw the detectable change of the mock (default: the Fynix data as it is, with none). */
  detectable?: boolean;
  /** Wait for a table; false where the address leaves none to draw (an empty state instead). Default true. */
  table?: boolean;
}

/** Opens Topics & Prompts at `width`, as the editor, on the view and filters `params` name (Topics with none). */
export async function openPrompts(
  page: Page,
  width: number,
  params: Readonly<Record<string, string>> = {},
  { detectable = false, table = true }: OpenOptions = {},
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  if (detectable) await setDetectable(page, true);
  await visitPrompts(page, params, table);
}

/** Goes to Topics & Prompts again in the signed-in session. */
export async function visitPrompts(
  page: Page,
  params: Readonly<Record<string, string>> = {},
  table = true,
): Promise<void> {
  const query = new URLSearchParams(params).toString();
  await page.goto(query === '' ? FYNIX_PROMPTS : `${FYNIX_PROMPTS}?${query}`);
  if (table) await awaitTable(page, params);
  else await expect(page.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeAttached();
}

/** Waits until the read of the previous period has arrived: the strip has its changes. */
export async function awaitChanges(page: Page): Promise<void> {
  await expect.poll(async () => (await changesIn(stripOf(page))).length).toBeGreaterThan(0);
}

/** Turns on "Detectable changes only" through the + Filter menu. */
export async function addDetectableChip(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add a filter' }).click();
  await page.getByRole('button', { name: 'Show' }).click();
  await page.getByRole('radio', { name: 'Detectable changes only' }).click();
  await expect(page).toHaveURL(/[?&]detectable=only(&|$)/);
}

/** The text of the cells of one column of a table, in row order: the number of points a change cell draws, or its words. */
export async function columnOf(grid: Locator, header: RegExp): Promise<string[]> {
  return grid.evaluate((node, source) => {
    const pattern = new RegExp(source);
    const headers = [...node.querySelectorAll('[role="columnheader"]')];
    const index = headers.findIndex((cell) => pattern.test(cell.textContent ?? ''));
    if (index < 0) throw new Error(`No column matches ${source}`);
    // A row's children line up with the header's: the selection cell is a child of the row like the others
    return [...node.querySelectorAll('[role="row"]')]
      .map((row) => row.children[index])
      .filter((cell): cell is Element => cell !== undefined && cell.getAttribute('role') === 'gridcell')
      .map((cell) => {
        const change = [...cell.querySelectorAll('span[aria-hidden="true"]')].find((span) =>
          /\d pts$/.test(span.textContent ?? ''),
        );
        return (change?.textContent ?? cell.textContent ?? '').trim();
      });
  }, header.source);
}

/** The points of a change as written ("+8.3 pts", with the minus sign of the formatter), or `null` for "n/a". */
export function pointsOf(text: string): number | null {
  const found = /^(\D?)(\d+(?:\.\d+)?) pts$/.exec(text);
  if (found === null) return null;
  const size = Number(found[2]);
  // The sign is the one character before the number: "+" is a rise, anything else ("-" or the formatter's minus) a fall
  return found[1] === '' || found[1] === '+' ? size : -size;
}
