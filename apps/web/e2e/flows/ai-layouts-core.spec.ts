import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible, signIn } from '../support';

/**
 * The layout core of WP-15 on its live design-system page, in the production build with the API mocked. jsdom has no
 * layout, no pointer geometry, no media queries and no focus order, so the drop line, the pointer, touch and
 * keyboard drags, the snapping grip, the reduced motion setting, the Tab order past the inert card bodies and the
 * page overflow are checked here. The live specimen is the real provider on the mock, signed in as an editor. The
 * page is a route of its own, because the preview sections may not fetch; the layouts section links to it.
 */
const THEME_STORAGE_KEY = 'idraft.theme';
const SECTION = '/design-system/layouts';
const PAGE = '/design-system/layouts-live';
const EDITOR = 'priya@digibranders.test';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const POLITE_REGION = '#live-region-polite';

/** The built-in overview in document order (catalog.ts), as the ids the cards carry in `data-layout-card`. */
const BUILTIN = [
  'trend',
  'rank-distribution',
  'matrix',
  'unclassified',
  'key-changes',
  'opportunities',
  'ai-by-engine',
  'competitors',
] as const;
/** Rank distribution moved by one keyboard drop (ArrowDown): fourth of eight, after "Not classified". */
const RANK_AT_FOURTH = [
  'trend',
  'matrix',
  'unclassified',
  'rank-distribution',
  'key-changes',
  'opportunities',
  'ai-by-engine',
  'competitors',
] as const;
/** Rank distribution dropped on the right half of the SEO and AI matrix card: third of eight. */
const RANK_AT_THIRD = [
  'trend',
  'matrix',
  'rank-distribution',
  'unclassified',
  'key-changes',
  'opportunities',
  'ai-by-engine',
  'competitors',
] as const;
const PICKED_UP = 'Rank distribution picked up. Use the arrow keys to move, Space to drop, Escape to put it back.';
/** The smallest target WCAG 2.2 asks of a pointer (2.5.8). */
const MIN_TARGET = 24;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(target: Locator): Promise<Box> {
  const box = await target.boundingBox();
  if (box === null) throw new Error('The element has no box on the page');
  return box;
}

const live = (page: Page): Locator => page.locator('[data-specimen="live"]');
const gridOf = (page: Page): Locator => live(page).getByRole('region', { name: 'Overview cards', exact: true });
const cardOf = (page: Page, id: string): Locator => gridOf(page).locator(`[data-layout-card="${id}"]`);
const partOf = (page: Page, id: string, part: string): Locator => cardOf(page, id).locator(`[data-part="${part}"]`);
const specimen = (page: Page, name: string): Locator => page.locator(`[data-specimen="${name}"]`);
const dropLine = (page: Page): Locator => live(page).locator('[data-slot="layout-drop-line"]');
const overlay = (page: Page): Locator => live(page).locator('[data-slot="layout-drag-overlay"]');
const button = (page: Page, name: string): Locator => live(page).getByRole('button', { name, exact: true });
const said = (page: Page, text: string): Promise<void> => expect(page.locator(POLITE_REGION)).toHaveText(text);

/** The cards of the live grid, in the order they are drawn. */
async function order(page: Page): Promise<string[]> {
  return gridOf(page)
    .locator('[data-layout-card]')
    .evaluateAll((nodes) => nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.layoutCard ?? '') : '')));
}

async function open(page: Page, theme: Theme, width: number, height = 1100): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.setViewportSize({ width, height });
  await page.goto(PAGE);
  // The page waits for the mock worker; the cards of the layout come once the mock has answered the read
  await expect(gridOf(page).locator('[data-layout-card]')).toHaveCount(BUILTIN.length);
}

async function customize(page: Page): Promise<void> {
  await button(page, 'Customize').click();
  await expect(live(page).getByText(/^Mode: customize\./)).toBeVisible();
  await expect(partOf(page, 'trend', 'handle')).toBeVisible();
}

