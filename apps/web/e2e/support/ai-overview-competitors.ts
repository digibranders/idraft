import { expect, type Locator, type Page } from '@playwright/test';

import { EDITOR, THEMES, WIDTHS, type Theme } from './layouts';

/**
 * What the e2e of the competitors cards (WP-35, apps/web/e2e/flows/ai-overview-competitors.spec.ts) shares: the
 * page, the way through Customize to a saved layout that holds every card of the family, the locators of the cards
 * and the one switch that makes the summary read fail. `e2e/support.ts` is frozen, so these live here.
 */
export { EDITOR, THEMES, WIDTHS };
export type { Theme };

/** The AI visibility screen of the Fynix mock project: three engines asked, 24 prompts, five competitors. */
export const OVERVIEW_PATH = '/digibranders/fynix/ai';
export const THEME_KEY = 'idraft.theme';
/** The words of the retry button of a failed card (`common.retry`). */
export const RETRY = 'Try again';
/** What every share of voice footnote starts with: the tracked set, named. */
export const TRACKED_SET = /Tracked brands: you and \d+ competitors?\./;

/** The ids the Competitive preset gives its cards of the family (`presets/presets.ts`). */
export const PRESET_FAMILY = {
  shareOfVoiceChatgpt: 'share-of-voice-chatgpt',
  shareOfVoiceGemini: 'share-of-voice-gemini',
  trend: 'competitor-trend-chatgpt',
  lostTo: 'lost-to-competitor-chatgpt',
  table: 'competitor-table',
  overTime: 'sov-over-time-chatgpt',
  coMentions: 'co-mentions-chatgpt',
} as const;

// -------------------------------------------------------------------------------------------------
// Locators

export const pageHeading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'AI visibility' });
export const cardGrid = (page: Page): Locator => page.getByRole('region', { name: 'AI visibility cards', exact: true });
export const cardById = (page: Page, id: string): Locator => cardGrid(page).locator(`[data-layout-card="${id}"]`);
/** A card by the title of its frame; two cards may share a title, so a preset card is better found by id. */
export const cardTitled = (page: Page, title: string | RegExp): Locator =>
  cardGrid(page)
    .locator('[data-layout-card]')
    .filter({ has: page.getByRole('heading', { level: 2, name: title }) });
const customizeButton = (page: Page): Locator => page.getByRole('button', { name: 'Customize', exact: true });
const saveBar = (page: Page): Locator => page.locator('[data-slot="layout-save-bar"]');
const polite = (page: Page): Locator => page.locator('#live-region-polite');

/** The nine cards of the saved layout of `saveFamilyLayout`: every type of the family, the engine ones for ChatGPT. */
export const familyCards = (page: Page): ReadonlyArray<{ name: string; card: Locator }> => [
  { name: 'Share of voice on ChatGPT', card: cardById(page, PRESET_FAMILY.shareOfVoiceChatgpt) },
  { name: 'Share of voice on Gemini', card: cardById(page, PRESET_FAMILY.shareOfVoiceGemini) },
  { name: 'Mention rate on ChatGPT', card: cardById(page, PRESET_FAMILY.trend) },
  { name: 'Prompts lost to a competitor on ChatGPT', card: cardById(page, PRESET_FAMILY.lostTo) },
  { name: 'Mention rate by engine', card: cardById(page, PRESET_FAMILY.table) },
  { name: 'Share of voice over time, ChatGPT', card: cardById(page, PRESET_FAMILY.overTime) },
  { name: 'Who we are named with on ChatGPT', card: cardById(page, PRESET_FAMILY.coMentions) },
  { name: 'Share of voice rank', card: cardTitled(page, /^Share of voice rank on /) },
  { name: 'AI opportunities', card: cardTitled(page, 'AI opportunities') },
];

/** The Table view button of a card: the toggle in the group "<title> view" of its frame. */
export const tableButton = (card: Locator): Locator =>
  card.getByRole('group', { name: / view$/ }).getByRole('button', { name: 'Table', exact: true });

// -------------------------------------------------------------------------------------------------
// Opening the page and the layout

/** Opens the screen as the signed in person, at a width, and waits for its heading. */
export async function openOverview(page: Page, width = 1280, search = ''): Promise<void> {
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(`${OVERVIEW_PATH}${search}`);
  await expect(pageHeading(page)).toBeVisible();
}

/** Presses Customize and waits until the mode is on. Needs a window of tablet width or more. */
export async function startCustomizing(page: Page): Promise<void> {
  await expect(customizeButton(page)).toBeEnabled();
  await customizeButton(page).click();
  await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(saveBar(page)).toBeVisible();
}

/** Chooses a preset of the Start from menu and waits for the words that say the draft took it. */
export async function startFrom(page: Page, preset: string): Promise<void> {
  await saveBar(page).getByRole('button', { name: 'Start from', exact: true }).click();
  await page.getByRole('menuitem', { name: preset, exact: true }).click();
  await expect(polite(page)).toHaveText(`${preset} applied. Save to keep it.`);
}

