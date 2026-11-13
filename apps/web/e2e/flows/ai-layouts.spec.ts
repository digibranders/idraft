import { expect, test, type Locator, type Page } from '@playwright/test';

import { signIn } from '../support';
import {
  ADMIN,
  BUILTIN_CARDS,
  BUILTIN_NUMBERS,
  BUILTIN_NUMBER_LABELS,
  DENSITIES,
  EDITOR,
  LAYOUTS_PAGE,
  NEW_CARD_ID,
  NEW_NUMBER_ID,
  THEMES,
  WIDTHS,
  addCardSlot,
  addNumberSlot,
  barButton,
  card,
  cardGrid,
  cardOrder,
  cardPart,
  chooseProject,
  customizeButton,
  customizeSpecimen,
  dragByKeyboard,
  expectCardOrder,
  expectNoSeriousViolations,
  expectNumberLabels,
  expectNumberOrder,
  expireLayouts,
  numberOrder,
  numberStrip,
  openCustomize,
  openLayouts,
  personalScreens,
  pickedUpText,
  reloadLayouts,
  saveBar,
  storedLayouts,
  toastOf,
  waitForAnnouncement,
} from '../support/layouts';

/**
 * The customize UI of WP-16 on its live design-system page, in the production build with the API mocked: the group
 * "Customize mode, live" of /design-system/layouts-live is the real CustomizableScreen on the mock API, which keeps
 * the saved layouts in the `mock-layouts` cookie. Every test gets a browser context of its own, so none sees the
 * layouts another saved. jsdom has no layout, no focus order, no history and no media queries, so the saved layout
 * across a reload, the project select, the leave guard, the phone, the reduced motion setting, the Tab order and the
 * page's accessibility are checked here. The team default, a second member, the 412 and the failures are part 2.
 */
test.describe.configure({ timeout: 90_000 });

const PAGE_URL = new RegExp(`${LAYOUTS_PAGE}$`);

/** The built-in cards without Competitors, which most tests hide. */
const WITHOUT_COMPETITORS = BUILTIN_CARDS.filter((id) => id !== 'competitors');
/** The numbers after Top 10 is moved one place on. */
const TOP_10_THIRD = ['visibility', 'aio-citation', 'top10', 'mention-chatgpt', 'mention-gemini', 'mention-ai-mode'];
/** Competitors hidden and Key changes moved to the start, as the project select and phone tests save it. */
const KEY_CHANGES_FIRST = [
  'key-changes',
  'trend',
  'rank-distribution',
  'matrix',
  'unclassified',
  'opportunities',
  'ai-by-engine',
];

const hideButton = (page: Page, name: string): Locator =>
  customizeSpecimen(page).getByRole('button', { name: `Hide ${name}`, exact: true });
const discardDialog = (page: Page): Locator =>
  page.getByRole('alertdialog', { name: 'Discard unsaved changes?', exact: true });
const catalogDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Add card', exact: true });
const numberHandle = (page: Page, name: string): Locator =>
  numberStrip(page).getByRole('button', { name: `Reorder ${name}`, exact: true });

/** Hides Competitors, the last card of the built-in layout: one change, and a toast with Undo. */
async function hideCompetitors(page: Page): Promise<void> {
  await hideButton(page, 'Competitors').click();
  await waitForAnnouncement(page, 'Competitors hidden. Add it back from the catalog.');
  await expectCardOrder(page, WITHOUT_COMPETITORS);
}

/** Moves Key changes to the start through its More menu. */
async function moveKeyChangesFirst(page: Page): Promise<void> {
  await cardPart(page, 'key-changes', 'more').click();
  await page.getByRole('menuitem', { name: 'Move to start', exact: true }).click();
  await waitForAnnouncement(page, 'Key changes, position 1 of 7');
}

/** Moves Top 10 one place on, with the keyboard. */
async function moveTop10Right(page: Page): Promise<void> {
  await dragByKeyboard(page, numberHandle(page, 'Top 10'), {
    pickedUp: pickedUpText('Top 10'),
    moves: [{ key: 'ArrowRight', said: 'Top 10, position 3 of 6' }],
    dropped: 'Top 10 dropped at position 3 of 6',
  });
}

