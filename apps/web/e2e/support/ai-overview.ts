import { expect, type Locator, type Page } from '@playwright/test';

import { MOCK_USERS } from '../../src/mocks/fixtures';
import { cardAvailability } from '../../src/lib/layouts/availability';
import { CARD_TYPES, SCREENS, cardName, cardType } from '../../src/lib/layouts/catalog';
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
  waitForAnnouncement,
  type Density,
  type Theme,
} from './layouts';

/**
 * What the e2e of the AI visibility Overview shell (WP-33, apps/web/e2e/flows/ai-overview.spec.ts) shares: the page of
 * a project, the waits that say it has finished loading, the reads of the numbers strip and of the Prompts page's own
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

/** What the numbers of the built-in layout are called in the strip, in order. */
export const BUILTIN_NUMBER_LABELS = [
  'Prompts',
  'Mention rate ChatGPT',
  'Mention rate Gemini',
  'Mention rate AI Mode',
] as const;

// -------------------------------------------------------------------------------------------------
// Locators

export const pageHeading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'AI visibility' });
/** The strip of the page: named by its window and its branded choice, "AI visibility numbers for Oct 17 to Nov 13, ...". */
export const numbersGroup = (page: Page): Locator => page.getByRole('group', { name: /^AI visibility numbers for / });
export const scopeBar = (page: Page): Locator => page.getByRole('region', { name: 'Scope', exact: true });
export const cardGrid = (page: Page): Locator => page.getByRole('region', { name: 'AI visibility cards', exact: true });
export const cardById = (page: Page, id: string): Locator => cardGrid(page).locator(`[data-layout-card="${id}"]`);
export const bannersOf = (page: Page): Locator => page.getByRole('main').locator('[data-slot="banner"]');
/** The meta line under the title: "AI updated Nov 13, 02:10 · 24 prompts · 2 engines". */
export const metaLine = (page: Page): Locator => page.locator('[data-slot="page-header"] p.type-meta');
/** The strip error row of the numbers zone, with its own Retry. */
export const stripError = (page: Page): Locator =>
  page.locator('[data-slot="inline-error"]').filter({ hasText: 'The AI numbers could not be read' });
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
 * is there), and the strip of numbers has its values (a strip still reading is `aria-busy`).
 */
export async function waitForOverview(page: Page): Promise<void> {
  await expect(pageHeading(page)).toBeVisible();
  await expect(scopeBar(page)).toBeVisible();
  const strip = numbersGroup(page);
  await expect(strip).toBeVisible();
  await expect(strip).not.toHaveAttribute('aria-busy', 'true');
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

/** A number of the strip as a person reads it. */
export interface NumberCell {
  /** The metric and its engine: "Mention rate ChatGPT". */
  label: string;
  /** The first line of the value: "34%", "24", "Not asked". */
  value: string;
  /** Every line of the value block, joined: the figure, its change, its counts. */
  text: string;
  /** Where the label leads, or `null` for a number that is plain text. */
  href: string | null;
}

const WHITESPACE = /\s+/g;

/** The numbers of the strip in the order drawn. */
export async function numbersOf(page: Page): Promise<NumberCell[]> {
  return numbersGroup(page)
    .locator('dl > div')
    .evaluateAll((cells) =>
      cells.map((cell) => {
        const term = cell.querySelector('dt');
        const detail = cell.querySelector('dd');
        const lines = (detail instanceof HTMLElement ? detail.innerText : '')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '');
        const link = term?.querySelector('a');
        return {
          label: (term instanceof HTMLElement ? term.innerText : '').replace(/\s+/g, ' ').trim(),
          value: lines[0] ?? '',
          text: lines.join(' '),
          href: link?.getAttribute('href') ?? null,
        };
      }),
    );
}

/** One number of the strip by its label; fails with the labels there are. */
export async function numberOf(page: Page, label: string): Promise<NumberCell> {
  const cells = await numbersOf(page);
  const found = cells.find((cell) => cell.label === label);
  if (found === undefined) {
    throw new Error(`The strip has no number "${label}": it has ${cells.map((cell) => cell.label).join(', ')}`);
  }
  return found;
}