/** Saves the draft and waits until the mode has ended. */
export async function saveLayout(page: Page): Promise<void> {
  await saveBar(page).getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(polite(page)).toHaveText('Layout saved');
  await expect(saveBar(page)).toHaveCount(0);
}

/** Adds a card of the catalog through the Add card slot, and waits for the words that say where it went. */
export async function addCard(page: Page, title: string): Promise<void> {
  await cardGrid(page).locator('[data-add-card-slot]').click();
  await page
    .getByRole('dialog', { name: 'Add card', exact: true })
    .getByRole('button', { name: `Add ${title}`, exact: true })
    .click();
  await expect(polite(page)).toHaveText(new RegExp(`^${title}.* added, position \\d+ of \\d+$`));
}

/** Gives the card of `id` another engine through its Options popover (the card is named `name` until it does). */
export async function changeEngine(page: Page, id: string, name: string, engine: string): Promise<void> {
  await cardById(page, id)
    .getByRole('button', { name: `Options for ${name}`, exact: true })
    .click();
  // The popover is named after the card, and the card is named after its engine: the name changes with the choice
  const popover = page.getByRole('dialog', { name: /^Options for / });
  await popover.getByRole('radio', { name: new RegExp(`^${engine}`) }).click();
  await expect(popover.getByRole('radio', { name: new RegExp(`^${engine}`) })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
}

/**
 * Signed in as the editor, saves a layout of the Competitive preset plus the two cards of the family it leaves out
 * (share of voice rank and AI opportunities): every type of the family on the page once, nine cards in all.
 */
export async function saveFamilyLayout(page: Page): Promise<void> {
  await openOverview(page);
  await startCustomizing(page);
  await startFrom(page, 'Competitive');
  await addCard(page, 'Share of voice rank');
  await addCard(page, 'AI opportunities');
  await saveLayout(page);
  await expect(cardGrid(page).locator('[data-layout-card]')).toHaveCount(11);
}

// -------------------------------------------------------------------------------------------------
// Waiting for and reading cards

/** Brings a card into view (a card far down loads once it is near) and waits until it has stopped loading. */
export async function awaitCardReady(card: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(card.locator('section[aria-busy="true"]')).toHaveCount(0);
}

/** Waits until every card of the family has stopped loading, whichever state it ended in. */
export async function awaitFamilyReady(page: Page): Promise<void> {
  for (const { card } of familyCards(page)) await awaitCardReady(card);
}

/** Chooses the theme the way a person's browser keeps it, and loads the page again in it. */
export async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, theme] as const);
  await page.reload();
  await expect(pageHeading(page)).toBeVisible();
  const html = page.locator('html');
  if (theme === 'dark') await expect(html).toHaveClass(/\bdark\b/);
  else await expect(html).not.toHaveClass(/\bdark\b/);
}

/** The page does not scroll sideways: its scroll width is no more than the window's. */
export async function expectNoSidewaysScroll(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

/**
 * How many changes the text of `scope` shows: a signed change in points ("+2.1 pts") or the words that read it
 * to a screen reader ("up 2.1 pts", "no change"). A card with a comparison off shows none.
 */
export async function countDeltas(scope: Locator): Promise<number> {
  const text = await scope.innerText();
  return text.match(/\b(?:up|down) [\d.]+ pts\b|\bno change\b|[+−][\d.]+ pts/g)?.length ?? 0;
}

// -------------------------------------------------------------------------------------------------
// A failing summary read

const SUMMARY_FAULT_KEY = 'e2e-fail-summary';

/**
 * Lets a test make every read of the prompts summary fail. The mock layer answers inside the page through its
 * service worker, below the network where `page.route` listens, and it has no fault switch for this route, so the
 * page's own `fetch` answers instead while `setSummaryFault(page, true)` is on. The answer is a 503 `query_timeout`,
 * which the retry policy takes as final, so the cards show their error at once and not after two backoffs. The
 * switch is kept in `sessionStorage`, which a reload keeps.
 */
export async function installSummaryFault(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const answer = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (/\/ai\/prompts-summary(\?|$)/.test(url) && window.sessionStorage.getItem(key) === '1') {
        const problem = {
          title: 'The summary timed out',
          status: 503,
          code: 'query_timeout',
          request_id: 'e2e-failed',
        };
        return Promise.resolve(
          new Response(JSON.stringify(problem), {
            status: 503,
            headers: { 'content-type': 'application/problem+json' },
          }),
        );
      }
      return answer(input, init);
    };
  }, SUMMARY_FAULT_KEY);
}

/** Turns the failure of `installSummaryFault` on or off for the page's next reads. */
export async function setSummaryFault(page: Page, failing: boolean): Promise<void> {
  await page.evaluate(([key, value]) => window.sessionStorage.setItem(key, value), [
    SUMMARY_FAULT_KEY,
    failing ? '1' : '0',
  ] as const);
}
