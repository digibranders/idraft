import { expect, type Locator, type Page } from '@playwright/test';

import {
  RETRY,
  addCard,
  applyTheme,
  awaitCardReady,
  cardById,
  cardGrid,
  countDeltas,
  expectNoSidewaysScroll,
  installSummaryFault,
  openOverview,
  pageHeading,
  saveLayout,
  setSummaryFault,
  startCustomizing,
  tableButton,
} from './ai-overview-competitors';
import { EDITOR, THEMES, WIDTHS, type Theme } from './layouts';

/**
 * What the e2e of the engines cards (WP-34, apps/web/e2e/flows/ai-overview-engines.spec.ts) shares: the twelve
 * titles of the family, the way through Customize to a saved layout that holds them, and one switch that holds the
 * prompts summary back so a test can measure the cards while they load. The page, the Customize helpers and the
 * failing summary switch are WP-35's (./ai-overview-competitors.ts); `e2e/support.ts` is frozen.
 */
export {
  EDITOR,
  RETRY,
  THEMES,
  WIDTHS,
  addCard,
  applyTheme,
  awaitCardReady,
  cardById,
  cardGrid,
  countDeltas,
  expectNoSidewaysScroll,
  installSummaryFault,
  openOverview,
  pageHeading,
  setSummaryFault,
  tableButton,
};
export type { Theme };

/** The AI visibility screen of the Cleanstart mock project: every engine is off, so the page draws no grid. */
export const CLEANSTART_PATH = '/digibranders/cleanstart/ai';
/** What a card that no package has built yet says (`aiOverview.pending.title`). */
export const NOT_BUILT = 'This card is not built yet';
/** The title of a failed card (`aiOverview.engines.common.errorTitle`). */
export const COULD_NOT_LOAD = /^Could not load /;

/** The built-in layout's cards that belong to this family, by their ids (`SCREENS.ai_overview.builtin`). */
export const BUILTIN_FAMILY = {
  changeSummary: 'change-summary',
  rateTrend: 'rate-trend',
  outcomeMix: 'outcome-mix',
} as const;

/** The headings of the three family cards the built-in layout holds. */
export const BUILTIN_TITLES = ['What changed', 'Mention rate by engine', 'Named and cited, by engine'] as const;

/**
 * The other nine cards of the family as the Add card dialog names them: the catalog titles
 * (`src/lib/layouts/catalog.ts`), which `addCard` clicks as `Add <title>`. Two of them differ from the heading the
 * card draws (the funnel says "..., by engine" in its heading), so a card is found by `ADDED_TITLES`, not by these.
 */
export const ADDED_CATALOG_TITLES = [
  'Mention rate trend',
  'Prompt movers',
  'This period vs the last',
  'What moved the rate',
  'AI by engine',
  'From answer to citation',
  'Answers behind the numbers',
  'Engine agreement',
  'By country',
] as const;

/** The same nine cards by the exact heading each draws (`aiOverview.engines.*.title`), in the order of the list above. */
export const ADDED_TITLES = [
  'Mention rate trend',
  'Prompt movers',
  'This period vs the last',
  'What moved the rate',
  'AI by engine',
  'From answer to citation, by engine',
  'Answers behind the numbers',
  'Engine agreement',
  'By country',
] as const;

/** All twelve headings of the family: the layout holds twelve cards at most, so these fill it. */
export const FAMILY_TITLES = [...BUILTIN_TITLES, ...ADDED_TITLES] as const;

/** The cards of the built-in layout that are not this family's: hidden to make room (the layout holds 12). */
const OTHER_CARDS = [
  'top-domains',
  'topic-heatmap',
  'share-of-voice-chatgpt',
  'competitor-trend-chatgpt',
  'key-changes',
  'opportunities',
] as const;

/** A card by the exact text of its heading; several cards of the family share words, so a substring would not do. */
export const cardByHeading = (page: Page, title: string): Locator =>
  cardGrid(page)
    .locator('[data-layout-card]')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });

/** Every card the grid holds, whichever its state. */
export const allCards = (page: Page): Locator => cardGrid(page).locator('[data-layout-card]');

/**
 * Hides the six cards of the built-in layout that are not this family's, one at a time. The Hide button is the
 * only one of a card's toolbar whose name starts with "Hide", and the card leaves the grid at once.
 */
