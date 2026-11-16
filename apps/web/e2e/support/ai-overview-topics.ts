import { expect, type Locator, type Page } from '@playwright/test';

import {
  EDITOR,
  RETRY,
  THEMES,
  WIDTHS,
  awaitCardReady,
  cardById,
  cardGrid,
  cardTitled,
  changeEngine,
  expectNoSidewaysScroll,
  installSummaryFault,
  openOverview,
  pageHeading,
  saveLayout,
  setSummaryFault,
  startCustomizing,
  startFrom,
} from './ai-overview-competitors';
import { groupSelect, platformSelect } from './ai-overview';
import { DENSITIES, expectNoSeriousViolations, type Density, type Theme } from './layouts';
import { preferenceKey } from '../../src/lib/preferences/storage';
import { MOCK_USERS } from '../../src/mocks/fixtures';
import { mockId } from '../../src/mocks/mock-ids';

/**
 * What the e2e of the groups cards (apps/web/e2e/flows/ai-overview-topics.spec.ts) shares: the Executive preset, which
 * holds the groups heat map and the top and bottom groups, the locators of the heat map, and the three switches the
 * spec needs on the summary read: a failure, a hold, and cells with too few answers or none. The page and the way
 * through Customize are those of the competitors cards (`ai-overview-competitors.ts`).
 */
export {
  DENSITIES,
  EDITOR,
  RETRY,
  THEMES,
  WIDTHS,
  awaitCardReady,
  cardById,
  cardGrid,
  cardTitled,
  changeEngine,
  expectNoSeriousViolations,
  expectNoSidewaysScroll,
  installSummaryFault,
  openOverview,
  pageHeading,
  saveLayout,
  setSummaryFault,
  startCustomizing,
  startFrom,
};
export type { Density, Theme };

// -------------------------------------------------------------------------------------------------
// The cards

/** The ids the Executive preset gives the two group cards (`presets/presets.ts`); the Default layout has the heat map only. */
export const GROUP_CARDS = { heatmap: 'topic-heatmap', extremes: 'topic-extremes' } as const;

export const HEATMAP_TITLE = 'Groups by platform';
export const EXTREMES_TITLE = 'Top and bottom groups';
/** The first sentence of the footnote of every groups card, and the count that follows it. */
export const OVERLAP_NOTE =
  /Groups overlap: a prompt in two groups counts in both, so the rows do not add up to the total\./;

/** The columns of the heat map while both platforms of the Fynix mock are asked, AI Overview not collected yet. */
export const BOTH_PLATFORM_COLUMNS = ['Group', 'Prompts', 'ChatGPT', 'Gemini', 'AI Overview', 'avg of 2'];

/** The Platform and Group selects of the scope bar (`support/ai-overview.ts`), which the group cards' specs drive. */
export { groupSelect, platformSelect };

export const customizeButton = (page: Page): Locator => page.getByRole('button', { name: 'Customize', exact: true });
export const saveBar = (page: Page): Locator => page.locator('[data-slot="layout-save-bar"]');

/** Customizes the page: the Executive preset, which holds both group cards; then saves. */
export async function saveGroupLayout(page: Page): Promise<void> {
  await openOverview(page);
  await startCustomizing(page);
  await startFrom(page, 'Executive');
  await saveLayout(page);
  for (const id of Object.values(GROUP_CARDS)) await awaitCardReady(cardById(page, id));
}

/** Waits until every card of the page has stopped loading, and fails when one shows that its read failed. */
export async function awaitEveryCardReady(page: Page): Promise<void> {
  const cards = cardGrid(page).locator('[data-layout-card]');
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    await awaitCardReady(card);
    await expect(card.getByText(/could not be read/)).toHaveCount(0);
  }
}

// -------------------------------------------------------------------------------------------------
// The heat map

