import { expect, type Locator, type Page } from '@playwright/test';

import { MOCK_USERS } from '../../src/mocks/fixtures';
import { SCREENS } from '../../src/lib/layouts/catalog';
import { preferenceKey } from '../../src/lib/preferences/storage';
import {
  ADMIN,
  DENSITIES,
  EDITOR,
  THEMES,
  VIEWER,
  WIDTHS,
  expectNoSeriousViolations,
  layoutSettled,
  type Density,
  type Theme,
} from './layouts';

/**
 * What the e2e of the AI visibility Overview shell (WP-33, apps/web/e2e/flows/ai-overview.spec.ts) shares: the page of
 * a project, the waits that say it has finished loading, the reads of the headline and of the Prompts page's own
 * strip, the density and the theme a person chose, and the one switch that makes the prompts summary slow or fail.
 * `e2e/support.ts` is frozen, so these live here; `support/layouts.ts` has the people, the widths and the axe check.
 */
export { ADMIN, DENSITIES, EDITOR, THEMES, VIEWER, WIDTHS, expectNoSeriousViolations, layoutSettled };
export type { Density, Theme };

export type OverviewProject = 'Fynix' | 'Cleanstart';
const SLUGS: Readonly<Record<OverviewProject, string>> = { Fynix: 'fynix', Cleanstart: 'cleanstart' };

/** The path of the screen of a project. */
export const overviewPath = (project: OverviewProject, search = ''): string =>
  `/digibranders/${SLUGS[project]}/ai${search}`;

const THEME_KEY = 'idraft.theme';

/** The ids of the cards of the built-in layout of the screen, in order (`lib/layouts/catalog.ts`, inventory 9.5 Default). */
export const BUILTIN_CARD_IDS: readonly string[] = (SCREENS.ai_overview.builtin.cards ?? []).map((card) => card.id);

/**
 * What each card of the Default layout is called. A card that is not built yet shows its catalog title on the pending
 * card; a card that is built draws the title its package chose, which the later packages are still setting, so for
 * those the heading is only required to be there (`null`). Change an entry to a title when its package lands.
 */
export const BUILTIN_CARD_TITLES: Readonly<Record<string, string | null>> = {
  // The headline card is the group "Headline numbers" and draws the hero's title
  'visibility-split': 'AI visibility rate',
  'rate-trend': 'AI visibility rate over time',
  'outcome-mix': 'Answer outcomes',
  'share-of-voice': 'Share of voice',
  'lost-to-competitor': 'Competitor gap',
  'topic-heatmap': 'Groups by platform',
  'top-domains': 'Top cited domains',
  'position-distribution': 'Mention position',
  'sentiment-by-engine': 'Sentiment by platform',
  'ai-referrals': 'AI referral visits',
  'fanout-top': 'Top fan-out queries',
};

/** What the eight tiles of the headline card are called, in order (preview `TILE_LAYOUT`). */
export const HEADLINE_TILE_LABELS = [
  'Mention rate',
  'Share of voice',
  'Citation rate',
  'Mention position',
  'Recommendation rate',
  'Sentiment',
  'Prompts',
  'Runs',
] as const;

// -------------------------------------------------------------------------------------------------
// Locators

export const pageHeading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'AI visibility' });
/** The headline card: the AI visibility hero and the eight key numbers (`ai.visibility_split`). */
export const headlineGroup = (page: Page): Locator =>
  page.getByRole('group', { name: 'Headline numbers', exact: true });
/** The hero of the headline: its title, the rate, the project value of a group and the split of the four outcomes. */
export const heroOf = (page: Page): Locator => headlineGroup(page).getByRole('region', { name: 'AI visibility rate' });
/** The strip of the eight tiles of the headline. */
export const keyNumbers = (page: Page): Locator => headlineGroup(page).getByRole('region', { name: 'Key numbers' });
export const scopeBar = (page: Page): Locator => page.getByRole('region', { name: 'Scope', exact: true });
export const cardGrid = (page: Page): Locator => page.getByRole('region', { name: 'AI visibility cards', exact: true });
export const cardById = (page: Page, id: string): Locator => cardGrid(page).locator(`[data-layout-card="${id}"]`);
export const bannersOf = (page: Page): Locator => page.getByRole('main').locator('[data-slot="banner"]');
/**
 * The freshness text: "AI updated Nov 13, 02:10". It does not change with the scope, so it names no prompt or platform
 * count. It is in the toolbar from 1440 px and at the foot of the page below that; only one of the two is drawn.
 */
export const metaLine = (page: Page): Locator =>
  page.locator('[data-slot="overview-meta"], [data-slot="page-header"] p.type-meta');
/** The Platform select of the scope bar, named by what it holds: "Platform: ChatGPT". */
export const platformSelect = (page: Page, shown = 'All platforms'): Locator =>
  scopeBar(page).getByRole('combobox', { name: `Platform: ${shown}`, exact: true });