async function hideOtherCards(page: Page): Promise<void> {
  for (const id of OTHER_CARDS) {
    const before = await allCards(page).count();
    await cardById(page, id)
      .getByRole('button', { name: /^Hide / })
      .click();
    await expect(allCards(page)).toHaveCount(before - 1);
  }
}

/**
 * Signed in as the editor: opens the screen, optionally hides the six other cards, adds the cards of `titles`
 * through the Add card slot and saves; `titles` are catalog titles (`ADDED_CATALOG_TITLES`), not card headings. The built-in layout has nine cards, so with the six hidden three are left and
 * nine more fit: twelve, the most a layout holds.
 */
export async function saveEnginesLayout(
  page: Page,
  titles: readonly string[],
  { hideOthers = true }: { hideOthers?: boolean } = {},
): Promise<void> {
  await openOverview(page);
  await startCustomizing(page);
  if (hideOthers) await hideOtherCards(page);
  for (const title of titles) await addCard(page, title);
  await saveLayout(page);
  const kept = hideOthers ? BUILTIN_TITLES.length : OTHER_CARDS.length + BUILTIN_TITLES.length;
  await expect(allCards(page)).toHaveCount(kept + titles.length);
}

/** Waits until every card of `titles` has stopped loading, whichever state it ended in. */
export async function awaitTitlesReady(page: Page, titles: readonly string[]): Promise<void> {
  for (const title of titles) await awaitCardReady(cardByHeading(page, title));
}

// -------------------------------------------------------------------------------------------------
// Holding the summary back

const GATE_KEY = 'e2e-hold-summary';
const GATE_GLOBAL = '__e2eSummaryGate';

/**
 * Lets a test hold every read of the prompts summary until it says so, so the cards can be measured while they
 * load. The mock layer answers inside the page through its service worker, below the network where `page.route`
 * listens, so the page's own `fetch` waits instead, as `installSummaryFault` does for a failing read. While
 * `setSummaryHold(page, true)` is on, a page load holds the reads; `openSummary` lets them through, once per load.
 */
export async function installSummaryHold(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, name]: readonly [string, string]) => {
      const answer = window.fetch.bind(window);
      let held = 0;
      let open: () => void = () => undefined;
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      Object.defineProperty(window, name, { value: { held: () => held, open: () => open() } });
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        if (/\/ai\/prompts-summary(\?|$)/.test(url) && window.sessionStorage.getItem(key) === '1') {
          held += 1;
          await opened;
        }
        return answer(input, init);
      };
    },
    [GATE_KEY, GATE_GLOBAL] as const,
  );
}

/** Turns the hold of `installSummaryHold` on or off for the next page load; `sessionStorage` keeps it across reloads. */
export async function setSummaryHold(page: Page, holding: boolean): Promise<void> {
  await page.evaluate(([key, value]) => window.sessionStorage.setItem(key, value), [
    GATE_KEY,
    holding ? '1' : '0',
  ] as const);
}

/** How many summary reads the page is holding back now. */
export async function heldSummaryReads(page: Page): Promise<number> {
  return page.evaluate((name) => {
    const gate: unknown = Reflect.get(window, name);
    return typeof gate === 'object' && gate !== null && 'held' in gate && typeof gate.held === 'function'
      ? Number(gate.held())
      : 0;
  }, GATE_GLOBAL);
}

/** Lets the held reads through. */
export async function openSummary(page: Page): Promise<void> {
  await page.evaluate((name) => {
    const gate: unknown = Reflect.get(window, name);
    if (typeof gate === 'object' && gate !== null && 'open' in gate && typeof gate.open === 'function') gate.open();
  }, GATE_GLOBAL);
}

/** The top of the first card from the top of the document, as whole pixels: what sits above the grid shows in it. */
export async function firstCardTop(page: Page): Promise<number> {
  return allCards(page)
    .first()
    .evaluate((card) => Math.round(card.getBoundingClientRect().top + window.scrollY));
}

/** The distance of each card's top from the top of the grid, in document order, as whole pixels. */
export async function cardTops(page: Page): Promise<number[]> {
  const grid = await cardGrid(page).elementHandle();
  if (grid === null) throw new Error('The card grid is not on the page');
  return allCards(page).evaluateAll((cards, gridElement) => {
    const origin = gridElement.getBoundingClientRect().top;
    return cards.map((card) => Math.round(card.getBoundingClientRect().top - origin));
  }, grid);
}