/** Adds Top movers from the catalog, at the end of the page. */
async function addTopMovers(page: Page, position: string): Promise<void> {
  await addCardSlot(page).click();
  await catalogDialog(page).getByRole('button', { name: 'Add Top movers', exact: true }).click();
  await waitForAnnouncement(page, `Top movers added, position ${position}`);
}

/** Saves the draft and waits until the mode has ended. */
async function save(page: Page): Promise<void> {
  await barButton(page, 'Save layout').click();
  await waitForAnnouncement(page, 'Layout saved');
  await expect(saveBar(page)).toHaveCount(0);
}

// -------------------------------------------------------------------------------------------------
// Saving, projects and reset

test.describe('a saved layout', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('a saved layout persists across a reload', async ({ page, context }) => {
    await openLayouts(page);
    await openCustomize(page);
    await hideCompetitors(page);
    await addTopMovers(page, '8 of 8');
    await moveTop10Right(page);
    await expect(saveBar(page).getByText(/^\d+ changes$/)).toBeVisible();
    await save(page);

    const savedOrder = await cardOrder(page);
    expect(savedOrder.slice(0, 7)).toEqual(WITHOUT_COMPETITORS);
    expect(savedOrder[7]).toMatch(NEW_CARD_ID);
    const savedNumbers = ['SEO visibility', 'AIO citation rate', 'Top 10', ...BUILTIN_NUMBER_LABELS.slice(3)];
    await expectNumberLabels(page, savedNumbers);

    await reloadLayouts(page, 'Fynix', 8);
    await expectCardOrder(page, savedOrder);
    await expectNumberLabels(page, savedNumbers);
    // The new card is Top movers, not only a card with an id
    await expect(card(page, savedOrder[7] ?? '')).toContainText('Top movers');

    // What the reload showed came from what the mock stored: with that gone, the built-in layout is back
    await expireLayouts(context);
    await reloadLayouts(page);
    await expectCardOrder(page, BUILTIN_CARDS);
    await expectNumberLabels(page, BUILTIN_NUMBER_LABELS);
  });

  test('a layout follows the person into another project', async ({ page }) => {
    await openLayouts(page, { project: 'Fynix' });
    await openCustomize(page);
    await hideCompetitors(page);
    await moveKeyChangesFirst(page);
    await save(page);
    await expectCardOrder(page, KEY_CHANGES_FIRST);

    // Cleanstart tracks no AI engine: the four AI cards are skipped, and the rest keep the saved order
    await chooseProject(page, 'Cleanstart', 3);
    await expectCardOrder(page, ['key-changes', 'trend', 'rank-distribution']);

    await chooseProject(page, 'Fynix', 7);
    await expectCardOrder(page, KEY_CHANGES_FIRST);
  });

  test('Reset to default returns to the default and Save stores no personal layout', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await hideCompetitors(page);
    await save(page);
    expect(personalScreens(await storedLayouts(page))).toEqual(['overview']);

    await reloadLayouts(page, 'Fynix', 7);
    await openCustomize(page);
    // The draft is the saved layout: nothing to save, until it is changed
    await expect(saveBar(page).getByText('No changes', { exact: true })).toBeVisible();
    await expect(barButton(page, 'Save layout')).toBeDisabled();
    await barButton(page, 'Reset to default').click();
    await waitForAnnouncement(page, 'Layout reset to the default. Save to keep it.');
    await expectCardOrder(page, BUILTIN_CARDS);
    await expect(saveBar(page).getByText('1 change', { exact: true })).toBeVisible();
    // The draft is the default: there is nothing to reset to
    await expect(barButton(page, 'Reset to default')).toBeDisabled();
    await save(page);

    // The person follows the default again: no personal row is left, and a reload opens the built-in layout
    expect(personalScreens(await storedLayouts(page))).toEqual([]);
    await reloadLayouts(page);
    await expectCardOrder(page, BUILTIN_CARDS);
    await openCustomize(page);
    await expect(saveBar(page).getByText('No changes', { exact: true })).toBeVisible();
    await expect(barButton(page, 'Reset to default')).toBeDisabled();
  });
});