/** The Group select of the scope bar, named by what it holds: "Group: SEO / Technical SEO". */
export const groupSelect = (page: Page, shown: string | RegExp = 'All groups'): Locator =>
  scopeBar(page).getByRole('combobox', {
    name: typeof shown === 'string' ? `Group: ${shown}` : shown,
    exact: typeof shown === 'string',
  });
/**
 * The icon button that puts the scope back: always in the bar, `visibility: hidden` while the scope is the default. A
 * role query skips a hidden element, so it is found by its name in the DOM; use `expectResetHidden` for its state.
 */
export const resetScope = (page: Page): Locator => scopeBar(page).locator('button[aria-label="Reset scope"]');

/** The Reset button is there and takes its room, but is not drawn: the scope is the default. */
export async function expectResetHidden(page: Page): Promise<void> {
  await expect(resetScope(page)).toHaveCount(1);
  await expect(resetScope(page)).toHaveCSS('visibility', 'hidden');
}
/** The error state of the headline card, with its own Retry. */
export const headlineError = (page: Page): Locator =>
  cardById(page, 'visibility-split')
    .locator('[data-slot="inline-error"]')
    .filter({ hasText: 'Could not load Headline numbers' });
/** The primary navigation's link to the Overview of the AI visibility group. */
export const overviewLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Overview', exact: true });

// -------------------------------------------------------------------------------------------------
// Opening and waiting

export interface OpenOptions {
  width?: number;
  height?: number;
  /** The address keys of the scope: `?win=7d`. */
  search?: string;
}

/**
 * Waits until the page is the finished one for a project that has an engine on: the engines are read (the scope bar
 * is there), and the headline has its values (a headline still reading shows skeletons).
 */
export async function waitForOverview(page: Page): Promise<void> {
  await expect(pageHeading(page)).toBeVisible();
  await expect(scopeBar(page)).toBeVisible();
  await expect(headlineGroup(page)).toBeVisible();
  await expect(headlineGroup(page)).not.toHaveAttribute('aria-busy', 'true');
  await expect(cardById(page, 'visibility-split').locator('[data-slot="skeleton"]')).toHaveCount(0);
}

/** Opens the screen of a project, signed in by the caller, at a width, and waits for the finished page. */
export async function openOverview(page: Page, project: OverviewProject, options: OpenOptions = {}): Promise<void> {
  const { width = 1280, height = 1100, search = '' } = options;
  await page.setViewportSize({ width, height });
  await page.goto(overviewPath(project, search));
  await waitForOverview(page);
}

/** Brings a card into view (a card far down loads once it is near) and waits until it has stopped loading. */
export async function awaitCardSettled(card: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(card.locator('section[aria-busy="true"]')).toHaveCount(0);
  await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(0);
}

/** Settles every card of the grid, whichever state it ends in, and returns to the top of the page. */
export async function awaitCardsSettled(page: Page): Promise<void> {
  for (const id of BUILTIN_CARD_IDS) await awaitCardSettled(cardById(page, id));
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

// -------------------------------------------------------------------------------------------------
// Reading the numbers

/** A tile of the headline as a person reads it. */
export interface NumberCell {
  /** The label: "Mention rate". */
  label: string;
  /** The value: "34%", "24", "n/a". */
  value: string;
  /** The one short line under the value: "Too few answers", "Not collected yet", "All groups 38%"; empty when there is none. */
  note: string;
}

/** The eight tiles of the headline in the order drawn. */
export async function numbersOf(page: Page): Promise<NumberCell[]> {
  return keyNumbers(page)
    .locator('div.bg-surface')
    .evaluateAll((tiles) =>
      tiles.map((tile) => {
        // The figure carries a screen reader sentence in a hidden span ("67%, Average of 2 platforms"): only what is drawn counts
        const drawn = (node: Node): string =>
          node instanceof HTMLElement && node.classList.contains('sr-only')
            ? ''
            : node.childNodes.length === 0
              ? (node.textContent ?? '')
              : Array.from(node.childNodes).map(drawn).join('');
        const text = (selector: string): string => {
          const found = tile.querySelector<HTMLElement>(selector);
          return found === null ? '' : drawn(found).replace(/\s+/g, ' ').trim();
        };
        return { label: text('span.type-label'), value: text('.type-metric'), note: text('span.type-micro') };
      }),
    );
}

/** One tile of the headline by its label; fails with the labels there are. */
export async function numberOf(page: Page, label: string): Promise<NumberCell> {
  const cells = await numbersOf(page);
  const found = cells.find((cell) => cell.label === label);
  if (found === undefined) {
    throw new Error(`The headline has no tile "${label}": it has ${cells.map((cell) => cell.label).join(', ')}`);
  }
  return found;
}

/** The AI visibility rate of the hero, as drawn: "47%" or "n/a". */
export async function heroValue(page: Page): Promise<string> {
  // The figure carries a screen reader sentence in a hidden span: only what is drawn is the rate
  return heroOf(page)
    .locator('.type-metric')
    .evaluate((node) =>
      Array.from(node.childNodes)
        .map((child) =>
          child instanceof HTMLElement && child.classList.contains('sr-only') ? '' : (child.textContent ?? ''),
        )
        .join('')
        .trim(),
    );
}

const WHITESPACE = /\s+/g;

/** The strip of the Prompts page (Prompts), which the numbers of the Overview must agree with. */
export const promptsStrip = (page: Page): Locator =>
  page.getByRole('group', { name: 'Summary of the prompts in view' });

/** A chip of the Prompts page's strip: "Prompts" or an engine's name, with the first line of its value. */
export async function promptsChip(page: Page, label: string): Promise<string> {
  const strip = promptsStrip(page);
  await expect(strip).toBeVisible();
  await expect(strip).not.toHaveAttribute('aria-busy', 'true');
  const chip = strip.locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) });
  const value = (await chip.locator('dd').innerText()).split('\n')[0]?.replace(WHITESPACE, ' ').trim();
  if (value === undefined || value === '') throw new Error(`The Prompts strip has no value for "${label}"`);
  return value;
}

