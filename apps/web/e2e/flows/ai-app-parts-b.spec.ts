import { expect, test, type Locator, type Page } from '@playwright/test';

import { HOSTILE_TITLES, MARKER } from '../../src/components/app/cells/xss-fixtures';
import { expectAccessible } from '../support';

/**
 * The domain and URL cells, the count popover, the change feed, the count tabs and the inspector stepping of
 * WP-08 on their design-system page, in the production build. jsdom has no layout, no stylesheet and no focus
 * order, so contrast, overflow, the popover's place, truncation and the keyboard path are checked here. The page
 * is also the hostile-input fixture: markup, script schemes and bidi controls must come out as text.
 */
const THEME_STORAGE_KEY = 'idraft.theme';
const PAGE = '/design-system/domains-feeds';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

// The specimens of the page and what they are given (domains-feeds-section.tsx)
const SEVEN_DOMAINS = '7 domains cited instead, show them';
const POPOVER_TITLE = 'Cited instead';
const TABS_LABEL = 'Event types';
const LONG_HOST_REGISTRABLE = 'example-registrable.co.uk';
const LONG_URL_TAIL = 'how-to-choose-a-crm-for-startups-and-small-teams';
const STEPPING_GROUP = 'In a table, Default and Compact';
const STEPPING_COUNT = 6;

// No request leaves the machine, and the placeholder square is what every icon slot shows
test.beforeEach(async ({ page }) => {
  await page.route('**/s2/favicons**', (route) => route.abort());
});

/** The gallery group (`<section>`) whose heading is `title`. */
function group(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 2, name: title, exact: true }).locator('xpath=ancestor::section[1]');
}

/** One row of a group, found by the label on its left. */
const rowOf = (scope: Locator, label: string): Locator => scope.getByText(label, { exact: true }).locator('xpath=..');

async function open(page: Page, theme: Theme, width: number, height = 900): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.setViewportSize({ width, height });
  await page.goto(PAGE);
  await page.getByRole('heading', { level: 2, name: 'DomainCell', exact: true }).waitFor();
}

