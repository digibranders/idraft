import { expect, type Locator, type Page } from '@playwright/test';

import { MOCK_USERS } from '../../src/mocks/fixtures';
import { preferenceKey } from '../../src/lib/preferences/storage';
import { cardById, cardGrid, cardTitled, pageHeading, startCustomizing, saveLayout } from './ai-overview-competitors';
import { EDITOR, type Density } from './layouts';

/**
 * What the e2e of the source, fan-out, activity and operations cards (WP-37, apps/web/e2e/flows/
 * ai-overview-sources.spec.ts) shares: the two projects, the titles of the twelve cards, the way through Customize to a
 * saved layout that holds all of them, and the preferences of a person. `e2e/support.ts` is frozen, so these live here.
 */
export { EDITOR, cardById, cardGrid, cardTitled, pageHeading };
/** A viewer: has no `costs:read`, so the catalog hides the AI spend card from them. */
export const VIEWER = 'mei@digibranders.test';

/** Fynix: three engines (two on), 23 prompts and answers in every build, but no AI runs, so no collection history. */
export const FYNIX_PATH = '/digibranders/fynix/ai';
/** Eventus Security: AI runs, schedules and 92 days of answers, but only in a server that starts with the AI seed. */
export const EVENTUS_PATH = '/digibranders/eventus-security/ai';
export const POLITE = '#live-region-polite';

/** The built-in layout of the screen holds these two source and activity cards; the others are real once added. */
export const BUILTIN_IDS = { topDomains: 'top-domains', keyChanges: 'key-changes' } as const;

/** The cards the layout leaves out to make room: a layout holds 12 cards at most and the built-in one holds 9. */
const MAKE_ROOM_FOR_ADDED = [
  'change-summary',
  'rate-trend',
  'outcome-mix',
  'topic-heatmap',
  'share-of-voice-chatgpt',
  'competitor-trend-chatgpt',
  'opportunities',
] as const;

/** The ten cards added through Add card: the name of the catalog (the dialog's button) and the title the card draws. */
export const ADDED_CARDS = {
  ownPages: { catalog: 'Your pages AI engines cite', title: 'Your pages AI engines cite' },
  roleShare: { catalog: 'Citation share by domain type', title: 'Citation share by source role and engine' },
  fanout: { catalog: 'What ChatGPT searched', title: 'What ChatGPT searched' },
  newLost: { catalog: 'New and lost sources', title: 'New and lost sources' },
  diversity: { catalog: 'Source diversity', title: 'Source diversity over time' },
  collection: { catalog: 'Collection status', title: 'Collection status' },
  engines: { catalog: 'Engines and schedule', title: 'Engines and schedule' },
  spend: { catalog: 'AI spend', title: 'AI spend' },
  calendar: { catalog: 'Answers collected', title: 'Answer collection calendar' },
  status: { catalog: 'Answer status by engine', title: 'Answer status by engine and day' },
} as const;
export type AddedCard = keyof typeof ADDED_CARDS;

export const TOP_DOMAINS_TITLE = 'Top cited domains';
export const KEY_CHANGES_TITLE = 'Key changes';
/** What a card the registry has no component for says: no card of this package may say it. */
export const NOT_BUILT = 'This card is not built yet';

/** The twelve cards of the saved layout, by the title they draw. */
export const ALL_TITLES: readonly string[] = [
  TOP_DOMAINS_TITLE,
  KEY_CHANGES_TITLE,
  ...Object.values(ADDED_CARDS).map((card) => card.title),
];

// -------------------------------------------------------------------------------------------------
// Locators

export const saveBar = (page: Page): Locator => page.locator('[data-slot="layout-save-bar"]');
export const customizeButton = (page: Page): Locator => page.getByRole('button', { name: 'Customize', exact: true });
export const addCardDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Add card', exact: true });
export const cardByTitle = (page: Page, title: string): Locator => cardTitled(page, title);
/** The Table view toggle of a frame card: the button "Table" in the group "<title> view". */
export const tableToggle = (card: Locator): Locator =>
  card.getByRole('group', { name: / view$/ }).getByRole('button', { name: 'Table', exact: true });