// -------------------------------------------------------------------------------------------------
// Leaving customize mode

test.describe('leaving customize mode', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('Cancel with changes asks; Keep editing keeps the address; Discard drops the draft', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await hideCompetitors(page);

    await barButton(page, 'Cancel').click();
    await expect(discardDialog(page)).toBeVisible();
    await expect(discardDialog(page)).toContainText('Your layout changes will be lost.');
    await discardDialog(page).getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(discardDialog(page)).toBeHidden();
    await expect(page).toHaveURL(PAGE_URL);
    await expect(saveBar(page)).toBeVisible();
    await expectCardOrder(page, WITHOUT_COMPETITORS);
    // The work is in the first card, so that is where focus is
    await expect(cardPart(page, 'trend', 'handle')).toBeFocused();

    await barButton(page, 'Cancel').click();
    await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(discardDialog(page)).toBeHidden();
    await expect(saveBar(page)).toHaveCount(0);
    await expect(page).toHaveURL(PAGE_URL);
    await expectCardOrder(page, BUILTIN_CARDS);
    await expect(customizeButton(page)).toBeFocused();
  });

  test('Cancel without changes leaves at once, with no question', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await barButton(page, 'Cancel').click();
    await expect(saveBar(page)).toHaveCount(0);
    await expect(discardDialog(page)).toHaveCount(0);
    await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('Back with changes asks and the address stays', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await hideCompetitors(page);

    await page.evaluate(() => {
      window.history.back();
    });
    await expect(discardDialog(page)).toBeVisible();
    await expect(page).toHaveURL(PAGE_URL);
    await discardDialog(page).getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(discardDialog(page)).toBeHidden();
    await expect(page).toHaveURL(PAGE_URL);
    await expect(saveBar(page)).toBeVisible();
    await expectCardOrder(page, WITHOUT_COMPETITORS);

    // A second Back asks again, and Discard then goes where Back went
    await page.evaluate(() => {
      window.history.back();
    });
    await discardDialog(page).getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page).not.toHaveURL(PAGE_URL);
  });

  test('Escape leaves customize mode and focus returns to Customize', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await cardPart(page, 'rank-distribution', 'handle').focus();
    await page.keyboard.press('Escape');
    await expect(saveBar(page)).toHaveCount(0);
    await expect(discardDialog(page)).toHaveCount(0);
    await expect(cardPart(page, 'rank-distribution', 'handle')).toHaveCount(0);
    await expect(customizeButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(customizeButton(page)).toBeFocused();
  });

  test('Escape with changes asks first, and a second Escape keeps editing', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await hideCompetitors(page);
    await cardPart(page, 'trend', 'handle').focus();
    await page.keyboard.press('Escape');
    await expect(discardDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(discardDialog(page)).toBeHidden();
    await expect(saveBar(page)).toBeVisible();
    await expectCardOrder(page, WITHOUT_COMPETITORS);
  });

  test('narrowing the window below 768 px ends customize mode when there are no changes', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await page.setViewportSize({ width: 700, height: 1100 });
    await expect(saveBar(page)).toHaveCount(0);
    await expect(customizeButton(page)).toHaveCount(0);
    await expect(cardPart(page, 'trend', 'handle')).toHaveCount(0);
  });

  test('narrowing the window below 768 px keeps customize mode while there are changes', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await hideCompetitors(page);
    await page.setViewportSize({ width: 700, height: 1100 });
    await expect(saveBar(page)).toBeVisible();
    await expect(cardPart(page, 'trend', 'handle')).toBeVisible();
    await expectCardOrder(page, WITHOUT_COMPETITORS);
  });
});

// -------------------------------------------------------------------------------------------------
// Editing

