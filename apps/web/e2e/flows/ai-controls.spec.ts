import { expect, test, type Locator, type Page } from '@playwright/test';

import { MARKER } from '../../src/components/app/cells/xss-fixtures';
import { expectAccessible } from '../support';

/**
 * The mobile list rows and the saved view menu of WP-10 on their design-system page, in the production build.
 * jsdom has no layout, no media queries and no focus order, so the row height, the switch between the list and
 * the table, the truncation, the window of a long list, the place of the menu and the keyboard path are checked
 * here. The date range picker has its own groups on the same page; its flow is added to this file with it.
 */
const THEME_STORAGE_KEY = 'idraft.theme';
const PAGE = '/design-system/controls';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

// The groups of the page and what they are given (controls-section.tsx)
const FRAMES_GROUP = 'Mobile list rows at 320, 390 and 768 px';
const LIVE_GROUP = 'Live list or table';
const STATES_GROUP = 'List states';
const LONG_GROUP = 'Long lists and server paging';
const HOSTILE_GROUP = 'Hostile row text';
const MENU_GROUP = 'SavedViewMenu';
const MENU_STATES_GROUP = 'SavedViewMenu states';
const LIST_NAME = 'Prompts, 6 results';
const POLITE_REGION = '#live-region-polite';
/** `LIST_ROW_HEIGHT` of data-table-list.tsx: the `li`, the skeleton row and the spacers all come from it. */
const LIST_ROW_HEIGHT = 56;
/** The smallest touch target the list promises (19 section 6.7 rule 1). */
const MIN_TARGET = 44;
/** The prompts of the fixture in the order of Mention rate, highest first, the unknown value last. */
const BY_MENTION = [
  'Best CRM for startups',
  'Which customer relationship management platform should a small marketing agency choose for email, pipeline and reporting',
  'HubSpot alternatives',
  'CRM pricing compared',
  'CRM with email marketing built in',
  'Best CRM for a small agency',
] as const;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The gallery group (`<section>`) whose heading is `title`. */
function group(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 2, name: title, exact: true }).locator('xpath=ancestor::section[1]');
}

/** One row of a group, found by the label on its left. */
const rowOf = (scope: Locator, label: string): Locator => scope.getByText(label, { exact: true }).locator('xpath=..');

/** A specimen of a group, by the `data-specimen` the page gives its frame. */
const specimen = (page: Page, name: string): Locator => page.locator(`[data-specimen="${name}"]`);

async function open(page: Page, theme: Theme, width: number, height = 900, query = ''): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.setViewportSize({ width, height });
  await page.goto(`${PAGE}${query}`);
  await page.getByRole('heading', { level: 2, name: LIVE_GROUP, exact: true }).waitFor();
}

