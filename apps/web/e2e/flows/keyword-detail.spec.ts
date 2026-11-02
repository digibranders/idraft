import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { expectAccessible, signIn, waitForContent } from '../support';

const EDITOR = 'priya@digibranders.test';
const VIEWER = 'mei@digibranders.test';
const LIST = '/digibranders/fynix/seo/keywords';
const DETAIL = /\/digibranders\/fynix\/seo\/keywords\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const THEME_KEY = 'idraft.theme';
/** The ranked fixture keyword the layout tests open, and the stale and pending ones the states tests open. */
const RANKED = { id: mockId('tracked', 1), text: 'seo agency berlin' };
const STALE = { id: mockId('tracked', 34), text: 'fynix reviews' };
const ARCHIVED = { id: mockId('tracked', 60), text: 'seo newsletter' };
/** The widths of 19-responsive-behavior.md the plan names, with a height that fits the whole header. */
const WIDTHS = [
  { width: 1440, height: 900, actions: 'beside' },
  { width: 1280, height: 800, actions: 'beside' },
  { width: 1024, height: 768, actions: 'beside' },
  { width: 390, height: 844, actions: 'below' },
] as const;
const CONTROL = 36;
const CONTROL_SM = 32;
const TAB_ROW = 44;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element has no box: it is not on screen');
  return box;
}