/** Picks the rank distribution card up by keyboard, moves it to the card below and drops it. */
async function dropRankDistributionBelow(page: Page): Promise<void> {
  const handle = partOf(page, 'rank-distribution', 'handle');
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await said(page, 'Rank distribution dropped at position 4 of 8');
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
}

test.beforeEach(async ({ page }) => {
  await signIn(page, EDITOR);
});

// -------------------------------------------------------------------------------------------------
// The section of the preview

test('the layouts section is static and links to the live page', async ({ page }) => {
  await page.goto(SECTION);
  await expect(page.getByRole('heading', { level: 1, name: 'Layouts', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Open the live layout specimens', exact: true });
  await expect(link).toHaveAttribute('href', PAGE);
  await expectAccessible(page);
  await link.click();
  await page.waitForURL(`**${PAGE}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Layouts, live', exact: true })).toBeVisible();
});

// -------------------------------------------------------------------------------------------------
// Accessibility and overflow

for (const theme of THEMES) {
  test.describe(`the layouts page in the ${theme} theme`, () => {
    for (const width of WIDTHS) {
      test(`has no accessibility violation and no horizontal scroll at ${String(width)} px, in view mode`, async ({
        page,
      }) => {
        await open(page, theme, width);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
        await expectAccessible(page);
        await expectNoOverflow(page);
      });

      test(`has no accessibility violation and no horizontal scroll at ${String(width)} px, in customize mode`, async ({
        page,
      }) => {
        await open(page, theme, width);
        await customize(page);
        await expectAccessible(page);
        await expectNoOverflow(page);
      });
    }
  });
}

// -------------------------------------------------------------------------------------------------
// The page and its specimens

test.describe('the specimens at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('titles every group with a level 2 heading', async ({ page }) => {
    for (const title of [
      'Live layout on the mock API',
      'Layout states',
      'A picked up card',
      'Drawer form, one column',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    }
  });

  test('every percent has its count beside it, and an unknown rate is n/a, never 0', async ({ page }) => {
    const list = cardOf(page, 'key-changes');
    await list.scrollIntoViewIfNeeded();
    await expect(list.getByText('Best CRM for startups', { exact: true })).toBeVisible();
    await expect(list.getByText('70.0%', { exact: true })).toBeVisible();
    await expect(list).toContainText('21 of 30 answers');
    await expect(list.getByText('n/a', { exact: true })).toBeVisible();
    await expect(list.getByText('No answers yet', { exact: true })).toBeVisible();
    await expect(list.locator('li')).toHaveCount(5);
    await expect(list).not.toContainText(/(?<![\d.])0(\.0)?%/);
  });

  test('loading keeps the title of each card in a named status', async ({ page }) => {
    const frame = specimen(page, 'loading');
    await frame.scrollIntoViewIfNeeded();
    const status = frame.getByRole('status', { name: 'Loading Overview cards' });
    await expect(status).toBeVisible();
    for (const title of ['Rank distribution', 'Top movers', 'SERP features']) {
      await expect(status.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    }
  });

  test('a failed read keeps the built-in layout under a banner with Retry', async ({ page }) => {
    const frame = specimen(page, 'failed');
    await frame.scrollIntoViewIfNeeded();
    await expect(
      frame.getByText('Your layout could not be loaded. Showing the default.', { exact: true }),
    ).toBeVisible();
    await expect(frame.locator('[data-layout-card]')).toHaveCount(BUILTIN.length);
    await frame.getByRole('button', { name: 'Retry', exact: true }).click();
    // The workspace is one the mock does not know, so the read fails again and the banner stays
    await expect(
      frame.getByText('Your layout could not be loaded. Showing the default.', { exact: true }),
    ).toBeVisible();
  });

  test('refetching keeps the cards and draws the bar', async ({ page }) => {
    const frame = specimen(page, 'refetching');
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.locator('[data-slot="layout-refetch-bar"]')).toBeVisible();
    await expect(frame.locator('[data-layout-card]')).toHaveCount(3);
    const bar = await frame.locator('[data-slot="layout-refetch-bar"]').boundingBox();
    expect(bar?.height).toBe(2);
  });

  test('an empty page says so and offers Customize; the unavailable one counts its cards', async ({ page }) => {
    const empty = specimen(page, 'empty');
    await empty.scrollIntoViewIfNeeded();
    await expect(empty.getByRole('heading', { level: 2, name: 'No cards are shown on this page.' })).toBeVisible();
    await expect(empty.getByText('This page has no cards. Add one from the catalog.', { exact: true })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Customize', exact: true })).toBeVisible();
    const unavailable = specimen(page, 'empty-unavailable');
    await expect(
      unavailable.getByText('2 cards of this layout are not available in this project.', { exact: true }),
    ).toBeVisible();
    await expect(unavailable.locator('[data-layout-card]')).toHaveCount(0);
  });

  test('a picked up card has a ring and the dragged one is half strength', async ({ page }) => {
    const frames = specimen(page, 'picked').locator('[data-layout-card]');
    await expect(frames).toHaveCount(2);
    await expect(frames.nth(0)).toHaveClass(/ring-primary/);
    await expect(frames.nth(1)).toHaveClass(/opacity-50/);
    await expect(frames.nth(0).getByRole('button', { name: 'Reorder Rank distribution' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const opacity = await frames.nth(1).evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(opacity)).toBeCloseTo(0.5, 2);
  });

  test('the drawer form is one column of the inspector width', async ({ page }) => {
    const frames = specimen(page, 'drawer').locator('[data-layout-card]');
    await frames.first().scrollIntoViewIfNeeded();
    await expect(frames).toHaveCount(4);
    const boxes = await frames.evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width } = node.getBoundingClientRect();
        return { x, y, width };
      }),
    );
    expect(new Set(boxes.map((box) => box.x)).size).toBe(1);
    expect(new Set(boxes.map((box) => box.width)).size).toBe(1);
    expect(boxes[0]?.width ?? 0).toBeLessThanOrEqual(400);
    const tops = boxes.map((box) => box.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(4);
  });
});

// -------------------------------------------------------------------------------------------------
// The switches of the live specimen

test.describe('the live specimen at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('the AI channel switch takes the AI cards off the page, and customizing explains them', async ({ page }) => {
    await expect(partOf(page, 'ai-by-engine', 'handle')).toHaveCount(0);
    await live(page).getByRole('switch').click();
    // Matrix, Not classified, Opportunities and AI by engine need the AI channel
    await expect(gridOf(page).locator('[data-layout-card]')).toHaveCount(4);
    await expect(cardOf(page, 'ai-by-engine')).toHaveCount(0);
    await customize(page);
    await expect(gridOf(page).locator('[data-layout-card]')).toHaveCount(BUILTIN.length);
    await expect(cardOf(page, 'ai-by-engine').locator('[inert]')).toHaveCount(1);
    await expect(partOf(page, 'ai-by-engine', 'handle')).toBeVisible();
  });

  test('Add card puts Top movers on the page once, and the polite region says where', async ({ page }) => {
    await customize(page);
    const slot = gridOf(page).locator('[data-add-card-slot]');
    await expect(slot).toBeVisible();
    await slot.click();
    await said(page, 'Top movers added, position 9 of 9');
    await expect(gridOf(page).locator('[data-layout-card]')).toHaveCount(BUILTIN.length + 1);
    await expect(live(page).getByText('Changes: 1', { exact: true })).toBeVisible();
    await expect(partOf(page, 'trend', 'handle')).toBeVisible();
    // A second Top movers would repeat the card: the catalog allows one
    await gridOf(page).locator('[data-add-card-slot]').click();
    await expect(gridOf(page).locator('[data-layout-card]')).toHaveCount(BUILTIN.length + 1);
  });

  test('Cancel drops the draft and Undo and Redo walk the changes', async ({ page }) => {
    await customize(page);
    await dropRankDistributionBelow(page);
    expect(await order(page)).toEqual([...RANK_AT_FOURTH]);
    await expect(live(page).getByText('Changes: 1', { exact: true })).toBeVisible();
    await button(page, 'Undo').click();
    await said(page, 'Change undone');
    expect(await order(page)).toEqual([...BUILTIN]);
    await expect(live(page).getByText('Changes: 0', { exact: true })).toBeVisible();
    await button(page, 'Redo').click();
    await said(page, 'Change redone');
    expect(await order(page)).toEqual([...RANK_AT_FOURTH]);
    await button(page, 'Cancel').click();
    await expect(live(page).getByText(/^Mode: view\./)).toBeVisible();
    expect(await order(page)).toEqual([...BUILTIN]);
  });

  test('saves to the mock, and a reload keeps the order', async ({ page }) => {
    await customize(page);
    await dropRankDistributionBelow(page);
    await button(page, 'Save').click();
    await expect(
      live(page).getByText('Mode: view. Layout from: personal. Last save: saved.', { exact: true }),
    ).toBeVisible();
    await said(page, 'Layout saved');
    expect(await order(page)).toEqual([...RANK_AT_FOURTH]);
    await page.reload();
    await expect(gridOf(page).locator('[data-layout-card]')).toHaveCount(BUILTIN.length);
    expect(await order(page)).toEqual([...RANK_AT_FOURTH]);
    await expect(live(page).getByText(/^Mode: view\. Layout from: personal\./)).toBeVisible();
  });

  test('every control in the toolbar of a card is at least 24 px', async ({ page }) => {
    await customize(page);
    const parts = gridOf(page).locator('[data-layout-card] [data-part]:not([data-part="resize"])');
    // Handle, Width, Options and Hide on every card, More on every card
    expect(await parts.count()).toBeGreaterThanOrEqual(BUILTIN.length * 3);
    const sizes = await parts.evaluateAll((nodes) =>
      nodes.map((node) => {
        const { width, height } = node.getBoundingClientRect();
        return { width, height, part: node instanceof HTMLElement ? (node.dataset.part ?? '') : '' };
      }),
    );
    for (const size of sizes) {
      expect(size.width, `${size.part} width`).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(size.height, `${size.part} height`).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// Keyboard

test.describe('moving a card by keyboard', () => {
  // At 1280 px the rows are 2 + 2 + 2 + 2 cards; at 768 px the trend card takes a row, so the next row down is the third
  for (const { width, row } of [
    { width: 1280, row: 2 },
    { width: 768, row: 3 },
  ]) {
    test(`picks up, moves with ArrowDown and drops, with the polite region read at each step, at ${String(width)} px`, async ({
      page,
    }) => {
      await open(page, 'light', width);
      await customize(page);
      const handle = partOf(page, 'rank-distribution', 'handle');
      await expect(handle).toHaveAccessibleName('Reorder Rank distribution');
      await handle.focus();
      await expect(handle).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('Space');
      await said(page, PICKED_UP);
      await expect(handle).toHaveAttribute('aria-pressed', 'true');
      await expect(cardOf(page, 'rank-distribution')).toHaveClass(/ring-primary/);
      await page.keyboard.press('ArrowDown');
      await said(page, `Rank distribution, position 4 of 8, row ${String(row)}`);
      // Nothing shifts while a card is held: the order is the old one until the drop
      expect(await order(page)).toEqual([...BUILTIN]);
      await page.keyboard.press('Space');
      await said(page, 'Rank distribution dropped at position 4 of 8');
      expect(await order(page)).toEqual([...RANK_AT_FOURTH]);
      await expect(partOf(page, 'rank-distribution', 'handle')).toBeFocused();
      await expect(handle).toHaveAttribute('aria-pressed', 'false');
      // dnd-kit's own regions stay empty: every word went through the one polite region
      const regions = await page
        .locator('[id^="DndLiveRegion"]')
        .evaluateAll((nodes) => nodes.map((node) => node.textContent));
      expect(regions.every((text) => text === '')).toBe(true);
    });
  }

  test('Escape puts the card back and leaves the layout as it was', async ({ page }) => {
    await open(page, 'light', 1280);
    await customize(page);
    const handle = partOf(page, 'rank-distribution', 'handle');
    await handle.focus();
    await page.keyboard.press('Space');
    await said(page, PICKED_UP);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await said(page, 'Rank distribution put back');
    expect(await order(page)).toEqual([...BUILTIN]);
    await expect(live(page).getByText('Changes: 0', { exact: true })).toBeVisible();
    await expect(handle).toHaveAttribute('aria-pressed', 'false');
    await expect(handle).toBeFocused();
    // The page is still in customize mode: the Escape was the drag's
    await expect(live(page).getByText(/^Mode: customize\./)).toBeVisible();
  });

  test('the first card says it is already first', async ({ page }) => {
    await open(page, 'light', 1280);
    await customize(page);
    await partOf(page, 'trend', 'handle').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await said(page, 'Visibility and mention rate is already first');
    await page.keyboard.press('Escape');
    await said(page, 'Visibility and mention rate put back');
  });

  test('the Tab walk in customize mode never lands in a card body', async ({ page }) => {
    await open(page, 'light', 1280);
    await customize(page);
    await button(page, 'Cancel').focus();
    const stops: { inert: boolean; inCard: boolean; part: string | null; inLive: boolean }[] = [];
    let visitedCards = false;
    for (let press = 0; press < 160; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return { inert: false, inCard: false, part: null, inLive: false };
        return {
          inert: active.closest('[inert]') !== null,
          inCard: active.closest('[data-layout-card]') !== null,
          part: active.closest<HTMLElement>('[data-part]')?.dataset.part ?? null,
          inLive: active.closest('[data-specimen="live"]') !== null,
        };
      });
      stops.push(stop);
      visitedCards ||= stop.inCard;
      if (visitedCards && !stop.inLive) break;
    }
    expect(visitedCards).toBe(true);
    for (const stop of stops) {
      expect(stop.inert).toBe(false);
      // Inside a card only the toolbar takes focus: the controls carry data-part
      if (stop.inCard) expect(stop.part).not.toBeNull();
    }
    const parts = new Set(stops.flatMap((stop) => (stop.part === null ? [] : [stop.part])));
    expect(parts).toContain('handle');
    expect(parts).toContain('width');
    // The grip is for the pointer: it is never a tab stop
    expect(parts).not.toContain('resize');
    // The walk left the live specimen: it was not stuck in it
    expect(stops.at(-1)?.inLive).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// Pointer

test.describe('moving a card with the mouse at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
    await customize(page);
  });

  test('a drag to the right half of another card shows the drop line there and reorders', async ({ page }) => {
    const handle = await boxOf(partOf(page, 'rank-distribution', 'handle'));
    const target = await boxOf(cardOf(page, 'matrix'));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 14 });
    await expect(overlay(page)).toBeVisible();
    await expect(cardOf(page, 'rank-distribution')).toHaveClass(/opacity-50/);
    const line = dropLine(page);
    await expect(line).toBeVisible();
    // Midway in the 16 px gap, past the right edge of the card it is over, as tall as that card
    const lineBox = await boxOf(line);
    expect(lineBox.x + lineBox.width / 2).toBeCloseTo(target.x + target.width + 8, 0);
    expect(lineBox.width).toBe(2);
    expect(lineBox.height).toBeCloseTo(target.height, 0);
    const shadow = await overlay(page).evaluate((node) => getComputedStyle(node.firstElementChild ?? node).boxShadow);
    expect(shadow).not.toBe('none');
    await page.mouse.up();
    await expect(overlay(page)).toHaveCount(0);
    await expect(dropLine(page)).toHaveCount(0);
    await said(page, 'Rank distribution dropped at position 3 of 8');
    expect(await order(page)).toEqual([...RANK_AT_THIRD]);
  });

  test('a release on the same place moves nothing and says put back', async ({ page }) => {
    const handle = await boxOf(partOf(page, 'rank-distribution', 'handle'));
    const own = await boxOf(cardOf(page, 'rank-distribution'));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(own.x + own.width * 0.5, own.y + own.height * 0.5, { steps: 8 });
    await expect(overlay(page)).toBeVisible();
    await page.mouse.up();
    await said(page, 'Rank distribution put back');
    expect(await order(page)).toEqual([...BUILTIN]);
    await expect(live(page).getByText('Changes: 0', { exact: true })).toBeVisible();
  });

  test('a move of 3 px starts no drag', async ({ page }) => {
    const handle = await boxOf(partOf(page, 'rank-distribution', 'handle'));
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y);
    await expect(overlay(page)).toHaveCount(0);
    await page.mouse.move(x + 8, y);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order(page)).toEqual([...BUILTIN]);
  });
});

test.describe('moving a card by touch at 768 px', () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 768);
    await customize(page);
  });

  /** One finger through the browser's own touch events, which is what a phone sends. */
  async function finger(page: Page): Promise<{
    down: (x: number, y: number) => Promise<void>;
    move: (x: number, y: number) => Promise<void>;
    up: () => Promise<void>;
  }> {
    const client = await page.context().newCDPSession(page);
    const send = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number }[],
    ): Promise<void> => {
      await client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    };
    return {
      down: (x, y) => send('touchStart', [{ x, y }]),
      move: (x, y) => send('touchMove', [{ x, y }]),
      up: () => send('touchEnd', []),
    };
  }

  test('a hold of 300 ms then a move drags the card, and the drop reorders', async ({ page }) => {
    const handle = await boxOf(partOf(page, 'rank-distribution', 'handle'));
    const target = await boxOf(cardOf(page, 'matrix'));
    const touch = await finger(page);
    const startX = handle.x + handle.width / 2;
    const startY = handle.y + handle.height / 2;
    await touch.down(startX, startY);
    await page.waitForTimeout(300);
    const endX = target.x + target.width * 0.75;
    const endY = target.y + target.height / 2;
    for (let step = 1; step <= 12; step += 1) {
      await touch.move(startX + ((endX - startX) * step) / 12, startY + ((endY - startY) * step) / 12);
    }
    await expect(overlay(page)).toBeVisible();
    await expect(dropLine(page)).toBeVisible();
    await touch.up();
    await expect(overlay(page)).toHaveCount(0);
    await said(page, 'Rank distribution dropped at position 3 of 8');
    expect(await order(page)).toEqual([...RANK_AT_THIRD]);
  });

  test('a move before the hold ends is a scroll, not a drag', async ({ page }) => {
    const handle = await boxOf(partOf(page, 'rank-distribution', 'handle'));
    const touch = await finger(page);
    const startX = handle.x + handle.width / 2;
    const startY = handle.y + handle.height / 2;
    await touch.down(startX, startY);
    await touch.move(startX + 4, startY + 30);
    await touch.move(startX + 8, startY + 90);
    await page.waitForTimeout(300);
    await expect(overlay(page)).toHaveCount(0);
    await touch.up();
    expect(await order(page)).toEqual([...BUILTIN]);
  });
});

// -------------------------------------------------------------------------------------------------
// The snapping grip

test.describe('the resize grip at 1280 px', () => {
  test('a drag from half to two thirds snaps, previews its name and says the new width', async ({ page }) => {
    await open(page, 'light', 1280);
    await customize(page);
    const frame = cardOf(page, 'ai-by-engine');
    await frame.scrollIntoViewIfNeeded();
    const grip = frame.locator('[data-part="resize"]');
    await expect(grip).toHaveAttribute('aria-hidden', 'true');
    const grid = await gridOf(page)
      .locator('xpath=.//div[contains(@class,"grid-cols-12")]')
      .evaluate((node) => {
        const { width } = node.getBoundingClientRect();
        return { width, gap: Number.parseFloat(getComputedStyle(node).columnGap) };
      });
    const column = (grid.width - 11 * grid.gap) / 12;
    const half = await boxOf(frame);
    expect(half.width).toBeCloseTo(6 * column + 5 * grid.gap, 0);
    const gripBox = await boxOf(grip);
    const startX = gripBox.x + gripBox.width / 2;
    const y = half.y + half.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    // Two columns wider: eight columns, the width of two thirds
    await page.mouse.move(startX + 2 * (column + grid.gap), y, { steps: 10 });
    const preview = frame.locator('[data-slot="layout-resize-preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Two thirds');
    const previewBox = await boxOf(preview);
    expect(previewBox.width).toBeCloseTo(8 * column + 7 * grid.gap, 0);
    await page.mouse.up();
    await said(page, 'AI by engine width: Two thirds');
    await expect(preview).toHaveCount(0);
    const wide = await boxOf(frame);
    expect(wide.width).toBeCloseTo(8 * column + 7 * grid.gap, 0);
    await expect(live(page).getByText('Changes: 1', { exact: true })).toBeVisible();
  });

  test('Escape during a drag leaves the width as it was', async ({ page }) => {
    await open(page, 'light', 1280);
    await customize(page);
    const frame = cardOf(page, 'ai-by-engine');
    await frame.scrollIntoViewIfNeeded();
    const before = await boxOf(frame);
    const gripBox = await boxOf(frame.locator('[data-part="resize"]'));
    const startX = gripBox.x + gripBox.width / 2;
    const y = before.y + before.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 160, y, { steps: 8 });
    await expect(frame.locator('[data-slot="layout-resize-preview"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(frame.locator('[data-slot="layout-resize-preview"]')).toHaveCount(0);
    await page.mouse.up();
    const after = await boxOf(frame);
    expect(after.width).toBeCloseTo(before.width, 0);
    await expect(live(page).getByText('Changes: 0', { exact: true })).toBeVisible();
  });

  test('a card whose widths look alike at 768 px has no grip', async ({ page }) => {
    await open(page, 'light', 768);
    await customize(page);
    // Rank distribution takes 6 columns at either width from 768 px
    await expect(cardOf(page, 'rank-distribution').locator('[data-part="resize"]')).toHaveCount(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Reduced motion

test.describe('the reduced motion setting', () => {
  /** Counts the drop animations dnd-kit starts: it animates the node that holds the copy of the card. */
  async function countDropAnimations(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const animate = Element.prototype.animate;
      Reflect.set(window, 'dropAnimations', 0);
      Element.prototype.animate = function (keyframes, options) {
        if (this.querySelector('[data-slot="layout-drag-overlay"]') !== null) {
          Reflect.set(window, 'dropAnimations', Number(Reflect.get(window, 'dropAnimations')) + 1);
        }
        return animate.call(this, keyframes, options);
      };
    });
  }
  const dropAnimations = (page: Page): Promise<number> =>
    page.evaluate(() => Number(Reflect.get(window, 'dropAnimations')));

  /** Picks the card up by keyboard and returns the transition of the copy that follows it, as the page computes it. */
  async function holdRankDistribution(page: Page): Promise<string> {
    await customize(page);
    await partOf(page, 'rank-distribution', 'handle').focus();
    await page.keyboard.press('Space');
    await said(page, PICKED_UP);
    await expect(overlay(page)).toBeVisible();
    return overlay(page).evaluate((node) => getComputedStyle(node.parentElement ?? node).transitionDuration);
  }

  test('by default the copy glides and the drop animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await countDropAnimations(page);
    await open(page, 'light', 1280);
    expect(await holdRankDistribution(page)).not.toBe('0s');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await said(page, 'Rank distribution dropped at position 4 of 8');
    await expect.poll(() => dropAnimations(page)).toBeGreaterThan(0);
  });

  test('with reduced motion the copy and the frames have no transition and the drop has no animation', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await countDropAnimations(page);
    await open(page, 'light', 1280);
    expect(await holdRankDistribution(page)).toBe('0s');
    const frames = await gridOf(page)
      .locator('[data-layout-card]')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transitionDuration));
    expect(new Set(frames)).toEqual(new Set(['0s']));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await said(page, 'Rank distribution dropped at position 4 of 8');
    // Longer than the 150 ms of the drop animation: one would have started by now
    await page.waitForTimeout(400);
    expect(await dropAnimations(page)).toBe(0);
    await expect(overlay(page)).toHaveCount(0);
    expect(await order(page)).toEqual([...RANK_AT_FOURTH]);
  });
});