/** The strip of the Prompts page (Topics & Prompts), which the numbers of the Overview must agree with. */
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
 * Lets a test make the reads of the prompts summary (the numbers and the meta line) wait or fail. The mock layer
 * answers inside the page through its service worker, below the network where `page.route` listens, so the page's
 * own `fetch` answers instead while a mode is on. The failure is a 503 `query_timeout`, which the retry policy takes as
 * final, so the strip shows its error at once and not after two backoffs. The mode is kept in `sessionStorage`, which a
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

// -------------------------------------------------------------------------------------------------
// Customize mode on this page (the parts are WP-15 and WP-16's; the screen is `ai_overview`)

export const customizeButton = (page: Page): Locator => page.getByRole('button', { name: 'Customize', exact: true });
export const saveBar = (page: Page): Locator => page.locator('[data-slot="layout-save-bar"]');
export const barButton = (page: Page, name: string): Locator =>
  saveBar(page).getByRole('button', { name, exact: true });
/** A part of a card's toolbar in customize mode: `handle`, `more`, `width`, `options`. */
export const cardPart = (page: Page, id: string, part: string): Locator =>
  cardById(page, id).locator(`[data-part="${part}"]`);
export const addCardSlot = (page: Page): Locator => cardGrid(page).locator('[data-add-card-slot]');
export const catalogDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Add card', exact: true });
export const discardDialog = (page: Page): Locator =>
  page.getByRole('alertdialog', { name: 'Discard unsaved changes?', exact: true });
/** The cards unavailable in a project are drawn as these in customize mode. */
export const unavailableCards = (page: Page): Locator => cardGrid(page).locator('[data-slot="unavailable-card"]');
/** The notice the tooltip of the layouts parts and the team default dialogs use. */
export const toastOf = (page: Page, title: string): Locator =>
  page.locator('[data-slot="toast"]').filter({ hasText: title });

const GROUP_LABEL = { seo: 'SEO', ai: 'AI', cross: 'Cross-channel', activity: 'Activity' } as const;
const GROUP_ORDER = ['seo', 'ai', 'cross', 'activity'] as const;
/** The active card types of the screen that need no permission: what the catalog lists for a member who holds none of them. */
const FREE_TYPES = CARD_TYPES.filter(
  (type) => type.status === 'active' && type.screens.includes('ai_overview') && type.permission === null,
);

/** The titles the card catalog lists on this screen for a member without a permission-gated card, sorted. */
export const aiCatalogTitles = (): string[] => FREE_TYPES.map((type) => type.title).sort();

/** The group headings the catalog shows on this screen, in the order it shows them. */
export const aiCatalogGroups = (): string[] =>
  GROUP_ORDER.filter((group) => FREE_TYPES.some((type) => type.group === group)).map((group) => GROUP_LABEL[group]);

/** The titles of the types that need a permission, which a member may or may not see in the catalog. */
export const permissionGatedTitles = (): string[] =>
  CARD_TYPES.filter(
    (type) => type.status === 'active' && type.screens.includes('ai_overview') && type.permission !== null,
  ).map((type) => type.title);

/** The cards of the built-in layout that a project with no AI engine cannot show, by the catalog's own rule. */
export function cardsUnavailableWithoutAi(): string[] {
  const capabilities = { channels: ['seo'], permissions: ['data:read'], integrations: [] } as const;
  return (SCREENS.ai_overview.builtin.cards ?? [])
    .filter((item) => {
      const type = cardType(item.type);
      return type !== undefined && cardAvailability(type, capabilities).state === 'unavailable';
    })
    .map((item) => item.id);
}

/** What a card of the built-in layout is called in its toolbar ("Hide AI opportunities"). */
export function builtinCardName(id: string): string {
  const item = (SCREENS.ai_overview.builtin.cards ?? []).find((card) => card.id === id);
  if (item === undefined) throw new Error(`The built-in layout of the AI visibility screen has no card "${id}"`);
  return cardName(item);
}

/** The cards of the grid in the order drawn, as the ids they carry in `data-layout-card`. */
export async function cardOrder(page: Page): Promise<string[]> {
  return cardGrid(page)
    .locator('[data-layout-card]')
    .evaluateAll((nodes) => nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.layoutCard ?? '') : '')));
}