/** Presses Tab until `target` has focus, at most `limit` times: the target is reachable from the keyboard. */
async function tabTo(page: Page, target: Locator, limit: number): Promise<void> {
  for (let press = 0; press < limit; press += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the element within ${String(limit)} presses`);
}

/** Puts the keyboard's starting point on a group's heading, so the next Tab goes to the first stop after it. */
async function startAt(page: Page, title: string): Promise<void> {
  const heading = page.getByRole('heading', { level: 2, name: title, exact: true });
  await heading.scrollIntoViewIfNeeded();
  await heading.click();
}

/** An outline or a shadow is drawn: the control shows where the focus is. */
async function expectFocusRing(control: Locator): Promise<void> {
  const style = await control.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth, boxShadow: computed.boxShadow };
  });
  const outlined = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
  expect(outlined || style.boxShadow !== 'none', `the focused control draws a ring: ${JSON.stringify(style)}`).toBe(
    true,
  );
}

const injected = (page: Page): Promise<unknown> => page.evaluate((key) => Reflect.get(window, key), MARKER);

for (const theme of THEMES) {
  test.describe(`the domains and feeds page in the ${theme} theme`, () => {
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

test.describe('the cell links at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('of the domain cells are reached in order and show a ring', async ({ page }) => {
    const links = group(page, 'DomainCell').getByRole('link');
    await startAt(page, 'DomainCell');
    await tabTo(page, links.nth(0), 4);
    await tabTo(page, links.nth(1), 4);
    await expectFocusRing(links.nth(1));
  });

  test('of the URL cell reach Open by Tab, and Copy by focus, each with a ring', async ({ page }) => {
    const row = rowOf(group(page, 'URLCell'), 'Inspector link');
    const path = row.getByRole('link').first();
    const copy = row.getByRole('button', { name: /^Copy /i });
    const openTab = row.getByRole('link', { name: /^Open .+ in a new tab$/ });
    await path.focus();
    await expect(path).toBeFocused();
    await expectFocusRing(path);
    // Copy is a cell control: out of the tab order, reached with F2 in a grid and by focus here
    await copy.focus();
    await expect(copy).toBeFocused();
    await expectFocusRing(copy);
    await openTab.focus();
    await expect(openTab).toBeFocused();
    await expectFocusRing(openTab);
    await expect(openTab).toHaveAttribute('target', '_blank');
    await expect(openTab).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  test('of a URL without an inspector link: the path is the outbound link, and Tab leaves the cell after it', async ({
    page,
  }) => {
    const row = rowOf(group(page, 'URLCell'), 'Host shown');
    const link = row.getByRole('link', { name: /^Open .+ in a new tab$/ });
    await link.focus();
    await expect(link).toBeFocused();
    await expectFocusRing(link);
    await expect(link).toHaveAttribute('target', '_blank');
  });
});

test.describe('the count popover', () => {
  test('opens by keyboard, stays inside a 390 px screen, and Escape returns focus to the trigger', async ({ page }) => {
    await open(page, 'light', 390, 844);
    const trigger = group(page, 'CountPopover').getByRole('button', { name: SEVEN_DOMAINS, exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const popup = page.getByRole('dialog', { name: POPOVER_TITLE, exact: true });
    await expect(popup).toBeVisible();
    // Five domains are listed and the rest are a count with a link
    await expect(popup.getByRole('listitem')).toHaveCount(5);
    await expect(popup.getByRole('link', { name: 'and 2 more' })).toBeVisible();
    const box = await popup.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box === null || viewport === null) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // With a link first in the list, the first Escape may close the link's tooltip and the second the popup
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('is plain text for a real zero and for an unknown count', async ({ page }) => {
    await open(page, 'light', 1280);
    const specimens = group(page, 'CountPopover');
    for (const label of ['No domains', 'Unknown count']) {
      await expect(rowOf(specimens, label).getByRole('button')).toHaveCount(0);
    }
    await expect(rowOf(specimens, 'No domains')).toContainText('0');
    await expect(rowOf(specimens, 'Unknown count')).toContainText('n/a');
  });

  test('the chip list opens its overflow popover by keyboard', async ({ page }) => {
    await open(page, 'light', 1280);
    const more = group(page, 'DomainChip').getByRole('button', { name: '2 more cited domains', exact: true });
    await more.focus();
    await page.keyboard.press('Enter');
    const popup = page.getByRole('dialog', { name: 'Cited by Perplexity', exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('listitem')).toHaveCount(2);
    // A layer inside the popup may take the first Escape
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(more).toBeFocused();
  });
});

test.describe('the count tabs and the feed', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('CountTabs is one Tab stop, moves with the arrows and Home, and Space presses', async ({ page }) => {
    const toolbar = group(page, 'CountTabs').getByRole('toolbar', { name: TABS_LABEL, exact: true });
    const all = toolbar.getByRole('button', { name: 'All, 22', exact: true });
    const moves = toolbar.getByRole('button', { name: 'Rank moves, 12', exact: true });
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(moves).toHaveAttribute('aria-pressed', 'false');

    await startAt(page, 'CountTabs');
    await tabTo(page, all, 4);
    await expectFocusRing(all);
    // The next Tab leaves the toolbar: its items are one stop
    await page.keyboard.press('Tab');
    await expect(toolbar.locator(':focus')).toHaveCount(0);
    await all.focus();

    await page.keyboard.press('ArrowRight');
    await expect(moves).toBeFocused();
    await page.keyboard.press('Space');
    await expect(moves).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Home');
    await expect(all).toBeFocused();
    await page.keyboard.press('Space');
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(moves).toHaveAttribute('aria-pressed', 'false');
  });

  test('a disabled type stays focusable, does not press, and says why', async ({ page }) => {
    const toolbar = group(page, 'CountTabs').getByRole('toolbar', { name: 'Event types, one disabled', exact: true });
    const lost = toolbar.getByRole('button', { name: /^Lost sources, / });
    await lost.focus();
    await expect(lost).toBeFocused();
    await expect(lost).toHaveAttribute('aria-disabled', 'true');
    // Keyboard focus opens the tooltip at once; a press may close it, so it is read before the press
    await expect(page.locator('[data-slot="tooltip"]')).toContainText('No lost sources in this window');
    await page.keyboard.press('Space');
    await expect(lost).toHaveAttribute('aria-pressed', 'false');
    await expect(lost).toBeFocused();
  });

  test('the feed shows three groups, a link on every row, and View all', async ({ page }) => {
    const feed = page.getByRole('region', { name: 'Key changes', exact: true });
    // The specimen's title is an h2, so the group headings are h3
    await expect(feed.getByRole('heading', { level: 2 })).toHaveCount(1);
    await expect(feed.getByRole('heading', { level: 3 })).toHaveCount(3);
    await expect(feed.getByRole('link', { name: 'View all 23 changes' })).toBeVisible();
    const rows = feed.getByRole('listitem');
    await expect(rows).toHaveCount(8);
    // The whole compact row is the link, so each row has one
    for (let index = 0; index < 8; index += 1) await expect(rows.nth(index).getByRole('link')).toHaveCount(1);
  });

  test('a refetch keeps the rows, marks the feed busy and adds two when it ends', async ({ page }) => {
    const specimens = group(page, 'ChangeFeed');
    const feed = specimens.getByRole('region', { name: 'Key changes, refetching', exact: true });
    const rows = feed.getByRole('listitem');
    const before = await rows.count();
    await expect(feed).not.toHaveAttribute('aria-busy', 'true');
    await specimens.getByRole('button', { name: 'Refetch', exact: true }).click();
    await expect(feed).toHaveAttribute('aria-busy', 'true');
    await expect(rows).toHaveCount(before);
    await specimens.getByRole('button', { name: 'Finish refetch', exact: true }).click();
    await expect(feed).not.toHaveAttribute('aria-busy', 'true');
    await expect(rows).toHaveCount(before + 2);
  });
});

test.describe('the inspector stepping at 1280 px', () => {
  test('J and K step through the order of the table, and typing J in a field does not', async ({ page }) => {
    await open(page, 'light', 1280);
    const scope = group(page, STEPPING_GROUP);
    const rows = scope.locator('tbody [role="row"]');
    await expect(rows).toHaveCount(STEPPING_COUNT);
    // The domain is the row header, so the first gridcell is the role badge: no link or button, the click is the row's own
    await rows.nth(1).getByRole('gridcell').first().click();
    const inspector = scope.locator('aside');
    const position = (index: number): Locator =>
      inspector.getByText(`${String(index)} of ${String(STEPPING_COUNT)}`, { exact: true });
    await expect(position(2)).toBeVisible();

    await page.keyboard.press('j');
    await expect(position(3)).toBeVisible();
    await page.keyboard.press('k');
    await expect(position(2)).toBeVisible();

    const search = scope.getByRole('searchbox', { name: 'Search in table' });
    await search.focus();
    await page.keyboard.type('j');
    await expect(search).toHaveValue('j');
    await expect(position(2)).toBeVisible();
    await search.fill('');

    // Back inside the inspector, J goes to the last record and stops there
    await inspector.getByRole('heading', { level: 2 }).focus();
    for (let index = 3; index <= STEPPING_COUNT; index += 1) {
      await page.keyboard.press('j');
      await expect(position(index)).toBeVisible();
    }
    await page.keyboard.press('j');
    await expect(position(STEPPING_COUNT)).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Last domain in this list' })).toBeVisible();
  });
});

test.describe('hostile input at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('is text: no script, no handler, no script link, no image but the icon, and no payload ran', async ({
    page,
  }) => {
    const hostile = group(page, 'Hostile input');
    await expect(hostile.locator('script')).toHaveCount(0);
    await expect(hostile.locator('[onerror], [onclick], [onload], [onmouseover]')).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:" i], a[href^="data:" i], a[href^="vbscript:" i]')).toHaveCount(0);
    const images = await hostile
      .locator('img')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ src: node.getAttribute('src') ?? '', alt: node.getAttribute('alt') })),
      );
    for (const image of images) {
      expect(image.alt).toBe('');
      expect(image.src).toContain('/s2/favicons');
    }
    expect(await injected(page)).toBeUndefined();
    // Hovering every link-like element runs nothing either
    for (const link of await hostile.locator('a[href]').all()) await link.hover();
    expect(await injected(page)).toBeUndefined();
  });

  test('shows each hostile title, and the markup in a host, as text', async ({ page }) => {
    const hostile = group(page, 'Hostile input');
    for (const title of HOSTILE_TITLES) {
      await expect(hostile.getByText(title, { exact: true }).first()).toBeVisible();
    }
    const hosts = hostile.locator('[data-slot="domain-cell"]');
    await expect(hosts.nth(1)).toContainText('onerror=alert(1)>');
  });

  test('keeps the registrable part of the long host visible', async ({ page }) => {
    const first = group(page, 'Hostile input').locator('[data-slot="domain-cell"]').first();
    await expect(first.getByText(LONG_HOST_REGISTRABLE, { exact: true })).toBeVisible();
  });
});

test.describe('truncation at 1280 px', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  for (const [title, slot] of [
    ['DomainCell', 'domain-cell'],
    ['URLCell', 'url-cell'],
  ] as const) {
    test(`the ${title} stays inside its frame at every width of the page`, async ({ page }) => {
      const frames = group(page, title).locator('[data-specimen-frame]');
      await expect(frames).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        const frame = frames.nth(index);
        const cell = frame.locator(`[data-slot="${slot}"]`).first();
        await expect(cell).toBeVisible();
        const sizes = await cell.evaluate((node) => {
          const frameBox = node.closest('[data-specimen-frame]')?.getBoundingClientRect();
          const box = node.getBoundingClientRect();
          return {
            scroll: node.scrollWidth,
            client: node.clientWidth,
            overshoot: frameBox === undefined ? Number.POSITIVE_INFINITY : box.right - frameBox.right,
          };
        });
        expect(sizes.scroll, `${title} ${String(index)} content width`).toBeLessThanOrEqual(sizes.client + 1);
        expect(sizes.overshoot, `${title} ${String(index)} past its frame`).toBeLessThanOrEqual(1);
      }
    });
  }

  test('the registrable part of the long host stays visible at 160 px, and the tooltip has the full host', async ({
    page,
  }) => {
    const narrow = group(page, 'DomainCell').locator('[data-specimen-frame]').first();
    const cell = narrow.locator('[data-slot="domain-cell"]');
    const registrable = cell.locator('span[aria-hidden="true"]').last();
    await expect(registrable).toBeVisible();
    const width = (await registrable.boundingBox())?.width ?? 0;
    expect(width).toBeGreaterThan(0);
    await cell.locator('span[dir="ltr"]').hover();
    await expect(page.locator('[data-slot="tooltip"]')).toContainText(`another-long-label.${LONG_HOST_REGISTRABLE}`);
  });

  test('the long path of a URL is whole in the tooltip', async ({ page }) => {
    const narrow = group(page, 'URLCell').locator('[data-specimen-frame]').first();
    await narrow.locator('[data-slot="url-cell"] span[dir="ltr"]').first().hover();
    await expect(page.locator('[data-slot="tooltip"]')).toContainText(LONG_URL_TAIL);
  });
});