/** The Ranked and By role choice of the top cited domains card: a radio group named View. */
export const viewChoice = (card: Locator): Locator => card.getByRole('radiogroup', { name: 'View', exact: true });
/** The engine toolbar of the collection calendar and status cards: one engine at a time. */
export const engineTabs = (card: Locator): Locator => card.getByRole('toolbar', { name: 'Engine', exact: true });

// -------------------------------------------------------------------------------------------------
// Opening the page and the layout

/** Opens the AI visibility screen of a project at a width, as the signed in person, and waits for its heading. */
export async function openScreen(page: Page, path: string, width = 1280, search = ''): Promise<void> {
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(`${path}${search}`);
  await expect(pageHeading(page)).toBeVisible();
}

/** True once the project's cards are on the page; false when it says that no AI engine is on (an unseeded Eventus). */
export async function hasAiEngines(page: Page): Promise<boolean> {
  const none = page.getByText('No AI engine is on', { exact: true });
  await none.or(cardGrid(page)).first().waitFor();
  return (await none.count()) === 0;
}

/** Hides a card of the built-in layout in Customize mode. */
async function hideCard(page: Page, id: string): Promise<void> {
  const grid = cardGrid(page);
  await grid
    .locator(`[data-layout-card="${id}"]`)
    .getByRole('button', { name: /^Hide /, exact: false })
    .click();
  await expect(grid.locator(`[data-layout-card="${id}"]`)).toHaveCount(0);
}

/** Adds a card through the Add card slot and waits for the words that say it was added. */
export async function addCatalogCard(page: Page, catalog: string): Promise<void> {
  await cardGrid(page).locator('[data-add-card-slot]').click();
  const dialog = addCardDialog(page);
  await dialog.getByRole('button', { name: `Add ${catalog}`, exact: true }).click();
  await expect(page.locator(POLITE)).toHaveText(/ added, position \d+ of \d+$/);
  await expect(dialog).toHaveCount(0);
}

/** In Customize mode, hides the seven cards of the built-in layout that this package does not need (room for ten). */
export async function makeRoom(page: Page): Promise<void> {
  for (const id of MAKE_ROOM_FOR_ADDED) await hideCard(page, id);
}

/** In Customize mode, adds the ten cards of this package one after the other. */
export async function addTenCards(page: Page): Promise<void> {
  for (const card of Object.values(ADDED_CARDS)) await addCatalogCard(page, card.catalog);
}

/**
 * Starts from the built-in layout (the top cited domains and key changes cards among its nine), hides the seven
 * others, adds the ten cards of this package and saves: twelve cards, the most a layout holds. Customize mode needs a
 * window of tablet width or more.
 */
export async function saveSourcesLayout(page: Page): Promise<void> {
  await startCustomizing(page);
  await makeRoom(page);
  await addTenCards(page);
  await saveLayout(page);
  await expect(cardGrid(page).locator('[data-layout-card]')).toHaveCount(12);
}

/** Waits until a card has drawn its frame and stopped loading, whichever state it ended in. */
export async function awaitCard(page: Page, title: string): Promise<Locator> {
  const card = cardByTitle(page, title);
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('heading', { level: 2, name: title })).toBeVisible();
  await expect(card.locator('section[aria-busy="true"]')).toHaveCount(0);
  return card;
}

/** Waits until all twelve cards have stopped loading. */
export async function awaitAllCards(page: Page): Promise<void> {
  for (const title of ALL_TITLES) await awaitCard(page, title);
}

// -------------------------------------------------------------------------------------------------
// Preferences

/** What a person chose under Preferences is kept in this browser under their id; Compact is what is stored when nothing is. */
export async function chooseDensity(page: Page, email: string, density: Density): Promise<void> {
  const user = MOCK_USERS.find((candidate) => candidate.email === email);
  if (user === undefined) throw new Error(`No fixture user has the email ${email}`);
  const value = JSON.stringify(density === 'default' ? { tableDensity: 'default' } : {});
  await page.evaluate(([key, stored]) => localStorage.setItem(key, stored), [
    preferenceKey(user.user_id, 'settings'),
    value,
  ] as const);
}

/** The page's own text has no en or em dash (the rendered copy rule, `expectAccessible` of support.ts says the same). */
export function expectNoDashes(text: string): void {
  expect(text).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
}