test.describe('editing the draft', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('Undo and Redo by keys and by buttons; Hide toast Undo', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);

    // The toast of a hide has its own Undo, which brings that card back and focus to it
    await hideCompetitors(page);
    await expect(saveBar(page).getByText('1 change', { exact: true })).toBeVisible();
    await toastOf(page, 'Competitors hidden').getByRole('button', { name: 'Undo', exact: true }).click();
    await waitForAnnouncement(page, 'Change undone');
    await expectCardOrder(page, BUILTIN_CARDS);
    await expect(saveBar(page).getByText('No changes', { exact: true })).toBeVisible();
    await expect(toastOf(page, 'Competitors hidden')).toHaveCount(0);
    await expect(cardPart(page, 'competitors', 'handle')).toBeFocused();

    // The buttons of the bar, and the toast goes with the next edit
    await hideCompetitors(page);
    await expect(toastOf(page, 'Competitors hidden')).toBeVisible();
    await barButton(page, 'Undo').click();
    await waitForAnnouncement(page, 'Change undone');
    await expectCardOrder(page, BUILTIN_CARDS);
    await expect(toastOf(page, 'Competitors hidden')).toHaveCount(0);
    await barButton(page, 'Redo').click();
    await waitForAnnouncement(page, 'Change redone');
    await expectCardOrder(page, WITHOUT_COMPETITORS);

    // The keys do the same from inside the screen
    await cardPart(page, 'trend', 'handle').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await waitForAnnouncement(page, 'Change undone');
    await expectCardOrder(page, BUILTIN_CARDS);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await waitForAnnouncement(page, 'Change redone');
    await expectCardOrder(page, WITHOUT_COMPETITORS);
  });

  test('the catalog: search, No cards match, Add another, Added, New badge', async ({ page }) => {
    // A card is New for 30 days from its release (2026-09-30): the clock is held on the 29th day, then on the 30th
    await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));
    await openLayouts(page);
    await openCustomize(page);
    const catalog = catalogDialog(page);
    const row = (title: string): Locator => catalog.locator('li').filter({ hasText: title });
    const search = catalog.getByRole('searchbox', { name: 'Search cards', exact: true });

    await addCardSlot(page).click();
    await expect(catalog).toBeVisible();
    await expect(catalog.getByRole('heading', { level: 3 })).toHaveText(['SEO', 'AI', 'Cross-channel', 'Activity']);
    await expect(row('Top movers').getByText('New', { exact: true })).toBeVisible();
    await expect(row('Rank distribution').getByText('New', { exact: true })).toHaveCount(0);
    // A type that is on the page and takes no more is Added, and does nothing
    await expect(row('Rank distribution').getByRole('button')).toHaveText('Added');
    await expect(row('Rank distribution').getByRole('button')).toBeDisabled();

    await search.fill('zzz');
    await expect(catalog.getByText('No cards match “zzz”', { exact: true })).toBeVisible();
    await expect(catalog.locator('li')).toHaveCount(0);
    await waitForAnnouncement(page, 'No cards match “zzz”');

    await search.fill('mention rate');
    await expect(catalog.locator('li')).toHaveCount(2);
    await waitForAnnouncement(page, '2 cards match');
    await row('Mention rate trend').getByRole('button', { name: 'Add Mention rate trend', exact: true }).click();
    await expect(catalog).toBeHidden();
    // A card of a reusable type is named with the choice that tells it from the others
    await waitForAnnouncement(page, 'Mention rate trend: ChatGPT added, position 9 of 9');
    await expect.poll(async () => (await cardOrder(page)).length).toBe(9);
    const order = await cardOrder(page);
    expect(order[8]).toMatch(NEW_CARD_ID);
    // The new card takes focus, as the catalog was closed by adding
    await expect(cardPart(page, order[8] ?? '', 'handle')).toBeFocused();

    // On the 30th day the cards are no longer new, and a type that can be placed again says so
    await page.clock.setFixedTime(new Date('2026-10-30T12:00:00Z'));
    await addCardSlot(page).click();
    await expect(catalog).toBeVisible();
    await expect(row('Top movers')).toBeVisible();
    await expect(catalog.getByText('New', { exact: true })).toHaveCount(0);
    await search.fill('mention rate trend');
    const another = row('Mention rate trend').getByRole('button', {
      name: 'Add another Mention rate trend',
      exact: true,
    });
    await expect(another).toHaveText('Add another');
    await another.click();
    // ChatGPT is on the page, so the copy takes the next engine
    await waitForAnnouncement(page, 'Mention rate trend: Gemini added, position 10 of 10');
    await expect.poll(async () => (await cardOrder(page)).length).toBe(10);
  });

  test('numbers: keyboard reorder, Remove, Add number with an engine, 6 is the most', async ({ page }) => {
    await openLayouts(page);
    await openCustomize(page);
    await expectNumberOrder(page, BUILTIN_NUMBERS);
    // Six numbers are the most a strip shows: the built-in six leave no place to add one
    await expect(addNumberSlot(page)).toHaveCount(0);

    await moveTop10Right(page);
    await expectNumberOrder(page, TOP_10_THIRD);
    await expect(numberHandle(page, 'Top 10')).toBeFocused();

    await numberStrip(page).getByRole('button', { name: 'Remove Mention rate Gemini', exact: true }).click();
    await waitForAnnouncement(page, 'Mention rate Gemini removed');
    await expectNumberLabels(page, [
      'SEO visibility',
      'AIO citation rate',
      'Top 10',
      'Mention rate ChatGPT',
      'Mention rate AI Mode',
    ]);

    // With a place free the slot is there; an AI number is added for one engine, and one that is shown is off
    await addNumberSlot(page).click();
    const popover = page.locator('[data-slot="popover"]');
    await expect(popover).toContainText('1 of 6 places left.');
    await expect(popover.getByRole('button', { name: 'Mention rate ChatGPT', exact: true })).toBeDisabled();
    await popover.getByRole('button', { name: 'Mention rate Gemini', exact: true }).click();
    await waitForAnnouncement(page, 'Mention rate Gemini added');
    await expect(popover).toHaveCount(0);

    await expect.poll(async () => (await numberOrder(page)).length).toBe(6);
    expect((await numberOrder(page))[5]).toMatch(NEW_NUMBER_ID);
    await expectNumberLabels(page, [
      'SEO visibility',
      'AIO citation rate',
      'Top 10',
      'Mention rate ChatGPT',
      'Mention rate AI Mode',
      'Mention rate Gemini',
    ]);
    await expect(numberHandle(page, 'Mention rate Gemini')).toBeFocused();
    // Six again: the slot is gone, so a seventh cannot be asked for
    await expect(addNumberSlot(page)).toHaveCount(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Phones

test.describe('a phone', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('no customize control at 390 px and the saved layout shows full width in order', async ({ page }) => {
    // Saved on a wide window, where customizing is possible
    await openLayouts(page);
    await expect(customizeButton(page)).toBeVisible();
    await openCustomize(page);
    await hideCompetitors(page);
    await moveKeyChangesFirst(page);
    await save(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await reloadLayouts(page, 'Fynix', 7);
    // There is no way into the mode: no button, and the More menu of the table page has nothing to offer
    await expect(customizeButton(page)).toHaveCount(0);
    await expect(
      page.locator('[data-specimen="customize-table"]').getByRole('button', { name: 'More actions', exact: true }),
    ).toHaveCount(0);
    await expect(saveBar(page)).toHaveCount(0);
    await expectCardOrder(page, KEY_CHANGES_FIRST);

    // One column, each card as wide as the grid and below the one before it, in the order saved
    const boxes = await cardGrid(page)
      .locator('[data-layout-card]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width } = node.getBoundingClientRect();
          return { x, y, width };
        }),
      );
    const grid = await cardGrid(page).evaluate((node) => {
      const { x, width } = node.getBoundingClientRect();
      return { x, width };
    });
    for (const box of boxes) {
      expect(box.x).toBeCloseTo(grid.x, 0);
      expect(box.width).toBeCloseTo(grid.width, 0);
    }
    const tops = boxes.map((box) => box.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(KEY_CHANGES_FIRST.length);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  });
});

// -------------------------------------------------------------------------------------------------
// Reduced motion

test.describe('the reduced motion setting', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  interface Scroll {
    zone: 'card' | 'number';
    /** The part of the card or number that took focus (`handle`), for a failure that has to say whose call it was. */
    part: string;
    behavior: string;
  }

  /**
   * Records how the control of a card or a number that takes focus is scrolled into view, then lets the call
   * through. Only the controls (they carry `data-part`): dnd-kit scrolls the card it picks up in its own way.
   */
  async function recordScrolls(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const original = Element.prototype.scrollIntoView;
      const scrolls: Scroll[] = [];
      Reflect.set(window, 'layoutScrolls', scrolls);
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element, arg?: boolean | ScrollIntoViewOptions) {
        if (this instanceof HTMLElement && this.dataset.part !== undefined) {
          scrolls.push({
            zone: this.closest('[data-layout-number]') === null ? 'card' : 'number',
            part: this.dataset.part,
            behavior: typeof arg === 'object' && arg.behavior !== undefined ? arg.behavior : 'auto',
          });
        }
        original.call(this, arg);
      };
    });
  }

  /** A keyboard move of a card, an add from the catalog and a keyboard move of a number: each ends in a focus scroll. */
  async function moveAndAdd(page: Page): Promise<Scroll[]> {
    await openLayouts(page);
    await openCustomize(page);
    await dragByKeyboard(page, cardPart(page, 'rank-distribution', 'handle'), {
      pickedUp: pickedUpText('Rank distribution'),
      moves: [{ key: 'ArrowDown', said: 'Rank distribution, position 4 of 8, row 2' }],
      dropped: 'Rank distribution dropped at position 4 of 8',
    });
    await addTopMovers(page, '9 of 9');
    await moveTop10Right(page);
    return page.evaluate(() => {
      const scrolls: unknown = Reflect.get(window, 'layoutScrolls');
      if (!Array.isArray(scrolls)) throw new Error('The scroll recorder is not on the page');
      return scrolls as Scroll[];
    });
  }

  test('by default a keyboard move and an add scroll smoothly', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await recordScrolls(page);
    const scrolls = await moveAndAdd(page);
    expect(scrolls.filter((scroll) => scroll.zone === 'card').length).toBeGreaterThanOrEqual(2);
    expect(scrolls.filter((scroll) => scroll.zone === 'number').length).toBeGreaterThanOrEqual(1);
    expect(
      scrolls.filter((scroll) => scroll.behavior !== 'smooth'),
      'scrolls that are not smooth',
    ).toEqual([]);
  });

  test('reduced motion: a keyboard move and an add scroll without animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordScrolls(page);
    const scrolls = await moveAndAdd(page);
    expect(scrolls.filter((scroll) => scroll.zone === 'card').length).toBeGreaterThanOrEqual(2);
    expect(scrolls.filter((scroll) => scroll.zone === 'number').length).toBeGreaterThanOrEqual(1);
    expect(
      scrolls.filter((scroll) => scroll.behavior !== 'auto'),
      'scrolls that are animated',
    ).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// Accessibility

test.describe('accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN);
  });

  for (const theme of THEMES) {
    for (const density of DENSITIES) {
      test.describe(`in the ${theme} theme, with ${density} density`, () => {
        for (const width of WIDTHS) {
          if (width < 768) {
            test(`has no serious or critical violation at ${String(width)} px, which has no customize control`, async ({
              page,
            }) => {
              await openLayouts(page, { theme, width, height: 844, density, as: ADMIN });
              await expect(customizeButton(page)).toHaveCount(0);
              await expectNoSeriousViolations(page);
            });
            continue;
          }
          test(`has no serious or critical violation at ${String(width)} px, in customize mode with the save bar, the catalog and the number catalog open`, async ({
            page,
          }) => {
            await openLayouts(page, { theme, width, density, as: ADMIN });
            await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
            await openCustomize(page);
            await expectNoSeriousViolations(page);

            await addCardSlot(page).click();
            await expect(catalogDialog(page)).toBeVisible();
            await expectNoSeriousViolations(page);
            await catalogDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
            await expect(catalogDialog(page)).toBeHidden();

            // The built-in six numbers leave no place to add a seventh: one goes first
            await numberStrip(page).getByRole('button', { name: 'Remove Mention rate Gemini', exact: true }).click();
            await addNumberSlot(page).click();
            await expect(page.locator('[data-slot="popover"]')).toBeVisible();
            await expectNoSeriousViolations(page);
          });
        }
      });
    }
  }
});

