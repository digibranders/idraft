import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { waitForContent } from '../support';
import { MOCK_USERS } from '../../src/mocks/fixtures';
import { LAYOUTS_COOKIE } from '../../src/mocks/session';
import { preferenceKey } from '../../src/lib/preferences/storage';

/**
 * What the customize e2e of WP-16 shares (apps/web/e2e/flows/ai-layouts.spec.ts): the page and its people, the
 * locators of the customize specimen, the helpers that wait for what a person waits for (a card that listens to the
 * keyboard, the words of the polite region) and the reads of what the mock stored. The page is the group "Customize
 * mode, live" of /design-system/layouts-live, the real customize UI on the mock API.
 */
export const LAYOUTS_PAGE = '/design-system/layouts-live';
/** An editor: may customize, may not manage the team default. */
export const EDITOR = 'priya@digibranders.test';
/** An admin: may also set and remove the team default. */
export const ADMIN = 'tomas@digibranders.test';

export const WIDTHS = [390, 768, 1024, 1280] as const;
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const DENSITIES = ['default', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/** The ids of the built-in overview cards in document order (lib/layouts/catalog.ts). */
export const BUILTIN_CARDS = [
  'trend',
  'rank-distribution',
  'matrix',
  'unclassified',
  'key-changes',
  'opportunities',
  'ai-by-engine',
  'competitors',
] as const;
/** The ids of the built-in overview numbers in document order. */
export const BUILTIN_NUMBERS = [
  'visibility',
  'top10',
  'aio-citation',
  'mention-chatgpt',
  'mention-gemini',
  'mention-ai-mode',
] as const;
/** What the strip shows of the built-in numbers, in the same order. */
export const BUILTIN_NUMBER_LABELS = [
  'SEO visibility',
  'Top 10',
  'AIO citation rate',
  'Mention rate ChatGPT',
  'Mention rate Gemini',
  'Mention rate AI Mode',
] as const;
/** The cards the project Cleanstart can show: it tracks no AI engine, so the four AI cards have no data there. */
export const CARDS_WITHOUT_AI = ['trend', 'rank-distribution', 'key-changes', 'competitors'] as const;

/** An id the page gives a card or a number it adds (`layout-provider.tsx` `newId`). */
export const NEW_CARD_ID = /^c-[0-9a-f]{8}$/;
export const NEW_NUMBER_ID = /^n-[0-9a-f]{8}$/;

const THEME_STORAGE_KEY = 'idraft.theme';
const POLITE_REGION = '#live-region-polite';
const MSW_COOKIE_STORE = '__msw-cookie-store__';
const GRID_LABEL = 'Customizable overview cards';
const NUMBERS_LABEL = 'Overview numbers';
/** The WCAG 2.2 AA rules axe checks on every page (20-accessibility.md). */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// -------------------------------------------------------------------------------------------------
// Locators

/** The group "Customize mode, live". The page has other specimens with a Customize button of their own. */
export const customizeSpecimen = (page: Page): Locator => page.locator('[data-specimen="customize"]');
export const customizeButton = (page: Page): Locator =>
  customizeSpecimen(page).getByRole('button', { name: 'Customize', exact: true });
export const projectSelect = (page: Page): Locator =>
  customizeSpecimen(page).getByRole('combobox', { name: 'Project' });
export const cardGrid = (page: Page): Locator =>
  customizeSpecimen(page).getByRole('region', { name: GRID_LABEL, exact: true });
export const card = (page: Page, id: string): Locator => cardGrid(page).locator(`[data-layout-card="${id}"]`);
export const cardPart = (page: Page, id: string, part: string): Locator =>
  card(page, id).locator(`[data-part="${part}"]`);
export const addCardSlot = (page: Page): Locator => cardGrid(page).locator('[data-add-card-slot]');
export const numberStrip = (page: Page): Locator =>
  customizeSpecimen(page).getByRole('group', { name: NUMBERS_LABEL, exact: true });
export const addNumberSlot = (page: Page): Locator => numberStrip(page).locator('[data-add-number-slot]');
export const saveBar = (page: Page): Locator => customizeSpecimen(page).locator('[data-slot="layout-save-bar"]');
export const barButton = (page: Page, name: string): Locator =>
  saveBar(page).getByRole('button', { name, exact: true });
/** A toast, wherever the page portals it. */
export const toastOf = (page: Page, title: string): Locator =>
  page.locator('[data-slot="toast"]').filter({ hasText: title });

// -------------------------------------------------------------------------------------------------
// Opening the page

export interface OpenOptions {
  theme?: Theme;
  width?: number;
  height?: number;
  /** The project the specimen is scoped to: Fynix tracks AI engines, Cleanstart none. */
  project?: 'Fynix' | 'Cleanstart';
  /** The density the signed in person chose in Preferences; the browser's own default when left out. */
  density?: Density;
  /** Who is signed in, for the density they chose. */
  as?: string;
}

/** What a person has chosen under Preferences, kept in this browser under their id (`lib/preferences`). */
async function chooseDensity(page: Page, email: string, density: Density): Promise<void> {
  const user = MOCK_USERS.find((candidate) => candidate.email === email);
  if (user === undefined) throw new Error(`No fixture user has the email ${email}`);
  const value = JSON.stringify(density === 'default' ? { tableDensity: 'default' } : {});
  await page.addInitScript(
    ([key, stored]) => {
      localStorage.setItem(key, stored);
    },
    [preferenceKey(user.user_id, 'settings'), value] as const,
  );
}

/** How many cards the customize specimen shows in view mode for a project. */
export const shownCardCount = (project: 'Fynix' | 'Cleanstart'): number =>
  project === 'Fynix' ? BUILTIN_CARDS.length : CARDS_WITHOUT_AI.length;

/**
 * Waits until the specimen is ready for `project`: the project chosen, the engines of the project read (the AI
 * cards come with them) and the layout loaded, so the grid holds `cards` cards (the built-in layout's count for the
 * project unless a saved layout has another).
 */
export async function waitForScreen(
  page: Page,
  project: 'Fynix' | 'Cleanstart' = 'Fynix',
  cards: number = shownCardCount(project),
): Promise<void> {
  const select = projectSelect(page);
  await expect(select).toBeVisible();
  if (!(await select.innerText()).includes(project)) {
    await select.click();
    await page.getByRole('option', { name: project, exact: true }).click();
  }
  await expect(select).toHaveText(project);
  await expect(cardGrid(page).locator('[data-layout-card]')).toHaveCount(cards);
}

/** Opens the specimen page, signed in by the caller, at a width and a theme, scoped to a project. */
export async function openLayouts(page: Page, options: OpenOptions = {}): Promise<void> {
  const { theme = 'light', width = 1280, height = 1100, project = 'Fynix', density, as = EDITOR } = options;
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  if (density !== undefined) await chooseDensity(page, as, density);
  await page.setViewportSize({ width, height });
  await page.goto(LAYOUTS_PAGE);
  await waitForScreen(page, project);
}

/** Loads the page again, the way a person does, and waits for the specimen. */
export async function reloadLayouts(
  page: Page,
  project: 'Fynix' | 'Cleanstart' = 'Fynix',
  cards: number = shownCardCount(project),
): Promise<void> {
  await page.reload();
  await waitForScreen(page, project, cards);
}

/** Presses Customize and waits until the mode is on: the save bar is there and the first card has its handle. */
export async function openCustomize(page: Page): Promise<void> {
  await expect(customizeButton(page)).toBeEnabled();
  await customizeButton(page).click();
  await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(saveBar(page)).toBeVisible();
  await expect(cardPart(page, 'trend', 'handle')).toBeVisible();
  await layoutSettled(page);
}

/** Picks a project in the specimen's select and waits for its cards (`cards` of them, as `waitForScreen`). */
export async function chooseProject(
  page: Page,
  project: 'Fynix' | 'Cleanstart',
  cards: number = shownCardCount(project),
): Promise<void> {
  await projectSelect(page).click();
  await page.getByRole('option', { name: project, exact: true }).click();
  await waitForScreen(page, project, cards);
}

// -------------------------------------------------------------------------------------------------
// Reading the page

/** The cards of the grid in the order they are drawn, as the ids they carry in `data-layout-card`. */
export async function cardOrder(page: Page): Promise<string[]> {
  return cardGrid(page)
    .locator('[data-layout-card]')
    .evaluateAll((nodes) => nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.layoutCard ?? '') : '')));
}