/** The page draws the cards of an edit a render after it says so: the order is read until it is the one expected. */
export async function expectCardOrder(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(() => cardOrder(page)).toEqual([...expected]);
}

/** What the strip says of its numbers, in order, in either mode: "Prompts", "Mention rate Gemini". */
export async function numberLabels(page: Page): Promise<string[]> {
  return numbersGroup(page)
    .locator('dt')
    .evaluateAll((nodes) =>
      // innerText: the metric and the engine are two blocks, which textContent runs together
      nodes.map((node) => (node instanceof HTMLElement ? node.innerText : '').replace(/\s+/g, ' ').trim()),
    );
}

export async function expectNumberLabels(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(() => numberLabels(page)).toEqual([...expected]);
}

/** Presses Customize and waits until the mode is on: the save bar is there and the first card has its handle. */
export async function openCustomize(page: Page): Promise<void> {
  await expect(customizeButton(page)).toBeEnabled();
  await customizeButton(page).click();
  await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(saveBar(page)).toBeVisible();
  await layoutSettled(page);
}

/** Hides a card of the built-in layout with its toolbar button, and waits for the words and the new order. */
export async function hideCard(page: Page, id: string, remaining: readonly string[]): Promise<void> {
  const name = builtinCardName(id);
  await cardGrid(page)
    .getByRole('button', { name: `Hide ${name}`, exact: true })
    .click();
  await waitForAnnouncement(page, `${name} hidden. Add it back from the catalog.`);
  await expectCardOrder(page, remaining);
}

/** Saves the draft and waits until the mode has ended. */
export async function saveLayout(page: Page): Promise<void> {
  await barButton(page, 'Save layout').click();
  await waitForAnnouncement(page, 'Layout saved');
  await expect(saveBar(page)).toHaveCount(0);
}

export { waitForAnnouncement };

/** One row of the card grid as it is drawn: which cards, and whether they fill the grid's width. */
export interface DrawnRow {
  cards: string[];
  full: boolean;
}

/**
 * The rows of the cards grid as drawn at the window's width, read from the boxes: cards that share a top are one row,
 * and a row is full when its last card ends where the grid does. Pending and finished cards alike are measured, since
 * the cell's width is the grid's, not the card's.
 */
export async function drawnRows(page: Page): Promise<DrawnRow[]> {
  return cardGrid(page)
    .locator('[data-layout-card]')
    .evaluateAll((nodes) => {
      const cells = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
      const grid = cells[0]?.parentElement?.getBoundingClientRect();
      if (grid === undefined) return [];
      const rows: Array<{ top: number; right: number; cards: string[] }> = [];
      for (const cell of cells) {
        const box = cell.getBoundingClientRect();
        const row = rows.find((candidate) => Math.abs(candidate.top - box.top) < 4);
        if (row === undefined) rows.push({ top: box.top, right: box.right, cards: [cell.dataset.layoutCard ?? ''] });
        else {
          row.right = Math.max(row.right, box.right);
          row.cards.push(cell.dataset.layoutCard ?? '');
        }
      }
      return rows.map((row) => ({ cards: row.cards, full: row.right >= grid.right - 2 }));
    });
}

/** The 1 based numbers of the rows that do not fill the grid. */
export const partEmptyRows = (rows: readonly DrawnRow[]): number[] =>
  rows.flatMap((row, index) => (row.full ? [] : [index + 1]));

// -------------------------------------------------------------------------------------------------
// The Export Numbers file and the tooltip of a number

/** The sentence of a number's tooltip, which its cell keeps as its description for assistive technology. */
export async function numberTip(page: Page, label: string): Promise<string> {
  const tip = await numbersGroup(page)
    .locator('dl > div')
    .filter({ has: page.locator('dt', { hasText: label }) })
    .evaluate((cell) => {
      const id = cell.querySelector('dd')?.getAttribute('aria-describedby');
      return id === null || id === undefined ? '' : (document.getElementById(id)?.textContent ?? '');
    });
  return tip.replace(WHITESPACE, ' ').trim();
}

/** A CSV file as rows of cells (RFC 4180: quoted cells, doubled quotes, CRLF), without its byte order mark. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
