import type { Locator, Page } from '@playwright/test';

import {
  RETRY,
  applyTheme,
  awaitCardReady,
  cardById,
  cardGrid,
  expectNoSidewaysScroll,
  installSummaryFault,
  openOverview,
  pageHeading,
  setSummaryFault,
  tableButton,
} from './ai-overview-competitors';
import { EDITOR, THEMES, WIDTHS, type Theme } from './layouts';

/**
 * What the e2e of the engines cards (apps/web/e2e/flows/ai-overview-engines.spec.ts) shares: the two cards of the
 * built-in layout, and one switch that holds the prompts summary back so a test can measure the cards while they load. The page, the Customize helpers and the
 * failing summary switch are WP-35's (./ai-overview-competitors.ts); `e2e/support.ts` is frozen.
 */
export {
  EDITOR,
  RETRY,
  THEMES,
  WIDTHS,
  applyTheme,
  awaitCardReady,
  cardById,
  cardGrid,
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
/** The title of a failed card (`aiOverview.engines.common.errorTitle`). */
export const COULD_NOT_LOAD = /^Could not load /;

/** The two cards of this family that the built-in layout holds, by their ids (`SCREENS.ai_overview.builtin`). */
export const BUILTIN_FAMILY = {
  rateTrend: 'rate-trend',
  outcomeMix: 'outcome-mix',
} as const;

/** The headings of the two cards: the trend is titled by the Metric of the page, AI visibility until it is changed. */
export const BUILTIN_TITLES = ['AI visibility rate over time', 'Answer outcomes'] as const;

/** A card by the exact text of its heading; several cards share words, so a substring would not do. */
export const cardByHeading = (page: Page, title: string): Locator =>
  cardGrid(page)
    .locator(`[data-layout-card][data-card-title="${title}"]`)
    .or(
      cardGrid(page)
        .locator('[data-layout-card]')
        .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) }),
    );

/** Every card the grid holds, whichever its state. */
export const allCards = (page: Page): Locator => cardGrid(page).locator('[data-layout-card]');

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

/** The distance of each card's top from the top of the grid, in document order, as whole pixels. */
export async function cardTops(page: Page): Promise<number[]> {
  const grid = await cardGrid(page).elementHandle();
  if (grid === null) throw new Error('The card grid is not on the page');
  return allCards(page).evaluateAll((cards, gridElement) => {
    const origin = gridElement.getBoundingClientRect().top;
    return cards.map((card) => Math.round(card.getBoundingClientRect().top - origin));
  }, grid);
}