export const heatmapCard = (page: Page): Locator => cardById(page, GROUP_CARDS.heatmap);
export const extremesCard = (page: Page): Locator => cardById(page, GROUP_CARDS.extremes);
/** The grid of the card. */
export const heatmapGrid = (card: Locator): Locator => card.getByRole('treegrid').or(card.getByRole('grid'));
/** A cell of the grid by the group and the platform it is named for ("SEO / Technical SEO on ChatGPT: ..."). */
export const heatCell = (card: Locator, group: string, platform: string): Locator =>
  heatmapGrid(card).getByRole('gridcell', { name: new RegExp(`^${group} on ${platform}: `) });

// -------------------------------------------------------------------------------------------------
// Display: theme and table density

/**
 * Chooses the theme and the table density the way a person's browser keeps them (`idraft.theme`, and the
 * `tableDensity` of the settings kept under the person's id), and loads the page again in them. Compact is the
 * density the app opens in, so it is the one that writes no choice.
 */
export async function applyDisplay(page: Page, theme: Theme, density: Density): Promise<void> {
  const user = MOCK_USERS.find((candidate) => candidate.email === EDITOR);
  if (user === undefined) throw new Error(`No fixture user has the email ${EDITOR}`);
  const settings = JSON.stringify(density === 'default' ? { tableDensity: 'default' } : {});
  await page.evaluate(
    ([themeValue, key, value]) => {
      localStorage.setItem('idraft.theme', themeValue);
      localStorage.setItem(key, value);
    },
    [theme, preferenceKey(user.user_id, 'settings'), settings] as const,
  );
  await page.reload();
  await expect(pageHeading(page)).toBeVisible();
  const html = page.locator('html');
  if (theme === 'dark') await expect(html).toHaveClass(/\bdark\b/);
  else await expect(html).not.toHaveClass(/\bdark\b/);
}

/**
 * Every en dash and em dash the scope shows to a person: in its text, and in the names it gives (`aria-label`,
 * `title`, `alt`), which a screen reader speaks and a tooltip shows.
 */
export async function dashesIn(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const dash = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    const found: string[] = [];
    if (dash.test(root.textContent ?? '')) found.push(`text: ${(root.textContent ?? '').slice(0, 80)}`);
    for (const element of root.querySelectorAll('[aria-label], [title], [alt]')) {
      for (const name of ['aria-label', 'title', 'alt']) {
        const value = element.getAttribute(name) ?? '';
        if (dash.test(value)) found.push(`${name}: ${value.slice(0, 80)}`);
      }
    }
    return found;
  });
}

// -------------------------------------------------------------------------------------------------
// The keyboard

/** Presses Tab until the focus is on `target`; it takes a few presses to cross a card's own controls. */
export async function tabTo(page: Page, target: Locator, maxPresses = 12): Promise<void> {
  const focused = target.and(page.locator(':focus'));
  const trail: string[] = [];
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    if ((await focused.count()) > 0) return;
    trail.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        return `${element?.tagName ?? 'none'} ${element?.getAttribute('aria-label') ?? element?.textContent?.slice(0, 30) ?? ''}`;
      }),
    );
  }
  throw new Error(`The focus did not reach the target in ${String(maxPresses)} presses of Tab: ${trail.join(' | ')}`);
}

/** Puts the focus on the title of a card, so that the next Tab starts from the card (a click on text does not do it in a headless window). */
export async function focusTitleOf(card: Locator): Promise<void> {
  await card
    .getByRole('heading', { level: 2 })
    .first()
    .evaluate((title: HTMLElement) => {
      title.tabIndex = -1;
      title.focus();
    });
}

// -------------------------------------------------------------------------------------------------
// The summary read: cells with few answers or none, and a hold

const CELLS_KEY = 'e2e-thin-cells';

/** The group the rewritten cells belong to: two prompts, so nothing else of the page leans on it. */
export const THIN_TOPIC = 'Paid Search';
/** Its term id in the mock (`src/mocks/entity-fixtures.ts`): the summary names a row by it. */
export const THIN_TOPIC_ID = mockId('term', 6);
/** What the rewritten cells hold: ChatGPT 2 of 3 answers (too few for a percent), Gemini none. */
export const THIN_ANSWERS = 3;

