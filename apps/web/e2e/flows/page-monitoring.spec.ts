import { expect, test, type Page } from '@playwright/test';

import { ADMIN } from '../support/internal-links';
import AxeBuilder from '@axe-core/playwright';

import { signIn } from '../support';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Monitoring (page-search spec D1 to D22) against the test build with every route mocked. */
const MONITORING = '/digibranders/eventus-security/seo/pages/monitoring';

const EVENTUS_ID = '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b03';
const TOMAS_ID = '0192d1a8-5b10-7c01-9a11-000000000002';

/** The mock keeps what was connected in a cookie (src/mocks/integrations-state.ts); this is Eventus linked to its domain. */
async function connectSearchConsole(page: Page): Promise<void> {
  const stored = {
    next: 102,
    connections: [[100, 'active', TOMAS_ID, '2026-11-01T09:00:00Z', 'both']],
    integrations: [[101, EVENTUS_ID, 100, 'gsc', 'sc-domain:eventussecurity.com', 'active', '2026-11-01T09:00:00Z']],
  };
  const value = JSON.stringify(stored).replace(
    /["\\, ]/g,
    (c) => ({ '"': "'", ',': '!', '\\': '*', ' ': '_' })[c] ?? c,
  );
  await page.context().addCookies([{ name: 'mock-integrations', value, url: 'http://localhost:3110' }]);
}

test.describe('Monitoring (tracked pages)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the table fits 1280 by 720: first row high up, no page scroll, sideways scroll inside the table', async ({
    page,
  }) => {
    await signIn(page, ADMIN);
    await connectSearchConsole(page);
    await page.goto(MONITORING);
    const grid = page.getByRole('grid').first();
    await expect(grid).toBeVisible();
    const row = grid.getByRole('row').nth(1);
    await expect(row).toBeVisible();
    const m = await page.evaluate(() => {
      const g = document.querySelector('[role="grid"]');
      const first = document.querySelectorAll('[role="grid"] [role="row"]')[1];
      const scroller = [...document.querySelectorAll<HTMLElement>('*')].find(
        (el) => g?.contains(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible',
      );
      return {
        firstRowTop: Math.round(first?.getBoundingClientRect().top ?? -1),
        firstRowHeight: Math.round(first?.getBoundingClientRect().height ?? -1),
        pageScrollY: document.documentElement.scrollHeight - window.innerHeight,
        pageScrollX: document.documentElement.scrollWidth - window.innerWidth,
        gridScrollsSideways: scroller !== undefined,
      };
    });
    expect(m.firstRowTop).toBeLessThan(210);
    expect(m.firstRowHeight).toBeLessThanOrEqual(36);
    expect(m.pageScrollY).toBeLessThanOrEqual(0);
    expect(m.pageScrollX).toBeLessThanOrEqual(0);
    expect(m.gridScrollsSideways).toBe(true);
  });

  test('the pages beside the table: the drawer opens and the page columns stay while the table scrolls', async ({
    page,
  }) => {
    await signIn(page, ADMIN);
    await connectSearchConsole(page);
    await page.goto(MONITORING);
    const grid = page.getByRole('grid').first();
    await grid
      .getByRole('row', { name: /\/services\/soc/ })
      .first()
      .click();
    const drawer = page.getByRole('complementary').first();
    await expect(drawer).toBeVisible();
    const width = await drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    // The shared Inspector is 400 px wide on this branch; the 480 to 960 px version is the drawer session's branch
    expect(width).toBeGreaterThanOrEqual(400);
    const pinned = await page.evaluate(() => {
      const cell = document.querySelector('[role="grid"] tbody tr:first-child > :nth-child(2)');
      const scroller = [...document.querySelectorAll<HTMLElement>('*')].find(
        (el) =>
          el.contains(cell) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible',
      );
      if (cell === null || scroller === undefined) return null;
      const before = cell.getBoundingClientRect().left;
      scroller.scrollLeft = scroller.scrollWidth;
      return { before, after: cell.getBoundingClientRect().left };
    });
    expect(pinned).not.toBeNull();
    expect(pinned?.after).toBe(pinned?.before);
  });

  test('main has no accessibility violation and no dash, with the drawer open too', async ({ page }) => {
    await signIn(page, ADMIN);
    await connectSearchConsole(page);
    await page.goto(MONITORING);
    await page.locator('h1').first().waitFor();
    const check = async (): Promise<void> => {
      // The shell's notification bell (outside main) has its own aria issue that is not this screen's
      const { violations } = await new AxeBuilder({ page }).include('main').withTags(WCAG).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(await page.locator('main').innerText()).not.toMatch(/[\u2013\u2014]/);
    };
    await page
      .getByRole('grid')
      .first()
      .getByRole('row', { name: /\/services\/soc/ })
      .first()
      .waitFor();
    await check();
    await page
      .getByRole('grid')
      .first()
      .getByRole('row', { name: /\/services\/soc/ })
      .first()
      .click();
    await expect(page.getByRole('complementary').first()).toBeVisible();
    await check();
  });
});