/** Presses Tab until `target` has focus, at most `limit` times: the target is reachable from the keyboard. */
async function tabTo(page: Page, target: Locator, limit: number): Promise<void> {
  for (let press = 0; press < limit; press += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the element within ${String(limit)} presses`);
}

/** The rows of a list, as the buttons that open them. */
const listRows = (scope: Locator): Locator => scope.getByRole('list').getByRole('button');

/** The row `li` elements that are not the spacers of the window. */
const rowItems = (scope: Locator): Locator =>
  scope.locator('[data-slot="data-table-list"] ul > li:not([aria-hidden="true"])');

async function expectInsideViewport(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box === null || viewport === null) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

for (const theme of THEMES) {
  test.describe(`the lists and views page in the ${theme} theme`, () => {
    for (const width of WIDTHS) {
      test(`has no accessibility violation and no horizontal scroll at ${String(width)} px`, async ({ page }) => {
        await open(page, theme, width);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
        await expectAccessible(page);
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
      });
    }
  });
}

test('titles every group of the page with a level 2 heading', async ({ page }) => {
  await open(page, 'light', 1280);
  const titles = [FRAMES_GROUP, LIVE_GROUP, STATES_GROUP, LONG_GROUP, HOSTILE_GROUP, MENU_GROUP, MENU_STATES_GROUP];
  for (const title of titles) await expect(group(page, title)).toBeVisible();
});

test.describe('the mobile list in its three frames at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  for (const px of [320, 390, 768]) {
    test(`at ${String(px)} px has six rows of ${String(LIST_ROW_HEIGHT)} px, none clipped`, async ({ page }) => {
      const frame = group(page, FRAMES_GROUP).locator(`[data-specimen-frame="${String(px)}"]`);
      await frame.scrollIntoViewIfNeeded();
      await expect(rowItems(frame)).toHaveCount(6);
      const box = await frame.boundingBox();
      expect(box?.width).toBe(px);
      // The `li` is exactly the window's row height: a drift of 1 px per row would misplace every spacer
      const heights = await rowItems(frame).evaluateAll((items) =>
        items.map((item) => (item instanceof HTMLElement ? item.offsetHeight : 0)),
      );
      expect(heights).toEqual(Array.from({ length: 6 }, () => LIST_ROW_HEIGHT));
      const buttons = await rowItems(frame)
        .getByRole('button')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            height: node.getBoundingClientRect().height,
            clipped: node.scrollWidth > node.clientWidth,
          })),
        );
      for (const button of buttons) {
        expect(button.height).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(button.clipped).toBe(false);
      }
      const fits = await frame.evaluate((node) => node.scrollWidth <= node.clientWidth);
      expect(fits).toBe(true);
    });
  }

  test('cuts the long prompt with an ellipsis and shows an unknown rate as n/a', async ({ page }) => {
    const frame = group(page, FRAMES_GROUP).locator('[data-specimen-frame="320"]');
    await frame.scrollIntoViewIfNeeded();
    const longRow = listRows(frame).filter({ hasText: BY_MENTION[1] });
    const identity = longRow.locator('span.truncate').first();
    const cut = await identity.evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(cut).toBe(true);
    const unknown = listRows(frame).filter({ hasText: BY_MENTION[5] });
    await expect(unknown).toContainText('n/a');
    await expect(unknown).not.toContainText('0%');
  });
});

test.describe('the live list or table', () => {
  test('is the list below 768 px and the table from 768 px', async ({ page }) => {
    await open(page, 'light', 767);
    const live = group(page, LIVE_GROUP);
    await expect(live.getByRole('list', { name: LIST_NAME })).toBeVisible();
    await expect(live.getByRole('grid')).toHaveCount(0);
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(live.getByRole('grid')).toBeVisible();
    await expect(live.getByRole('list', { name: LIST_NAME })).toHaveCount(0);
    await expect(live.getByRole('radiogroup', { name: 'Layout' })).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(live.getByRole('grid')).toBeVisible();
    await expect(live.getByRole('radiogroup', { name: 'Layout' })).toHaveCount(0);
  });

  test('keeps every row at 56 px with a 44 px target, in order of Mention rate', async ({ page }) => {
    await open(page, 'light', 390, 844);
    const live = group(page, LIVE_GROUP);
    const rows = listRows(live);
    await expect(rows).toHaveCount(6);
    for (const [index, name] of BY_MENTION.entries()) {
      await expect(rows.nth(index)).toHaveAccessibleName(new RegExp(`^${escapeRegExp(name)} `));
    }
    const heights = await rowItems(live).evaluateAll((items) =>
      items.map((item) => (item instanceof HTMLElement ? item.offsetHeight : 0)),
    );
    expect(heights).toEqual(Array.from({ length: 6 }, () => LIST_ROW_HEIGHT));
    for (let index = 0; index < 6; index += 1) {
      const box = await rows.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET);
    }
    // The change is spoken in words and the unknown rate is not a zero
    await expect(rows.nth(0)).toHaveAccessibleName(/Mention rate 70\.0% .*21 of 30 answers/);
    await expect(rows.nth(5)).toHaveAccessibleName(/Mention rate n\/a/);
  });

  test('is reached by Tab row by row and opened by Enter and Space', async ({ page }) => {
    await open(page, 'light', 390, 844);
    const live = group(page, LIVE_GROUP);
    const rows = listRows(live);
    await live.getByRole('button', { name: /^Sort: Mention rate/ }).focus();
    for (let index = 0; index < 6; index += 1) await tabTo(page, rows.nth(index), 3);
    await expect(live.getByText('Opened: none yet', { exact: true })).toBeVisible();
    await rows.nth(2).focus();
    await page.keyboard.press('Enter');
    await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(live.getByText(`Opened: ${BY_MENTION[2]}`, { exact: true })).toBeVisible();
    await rows.nth(3).focus();
    await page.keyboard.press('Space');
    await expect(rows.nth(3)).toHaveAttribute('aria-current', 'true');
    await expect(rows.nth(2)).not.toHaveAttribute('aria-current', 'true');
    await expect(live.getByText(`Opened: ${BY_MENTION[3]}`, { exact: true })).toBeVisible();
  });

  test('sorts from the menu, keeps the direction and says what changed', async ({ page }) => {
    await open(page, 'light', 390, 844);
    const live = group(page, LIVE_GROUP);
    const rows = listRows(live);
    const trigger = live.getByRole('button', { name: /^Sort: Mention rate/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expectInsideViewport(page, menu);
    await menu.getByRole('menuitemradio', { name: 'Prompt', exact: true }).click();
    await expect(page.locator(POLITE_REGION)).toHaveText('Sorted by Prompt descending');
    await expect(rows.first()).toHaveAccessibleName(/^Which customer relationship management platform /);
    // A radio item keeps the menu open, so the direction is chosen from the same menu
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name: 'Sort ascending' }).click();
    await expect(page.locator(POLITE_REGION)).toHaveText('Sorted by Prompt ascending');
    await expect(rows.first()).toHaveAccessibleName(/^Best CRM for a small agency /);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(live.getByRole('button', { name: /^Sort: Prompt/ })).toBeFocused();
  });

  test('offers the List and Table switch below 768 px, and the table replaces the list', async ({ page }) => {
    await open(page, 'light', 640);
    const live = group(page, LIVE_GROUP);
    const layout = live.getByRole('radiogroup', { name: 'Layout' });
    await expect(layout).toBeVisible();
    await expect(layout.getByRole('radio', { name: 'List' })).toBeChecked();
    await layout.getByRole('radio', { name: 'Table' }).click();
    await expect(live.getByRole('grid')).toBeVisible();
    await expect(live.getByRole('list', { name: LIST_NAME })).toHaveCount(0);
    // The switch stays in the table's toolbar while the layout is narrow
    await expect(layout.getByRole('radio', { name: 'Table' })).toBeChecked();
    await layout.getByRole('radio', { name: 'List' }).click();
    await expect(live.getByRole('list', { name: LIST_NAME })).toBeVisible();
    await expect(live.getByRole('grid')).toHaveCount(0);
  });

  test('has Comfortable and Compact rows in the table at 1280 px', async ({ page }) => {
    await open(page, 'light', 1280);
    const live = group(page, LIVE_GROUP);
    const row = live.getByRole('grid').getByRole('row').nth(1);
    const height = async (): Promise<number> => (await row.boundingBox())?.height ?? 0;
    const choose = async (name: string): Promise<void> => {
      await live.getByRole('button', { name: 'Density', exact: true }).click();
      await page.getByRole('menuitemradio', { name }).click();
      // A radio item keeps the menu open
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
    };
    // The row is its token height: nothing in a cell may make it taller (the mention cell keeps one line)
    await choose('Comfortable');
    await expect.poll(height).toBeCloseTo(40, 0);
    await choose('Compact (default)');
    await expect.poll(height).toBeCloseTo(32, 0);
  });
});

test.describe('the live list on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('is the list and has no List and Table switch', async ({ page }) => {
    await page.goto(PAGE);
    const live = page
      .getByRole('heading', { level: 2, name: LIVE_GROUP, exact: true })
      .locator('xpath=ancestor::section[1]');
    await expect(live.getByRole('list', { name: LIST_NAME })).toBeVisible();
    await expect(live.getByRole('radiogroup', { name: 'Layout' })).toHaveCount(0);
    await expect(live.getByRole('grid')).toHaveCount(0);
  });
});

test.describe('the list states at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('loading is a named status with eight rows of the same height and no spinner', async ({ page }) => {
    const frame = specimen(page, 'loading');
    await frame.scrollIntoViewIfNeeded();
    const status = frame.getByRole('status', { name: 'Loading prompts' });
    await expect(status).toBeVisible();
    const heights = await status
      .locator(':scope > div')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    expect(heights).toEqual(Array.from({ length: 8 }, () => LIST_ROW_HEIGHT));
    await expect(frame.getByRole('list')).toHaveCount(0);
  });

  test('empty says why and has its action; filtered empty has none', async ({ page }) => {
    const empty = specimen(page, 'empty');
    await empty.scrollIntoViewIfNeeded();
    await expect(empty.getByRole('heading', { level: 3, name: 'No prompts tracked yet' })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Add prompts' })).toBeVisible();
    const filtered = specimen(page, 'filtered-empty');
    await expect(filtered.getByRole('heading', { level: 3, name: 'No prompts match' })).toBeVisible();
    await expect(filtered.getByRole('button')).toHaveCount(0);
  });

  test('error keeps its place and Retry brings the rows back', async ({ page }) => {
    const frame = specimen(page, 'error');
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.getByText('The prompts did not load', { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'Try again' }).click();
    await expect(frame.getByRole('list', { name: LIST_NAME })).toBeVisible();
    await frame.getByRole('button', { name: 'Fail again' }).click();
    await expect(frame.getByText('The prompts did not load', { exact: true })).toBeVisible();
  });

  test('refetching keeps the rows, marks the list busy and draws the bar', async ({ page }) => {
    const frame = specimen(page, 'refetching');
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.locator('[data-slot="list-refetch-bar"]')).toHaveCount(0);
    await frame.getByRole('button', { name: 'Refetch', exact: true }).click();
    await expect(frame.locator('[data-slot="list-refetch-bar"]')).toBeVisible();
    await expect(frame.getByRole('list', { name: LIST_NAME })).toHaveAttribute('aria-busy', 'true');
    await expect(listRows(frame)).toHaveCount(6);
  });

  test('partial and stale say so in the count line', async ({ page }) => {
    const partial = specimen(page, 'partial');
    await partial.scrollIntoViewIfNeeded();
    await expect(partial.getByText('Loading 3 of 6 prompts', { exact: true })).toBeVisible();
    const stale = specimen(page, 'stale');
    await expect(stale.getByText(/^6 prompts · Updated 3d ago, the last run did not finish$/)).toBeVisible();
  });
});

test.describe('long lists and hostile text at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('150 rows render a window of them, and scrolling moves it to the last row', async ({ page }) => {
    const frame = specimen(page, 'windowed');
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.getByText('150 prompts', { exact: true })).toBeVisible();
    const rendered = async (): Promise<number> => rowItems(frame).count();
    expect(await rendered()).toBeGreaterThan(0);
    expect(await rendered()).toBeLessThan(40);
    await expect(listRows(frame).first()).toHaveAccessibleName(/^Prompt 1: /);
    await frame.locator('[data-slot="data-table-list-region"]').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(frame.getByRole('button', { name: /^Prompt 150: / })).toBeVisible();
    expect(await rendered()).toBeLessThan(40);
    // The rows keep their height and the whole list its length
    const heights = await rowItems(frame).evaluateAll((items) =>
      items.map((item) => (item instanceof HTMLElement ? item.offsetHeight : 0)),
    );
    expect(new Set(heights)).toEqual(new Set([LIST_ROW_HEIGHT]));
  });

  test('a server list shows its range and pages with Previous and Next', async ({ page }) => {
    const frame = specimen(page, 'server');
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.getByText('Showing 1 to 100 of 150 prompts', { exact: true })).toBeVisible();
    const previous = frame.getByRole('button', { name: 'Previous' });
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
    await frame.getByRole('button', { name: 'Next' }).click();
    await expect(frame.getByText('Showing 101 to 150 of 150 prompts', { exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: /^Prompt 101: / })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true');
    await previous.click();
    await expect(frame.getByText('Showing 1 to 100 of 150 prompts', { exact: true })).toBeVisible();
  });

  test('hostile prompt text comes out as text and no row is wider than its list', async ({ page }) => {
    const frame = group(page, HOSTILE_GROUP);
    await frame.scrollIntoViewIfNeeded();
    const rows = listRows(frame);
    await expect(rows).toHaveCount(8);
    await expect(rows.first()).toContainText('<img src=x onerror=');
    const clipped = await rows.evaluateAll((nodes) => nodes.map((node) => node.scrollWidth > node.clientWidth));
    expect(clipped.every((value) => !value)).toBe(true);
    for (let index = 0; index < 8; index += 1) await rows.nth(index).click();
    expect(await page.evaluate((key) => Reflect.get(window, key), MARKER)).toBeUndefined();
  });
});

test.describe('the saved view menu at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('applies a preset by keyboard, shows (edited) after a change and resets', async ({ page }) => {
    const live = group(page, MENU_GROUP);
    await live.scrollIntoViewIfNeeded();
    const trigger = live.getByRole('button', { name: /^Saved view: / });
    await expect(trigger).toHaveAccessibleName('Saved view: Default');
    await expect(trigger).not.toContainText('(edited)');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'Default' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Branded prompts' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName('Saved view: Branded prompts');
    await expect(trigger).toContainText('View');
    await expect(trigger).toContainText('Branded prompts');
    await expect(page.locator(POLITE_REGION)).toHaveText('View Branded prompts applied, 1 filter');
    await expect(page).toHaveURL(/[?&]view=branded(&|$)/);
    await expect(page).toHaveURL(/[?&]branded=only(&|$)/);
    await expect(live.getByText('Address keys: view=branded, branded=only', { exact: true })).toBeVisible();

    await live.getByRole('button', { name: 'Search crm', exact: true }).click();
    await expect(trigger).toHaveAccessibleName('Saved view: Branded prompts, edited');
    await expect(trigger).toContainText('(edited)');
    await expect(page).toHaveURL(/[?&]q=crm(&|$)/);

    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Reset to Branded prompts' }).click();
    await expect(trigger).toHaveAccessibleName('Saved view: Branded prompts');
    await expect(trigger).not.toContainText('(edited)');
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page.locator(POLITE_REGION)).toHaveText('View Branded prompts applied, 1 filter');
  });

  test('a view is a history entry: Back returns to the view before it', async ({ page }) => {
    const live = group(page, MENU_GROUP);
    const trigger = live.getByRole('button', { name: /^Saved view: / });
    await trigger.click();
    await page.getByRole('menuitemradio', { name: 'Uncited' }).click();
    await expect(trigger).toHaveAccessibleName('Saved view: Uncited');
    await expect(page).toHaveURL(/[?&]cited=no(&|$)/);
    await expect(page).toHaveURL(/[?&]sort=-mention(&|$)/);
    await expect(page.locator(POLITE_REGION)).toHaveText('View Uncited applied, 2 filters');
    await page.goBack();
    await expect(trigger).toHaveAccessibleName('Saved view: Default');
  });

  test('opens on a shared link in the state the link names', async ({ page }) => {
    await open(page, 'light', 1280, 900, '?view=branded&branded=only&q=crm');
    const trigger = group(page, MENU_GROUP).getByRole('button', { name: /^Saved view: / });
    await expect(trigger).toHaveAccessibleName('Saved view: Branded prompts, edited');
  });

  test('draws its static states with the full name of a long view kept for assistive technology', async ({ page }) => {
    const states = group(page, MENU_STATES_GROUP);
    await states.scrollIntoViewIfNeeded();
    await expect(rowOf(states, 'Edited').getByRole('button')).toHaveAccessibleName(
      'Saved view: Branded prompts, edited',
    );
    const long = rowOf(states, 'Long name, 60 characters').getByRole('button');
    await expect(long).toHaveAccessibleName('Saved view: Prompts that name a competitor and no engine cites our sites');
    const cut = await long.locator('span.truncate').evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(cut).toBe(true);
    await rowOf(states, 'With a notice').getByRole('button').click();
    await expect(page.getByRole('menu').getByText('1 filter no longer exists', { exact: true })).toBeVisible();
  });

  test('stored views are listed under Workspace views and Your views, and extra items after Reset', async ({
    page,
  }) => {
    const states = group(page, MENU_STATES_GROUP);
    await states.scrollIntoViewIfNeeded();
    await rowOf(states, 'Stored views').getByRole('button').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('Presets', { exact: true })).toBeVisible();
    await expect(menu.getByText('Workspace views', { exact: true })).toBeVisible();
    await expect(menu.getByText('Your views', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await rowOf(states, 'Persistence items').getByRole('button').click();
    await expect(page.getByRole('menu')).toBeVisible();
    const names = await page.getByRole('menu').getByRole('menuitem').allTextContents();
    expect(names).toEqual([
      'Reset to Branded prompts',
      'Save as new view',
      'Rename view',
      'Set as my default',
      'Delete view',
    ]);
  });
});

test.describe('the saved view menu on a phone', () => {
  for (const width of [320, 390]) {
    test(`stays inside a ${String(width)} px screen`, async ({ page }) => {
      await open(page, 'light', width, 700);
      const live = group(page, MENU_GROUP);
      const trigger = live.getByRole('button', { name: /^Saved view: / });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expectInsideViewport(page, menu);
      const fits = await menu.evaluate((node) => node.scrollWidth <= node.clientWidth);
      expect(fits).toBe(true);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }

  test('keeps a long view name inside a 160 px frame', async ({ page }) => {
    await open(page, 'light', 1280);
    const states = group(page, MENU_STATES_GROUP);
    const frame = states.locator('[data-specimen-frame="160"]');
    await frame.scrollIntoViewIfNeeded();
    const fits = await frame.evaluate((node) => node.scrollWidth <= node.clientWidth);
    expect(fits).toBe(true);
    const trigger = frame.getByRole('button');
    const box = await trigger.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(160);
  });
});