/**
 * Lets a test change two cells of the summary the page reads, in the page and after the mock layer has answered:
 * the mention and outcome cells of the group `THIN_TOPIC` on ChatGPT become 2 of 3 valid answers, and on Gemini they
 * become no answer at all. Both keep a `value` (a rate of 67% and a rate of 0), the way a careless reader of the API would
 * draw them: the card must go by the answers behind a cell and print neither. The mock data of Fynix has a rate
 * behind every cell at the default window, so this is the only way to meet these two states there. The switch is
 * kept in `sessionStorage`, which a reload keeps; a failed answer is left as it is.
 */
export async function installThinCells(page: Page): Promise<void> {
  interface Cell {
    numerator: number;
    denominator: number;
    n_observations: number;
    value: number | null;
    pooled?: { successes: number; trials: number } | null;
  }
  interface Row {
    term_id: string | null;
    engines: Array<{ engine_code: string; mentioned: Cell; outcomes: Record<string, Cell> }>;
  }
  interface Body {
    data?: { topics?: Row[] };
  }
  await page.addInitScript(
    ([key, termId, answers]) => {
      const answer = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const response = await answer(input, init);
        const url = input instanceof Request ? input.url : String(input);
        if (!response.ok || !/\/ai\/prompts-summary(\?|$)/.test(url) || window.sessionStorage.getItem(key) !== '1') {
          return response;
        }
        const body = (await response.clone().json()) as Body;
        for (const row of body.data?.topics ?? []) {
          if (row.term_id !== termId) continue;
          for (const engine of row.engines) {
            // AI visibility (the default measure) reads the outcome cells, the mention measure the mention cell
            const cells = [engine.mentioned, ...Object.values(engine.outcomes)];
            if (engine.engine_code === 'chatgpt_web') {
              for (const cell of cells) {
                cell.n_observations = answers;
                cell.pooled = { successes: cell === engine.outcomes.neither ? answers - 2 : 0, trials: answers };
                cell.value = 0;
              }
              engine.mentioned.pooled = { successes: 2, trials: answers };
              engine.mentioned.value = 2 / answers;
              const both = engine.outcomes.mentioned_and_cited;
              if (both?.pooled != null) both.pooled.successes = 2;
            } else if (engine.engine_code === 'gemini_web') {
              for (const cell of cells) {
                cell.n_observations = 0;
                cell.pooled = { successes: 0, trials: 0 };
                cell.numerator = 0;
                cell.value = 0;
              }
            }
          }
        }
        return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
      };
    },
    [CELLS_KEY, THIN_TOPIC_ID, THIN_ANSWERS] as const,
  );
}

/** Turns the rewrite of `installThinCells` on or off for the page's next reads. */
export async function setThinCells(page: Page, on: boolean): Promise<void> {
  await page.evaluate(([key, value]) => window.sessionStorage.setItem(key, value), [
    CELLS_KEY,
    on ? '1' : '0',
  ] as const);
}

interface HoldWindow extends Window {
  e2eSummaryHold?: { open: boolean; waiters: Array<() => void> };
}

/**
 * Lets a test hold every read of the prompts summary until it says so, to look at the cards while they wait. The
 * hold is on from the first script of the page and ends with `releaseSummary`. A page that is loaded again holds
 * again.
 */
export async function installSummaryHold(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hold: NonNullable<HoldWindow['e2eSummaryHold']> = { open: false, waiters: [] };
    (window as HoldWindow).e2eSummaryHold = hold;
    const answer = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (/\/ai\/prompts-summary(\?|$)/.test(url) && !hold.open) {
        await new Promise<void>((resolve) => hold.waiters.push(resolve));
      }
      return answer(input, init);
    };
  });
}

/** Lets the held reads go: the cards load, and the page does not hold again until it is loaded anew. */
export async function releaseSummary(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hold = (window as HoldWindow).e2eSummaryHold;
    if (hold === undefined) throw new Error('installSummaryHold was not called before the page loaded');
    hold.open = true;
    for (const resolve of hold.waiters.splice(0)) resolve();
  });
}