/** The page does not scroll sideways (19 section 3). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const rowHeader = (page: Page, keyword: string): Locator =>
  page
    .getByRole('grid', { name: 'Tracked keywords' })
    .getByRole('rowheader')
    .filter({ hasText: new RegExp(`^\\s*${keyword}\\b`) })
    .first();

test.describe('keyword detail', () => {
  test('opens from the inspector with Open page, and Back returns to the list with the inspector open', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(LIST);
    const header = rowHeader(page, 'seo agency');
    const keyword = ((await header.locator('.truncate').first().textContent()) ?? '').trim();
    expect(keyword).toBe('seo agency');
    await header.click();
    const inspector = page.getByRole('complementary', { name: keyword });
    await expect(inspector).toBeVisible();
    await inspector.getByRole('button', { name: 'Open page' }).click();

    await expect(page).toHaveURL(DETAIL);
    const id = DETAIL.exec(page.url())?.[1] ?? '';
    expect(id).not.toBe('');
    await expect(page.getByRole('heading', { level: 1, name: keyword })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Keyword sections' }).getByRole('tab')).toHaveCount(2);
    await expectNoHorizontalScroll(page);

    // Back is the browser's: the list comes back with the inspector on the same keyword
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?inspect=keyword(:|%3A)${id}$`));
    await expect(page.getByRole('complementary', { name: keyword })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: keyword })).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${LIST}$`));

    // The list still steps with J and K once an inspector is open again
    await rowHeader(page, 'seo agency').click();
    await expect(page.getByRole('complementary', { name: keyword })).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.getByRole('complementary', { name: 'backlink checker' })).toBeVisible();
  });

  test('the back link returns to the list as it was left, filters included', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}?intent=commercial`);
    await expect(page.getByRole('button', { name: 'Intent: Commercial. Edit filter' })).toBeVisible();
    await page.getByRole('grid', { name: 'Tracked keywords' }).getByRole('rowheader').first().click();
    await page.getByRole('complementary').getByRole('button', { name: 'Open page' }).click();
    await expect(page).toHaveURL(DETAIL);
    const back = page.getByRole('main').getByRole('link', { name: 'Keywords', exact: true });
    await expect(back).toHaveAttribute('href', `${LIST}?intent=commercial`);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?intent=commercial$`));
    await expect(page.getByRole('button', { name: 'Intent: Commercial. Edit filter' })).toBeVisible();
  });

  test('a Ctrl or Cmd click on a row opens its page in a new tab and leaves this tab alone', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(LIST);
    await expect(rowHeader(page, 'backlink checker')).toBeVisible();
    const before = page.url();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      rowHeader(page, 'backlink checker').click({ modifiers: ['ControlOrMeta'] }),
    ]);
    await popup.waitForLoadState();
    await expect(popup).toHaveURL(DETAIL);
    await expect(popup.getByRole('heading', { level: 1, name: 'backlink checker' })).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await popup.close();
  });

  test('an address with no keyword behind it shows the not-found state, and one that is no id is the 404 page', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/00000000-0000-4000-8000-000000000000`);
    await expect(page.getByRole('heading', { level: 1, name: 'This keyword is no longer tracked' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Keywords' })).toHaveAttribute('href', LIST);
    await expectAccessible(page);

    // Mocked builds answer 200 with the 404 page (the response starts before the page decides), as auth.spec notes
    await page.goto(`${LIST}/not-a-keyword`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This page does not exist or you do not have access to it' }),
    ).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
  });

  test('a viewer reads the page and has no Check now, no archive and no change of depth', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${LIST}/${RANKED.id}`);
    await expect(page.getByRole('heading', { level: 1, name: RANKED.text })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Change depth' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expectAccessible(page);
  });

  test('an archived keyword says so and offers Restore; a stale one says Stale', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${ARCHIVED.id}`);
    await expect(page.getByRole('heading', { level: 1, name: ARCHIVED.text })).toBeVisible();
    await expect(page.getByText('Archived', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Restore' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`${LIST}/${STALE.id}`);
    await expect(page.getByRole('heading', { level: 1, name: STALE.text })).toBeVisible();
    await expect(page.getByText('Stale', { exact: true })).toBeVisible();
  });

  test('the tabs move with the arrow keys and live in the address', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(`${LIST}/${RANKED.id}`);
    await expect(page.getByRole('heading', { level: 1, name: RANKED.text })).toBeVisible();
    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'SERP snapshots', selected: true })).toBeFocused();
    await expect(page).toHaveURL(/[?&]tab=snapshots/);
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Overview', selected: true })).toBeVisible();
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('the page action is the primary 36 px Check now, where the inspector has a 32 px secondary one', async ({
    page,
  }) => {
    await signIn(page, EDITOR);
    await page.goto(LIST);
    await rowHeader(page, 'seo agency').click();
    const inspector = page.getByRole('complementary', { name: 'seo agency' });
    const small = await boxOf(inspector.getByRole('button', { name: 'Check now' }));
    expect(small.height).toBe(CONTROL_SM);
    await inspector.getByRole('button', { name: 'Open page' }).click();
    await expect(page).toHaveURL(DETAIL);
    const check = page.getByRole('button', { name: 'Check now' });
    await expect(check).toBeVisible();
    expect((await boxOf(check)).height).toBe(CONTROL);
  });

  for (const theme of ['light', 'dark'] as const) {
    test.describe(`in the ${theme} theme`, () => {
      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          ([key, value]) => {
            localStorage.setItem(key, value);
          },
          [THEME_KEY, theme] as const,
        );
      });

      for (const { width, height, actions } of WIDTHS) {
        test(`lays the header out at ${String(width)} px`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height });
          await signIn(page, EDITOR);
          await page.goto(`${LIST}/${RANKED.id}`);
          const title = page.getByRole('heading', { level: 1, name: RANKED.text });
          await expect(title).toBeVisible();
          await waitForContent(page);

          const back = await boxOf(page.getByRole('main').getByRole('link', { name: 'Keywords', exact: true }));
          const titleBox = await boxOf(title);
          const more = await boxOf(page.getByRole('button', { name: 'More actions' }));
          const check = await boxOf(page.getByRole('button', { name: 'Check now' }));
          const open = await boxOf(page.getByRole('link', { name: 'Open ranking page in a new tab' }));
          const tabs = await boxOf(page.getByRole('tablist', { name: 'Keyword sections' }));
          const tab = await boxOf(page.getByRole('tab', { name: 'Overview' }));

          // The back link is above the title, on a line of its own
          expect(back.y + back.height).toBeLessThanOrEqual(titleBox.y + 1);
          // The actions read in one order, left to right, on one row
          expect(open.x + open.width).toBeLessThanOrEqual(more.x + 1);
          expect(more.x + more.width).toBeLessThanOrEqual(check.x + 1);
          expect(Math.abs(open.y - more.y)).toBeLessThanOrEqual(2);
          expect(Math.abs(more.y - check.y)).toBeLessThanOrEqual(2);
          expect(check.height).toBe(CONTROL);
          // The icon button is as high as the buttons beside it, and square
          expect(more.height).toBe(CONTROL);
          expect(more.width).toBe(CONTROL);
          expect(open.height).toBe(CONTROL);
          // The tabs are the 44 px row under the header and span the content
          expect(tabs.y).toBeGreaterThan(check.y + check.height);
          expect(tab.height).toBe(TAB_ROW);
          expect(tabs.width).toBeGreaterThan(width * 0.6);

          const placements = {
            // Beside the title, with the right edge of the actions at the content edge
            beside: (): void => {
              expect(check.y).toBeLessThanOrEqual(titleBox.y + titleBox.height);
              expect(check.x).toBeGreaterThan(titleBox.x + 100);
              expect(check.x + check.width).toBeGreaterThan(width - 80);
            },
            // Under the title, on a row of their own (PageHeader below 768 px)
            below: (): void => {
              expect(open.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
              expect(open.x).toBeLessThan(width / 2);
            },
          } as const;
          placements[actions]();
          expect(check.x + check.width).toBeLessThanOrEqual(width);
          await expectNoHorizontalScroll(page);
          await expectAccessible(page);
          await page.screenshot({ path: testInfo.outputPath(`keyword-detail-${String(width)}-${theme}.png`) });
        });
      }
    });
  }
});