// -------------------------------------------------------------------------------------------------
// Keyboard order

test.describe('the Tab walk', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN);
  });

  interface Stop {
    zone: 'number' | 'card' | 'add-card' | 'add-number' | 'save-bar' | 'other';
    name: string;
    inert: boolean;
    /** In a card or a number but outside its row of controls: content that is arranged, not used. */
    stray: boolean;
    /** The control is under the save bar, or below the window altogether. */
    covered: boolean;
  }

  async function stopOf(page: Page): Promise<Stop> {
    return page.evaluate((): Stop => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) {
        return { zone: 'other', name: '', inert: false, stray: false, covered: false };
      }
      const bar = document.querySelector('[data-slot="layout-save-bar"]');
      const zone: Stop['zone'] =
        active.closest('[data-slot="layout-save-bar"]') !== null
          ? 'save-bar'
          : active.closest('[data-layout-number]') !== null
            ? 'number'
            : active.closest('[data-layout-card]') !== null
              ? 'card'
              : active.closest('[data-add-card-slot]') !== null
                ? 'add-card'
                : active.closest('[data-add-number-slot]') !== null
                  ? 'add-number'
                  : 'other';
      const stray =
        (zone === 'card' && active.closest('[data-layout-card] > [role="group"]') === null) ||
        (zone === 'number' && active.closest('[data-layout-number] > [role="group"]') === null);
      // The sticky bar pins itself to the bottom of the window: what has focus must be in the window and not under it
      const box = active.getBoundingClientRect();
      const barBox = bar?.getBoundingClientRect();
      const under = barBox !== undefined && box.bottom > barBox.top + 0.5 && box.top < barBox.bottom - 0.5;
      // What follows the screen is no part of it: the bar does not pin itself there
      const covered = zone !== 'save-bar' && zone !== 'other' && (under || box.bottom > window.innerHeight + 0.5);
      return {
        zone,
        name: active.getAttribute('aria-label') ?? (active.textContent ?? '').replace(/\s+/g, ' ').trim(),
        inert: active.closest('[inert]') !== null,
        stray,
        covered,
      };
    });
  }

  test('the Tab walk in customize mode passes the toolbars, not the card content, then the save bar', async ({
    page,
  }) => {
    // A short window, so the page scrolls and the sticky bar has something to cover
    await openLayouts(page, { height: 700, as: ADMIN });
    await openCustomize(page);
    await customizeButton(page).focus();

    const stops: Stop[] = [];
    let reachedBar = false;
    for (let press = 0; press < 200; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await stopOf(page);
      stops.push(stop);
      reachedBar ||= stop.zone === 'save-bar';
      if (reachedBar && stop.zone !== 'save-bar') break;
    }

    // The toolbars in the order of the page, then the bar, then out of the screen
    const zones = stops.map((stop) => stop.zone).filter((zone, index, all) => zone !== all[index - 1]);
    expect(zones).toEqual(['number', 'card', 'add-card', 'save-bar', 'other']);
    for (const stop of stops) {
      expect(stop.inert, `${stop.zone} ${stop.name} is inert`).toBe(false);
      expect(stop.stray, `${stop.zone} ${stop.name} is not a control of a toolbar`).toBe(false);
      expect(stop.covered, `${stop.zone} ${stop.name} is under the save bar`).toBe(false);
    }
    // Every card brings its handle, Hide and More; the strip brings those of its six numbers
    const names = stops.filter((stop) => stop.zone === 'card').map((stop) => stop.name);
    for (const title of ['Visibility and mention rate', 'Rank distribution', 'Competitors']) {
      expect(
        names.some((name) => name.includes(title)),
        `no control of ${title}`,
      ).toBe(true);
    }
    expect(stops.filter((stop) => stop.zone === 'number').length).toBeGreaterThanOrEqual(BUILTIN_NUMBERS.length * 3);
    // Save layout is off with no changes, so it is not a stop; the team menu is the bar's last
    expect(stops.filter((stop) => stop.zone === 'save-bar').map((stop) => stop.name)).toEqual([
      'Undo',
      'Redo',
      'Start from',
      'Reset to default',
      'Cancel',
      'More save options',
    ]);
  });
});