/** The ids of the number cells, in customize mode (view mode has no ids to read). */
export async function numberOrder(page: Page): Promise<string[]> {
  return numberStrip(page)
    .locator('[data-layout-number]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.layoutNumber ?? '') : '')),
    );
}

/** What the strip says of its numbers, in order, in either mode: "SEO visibility", "Mention rate Gemini". */
export async function numberLabels(page: Page): Promise<string[]> {
  return numberStrip(page)
    .locator('dt')
    .evaluateAll((nodes) =>
      // innerText: the metric and the engine are two blocks, which textContent runs together
      nodes.map((node) => (node instanceof HTMLElement ? node.innerText : '').replace(/\s+/g, ' ').trim()),
    );
}

/** The page draws the cards of an edit a render after it says so: the order is read until it is the one expected. */
export async function expectCardOrder(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(() => cardOrder(page)).toEqual([...expected]);
}

export async function expectNumberOrder(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(() => numberOrder(page)).toEqual([...expected]);
}

export async function expectNumberLabels(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(() => numberLabels(page)).toEqual([...expected]);
}

/** What the layout screens last said through the polite live region. */
export async function waitForAnnouncement(page: Page, text: string): Promise<void> {
  await expect(page.locator(POLITE_REGION)).toHaveText(text);
}