// -------------------------------------------------------------------------------------------------
// What a person chose in this browser

/** The density a person chose under Preferences, kept in this browser under their id (`lib/preferences`). */
async function densityValue(email: string, density: Density): Promise<readonly [string, string]> {
  const user = MOCK_USERS.find((candidate) => candidate.email === email);
  if (user === undefined) throw new Error(`No fixture user has the email ${email}`);
  return [
    preferenceKey(user.user_id, 'settings'),
    JSON.stringify(density === 'default' ? { tableDensity: 'default' } : {}),
  ];
}

/** Chooses the theme and the density the way a person's browser keeps them, and loads the page again in them. */
export async function applyAppearance(
  page: Page,
  theme: Theme,
  density: Density,
  email: string = EDITOR,
): Promise<void> {
  const [densityKey, densityStored] = await densityValue(email, density);
  await page.evaluate(
    ([themeKey, themeValue, key, stored]) => {
      localStorage.setItem(themeKey, themeValue);
      localStorage.setItem(key, stored);
    },
    [THEME_KEY, theme, densityKey, densityStored] as const,
  );
  await page.reload();
  await waitForOverview(page);
  const html = page.locator('html');
  if (theme === 'dark') await expect(html).toHaveClass(/\bdark\b/);
  else await expect(html).not.toHaveClass(/\bdark\b/);
}

// -------------------------------------------------------------------------------------------------
// A slow or failing prompts summary

const SUMMARY_MODE_KEY = 'e2e-summary-mode';
const SUMMARY_GATE_KEY = '__e2eSummaryGate';

/** `fail` answers every summary read with a 503, `hold` keeps it waiting until `releaseSummary`, `ok` leaves it alone. */
export type SummaryMode = 'ok' | 'fail' | 'hold';

/**
 * Lets a test make the reads of the prompts summary (the headline and the meta line) wait or fail. The mock layer
 * answers inside the page through its service worker, below the network where `page.route` listens, so the page's
 * own `fetch` answers instead while a mode is on. The failure is a 503 `query_timeout`, which the retry policy takes as
 * final, so the headline shows its error at once and not after two backoffs. The mode is kept in `sessionStorage`, which a
 * reload keeps; call it before the page loads.
 */
export async function installSummaryControl(page: Page, mode: SummaryMode = 'ok'): Promise<void> {
  await page.addInitScript(
    ({ modeKey, gateKey, initial }) => {
      if (window.sessionStorage.getItem(modeKey) === null) window.sessionStorage.setItem(modeKey, initial);
      const answer = window.fetch.bind(window);
      const waiting: Array<() => void> = [];
      Reflect.set(window, gateKey, waiting);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        if (!/\/ai\/prompts-summary(\?|$)/.test(url)) return answer(input, init);
        const current = window.sessionStorage.getItem(modeKey);
        if (current === 'fail') {
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
        if (current === 'hold') {
          return new Promise<Response>((resolve, reject) => {
            waiting.push(() => {
              answer(input, init).then(resolve, reject);
            });
          });
        }
        return answer(input, init);
      };
    },
    { modeKey: SUMMARY_MODE_KEY, gateKey: SUMMARY_GATE_KEY, initial: mode },
  );
}

/** Turns the mode of `installSummaryControl` on for the page's next reads; `ok` also sends on the reads that were held. */
export async function setSummaryMode(page: Page, mode: SummaryMode): Promise<void> {
  await page.evaluate(
    ([modeKey, gateKey, value]) => {
      window.sessionStorage.setItem(modeKey, value);
      if (value === 'hold') return;
      const waiting: unknown = Reflect.get(window, gateKey);
      if (!Array.isArray(waiting)) return;
      for (const release of waiting.splice(0)) {
        if (typeof release === 'function') release();
      }
    },
    [SUMMARY_MODE_KEY, SUMMARY_GATE_KEY, mode] as const,
  );
}