// -------------------------------------------------------------------------------------------------
// The keyboard

/**
 * Waits until a card or a number that has been picked up takes keys. dnd-kit starts listening to the keyboard one
 * timer after the pick up it announces, and the browser runs a key that is already queued before that timer: a key
 * sent the moment the message appears is lost. A person answers the message, not the same millisecond; the timer of
 * this page is queued after dnd-kit's, so it runs once the drag listens.
 */
export async function dragListens(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      }),
  );
}

/**
 * Waits until the page has stopped moving: the window has kept its scroll position for a few frames and no
 * transition or animation that will end is running. Entering customize mode grows the cards and the strip over about
 * 300 ms, and a card that takes focus is scrolled to smoothly: a card picked up in the middle of that is measured
 * against a page that is still shifting, and dropped somewhere else (a put back). A person picks up after looking.
 */
export async function layoutSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const deadline = performance.now() + 3000;
        let last = Number.NaN;
        let still = 0;
        const frame = (): void => {
          const moving = document
            .getAnimations()
            .some(
              (animation) =>
                animation.playState === 'running' &&
                animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
            );
          still = window.scrollY === last && !moving ? still + 1 : 0;
          last = window.scrollY;
          if (still >= 6 || performance.now() > deadline) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

export const pickedUpText = (name: string): string =>
  `${name} picked up. Use the arrow keys to move, Space to drop, Escape to put it back.`;

export interface KeyboardDrag {
  /** What the pick up says: `pickedUpText(name)`. */
  pickedUp: string;
  /** Each key and the words it is answered with. */
  moves: ReadonlyArray<{ key: string; said: string }>;
  /** What the drop says. */
  dropped: string;
}

/**
 * Picks up what `handle` belongs to, moves it key by key and drops it. Each key waits for the words of the one
 * before: the drop of something whose move has not been measured yet is a put back.
 */
export async function dragByKeyboard(page: Page, handle: Locator, drag: KeyboardDrag): Promise<void> {
  await layoutSettled(page);
  await handle.focus();
  await layoutSettled(page);
  await page.keyboard.press('Space');
  await waitForAnnouncement(page, drag.pickedUp);
  await dragListens(page);
  for (const { key, said } of drag.moves) {
    await page.keyboard.press(key);
    await waitForAnnouncement(page, said);
    await layoutSettled(page);
  }
  await page.keyboard.press('Space');
  await waitForAnnouncement(page, drag.dropped);
}

// -------------------------------------------------------------------------------------------------
// What the mock stored

const FROM_COOKIE: Readonly<Record<string, string>> = { "'": '"', '!': ',', '*': '\\', _: ' ' };

/** What the mock keeps of the layouts of this browser (`mocks/handlers/layouts.ts`): who saved what, per screen. */
export interface StoredLayouts {
  /** `<user id>|<screen>` to the person's layout. */
  personal: Record<string, unknown>;
  /** Screen to the team default. */
  team: Record<string, unknown>;
}

/**
 * The layouts cookie of the page, decoded, or null while nothing was saved. The mock writes JSON in a cookie safe
 * form (`mocks/cookie-json.ts`): four characters stand for the ones a cookie cannot hold.
 */
export async function storedLayouts(page: Page): Promise<StoredLayouts | null> {
  const raw = await page.evaluate((name) => {
    const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`));
    return entry === undefined ? null : entry.slice(name.length + 1);
  }, LAYOUTS_COOKIE);
  if (raw === null || raw === '') return null;
  const value: unknown = JSON.parse(raw.replace(/['!*_]/g, (char) => FROM_COOKIE[char] ?? char));
  if (typeof value !== 'object' || value === null || !('personal' in value) || !('team' in value)) {
    throw new Error('The layouts cookie is not what the mock writes: its format may have changed');
  }
  const { personal, team } = value;
  if (typeof personal !== 'object' || personal === null || typeof team !== 'object' || team === null) {
    throw new Error('The layouts cookie has no personal and team rows: its format may have changed');
  }
  return { personal: { ...personal }, team: { ...team } };
}

/** The screens that have a personal layout stored, whoever the person is. */
export const personalScreens = (stored: StoredLayouts | null): string[] =>
  stored === null ? [] : Object.keys(stored.personal).map((key) => key.split('|').at(-1) ?? key);

/**
 * Starts every browser of `context` again from the built-in layouts: the layouts cookie goes from the browser's
 * jar and from the copy the mock worker keeps (`__msw-cookie-store__`, which wins over the jar). Pages that are
 * open need a reload to read the layout again.
 */
export async function expireLayouts(context: BrowserContext): Promise<void> {
  await context.clearCookies({ name: LAYOUTS_COOKIE });
  await Promise.all(
    context
      .pages()
      .filter((page) => page.url().startsWith('http'))
      .map((page) =>
        page.evaluate(
          ([name, storeKey]) => {
            document.cookie = `${name}=; Path=/; Secure; Max-Age=0`;
            const stored: unknown = JSON.parse(localStorage.getItem(storeKey) ?? '[]');
            if (!Array.isArray(stored)) return;
            const kept = stored.filter(
              (cookie: unknown) =>
                typeof cookie !== 'object' || cookie === null || !('key' in cookie) || cookie.key !== name,
            );
            localStorage.setItem(storeKey, JSON.stringify(kept));
          },
          [LAYOUTS_COOKIE, MSW_COOKIE_STORE] as const,
        ),
      ),
  );
}

// -------------------------------------------------------------------------------------------------
// Accessibility

/**
 * No serious or critical accessibility violation on the page (WCAG 2.2 AA rules), once its content is there. The
 * lesser findings are not this spec's to fail on; `expectAccessible` of `support.ts` is the stricter check.
 */
export async function expectNoSeriousViolations(page: Page): Promise<void> {
  await waitForContent(page);
  // A dialog still fading in would be measured at part of its opacity, so contrast is checked once it is in
  await page.evaluate(async () => {
    const ending = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
      );
    await Promise.race([
      Promise.all(ending.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const serious = violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(
    serious.map(
      (violation) =>
        `${violation.id} (${String(violation.impact)}): ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([]);
}
