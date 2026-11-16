import { expect, test, type Page } from '@playwright/test';

import { MOCK_TERM_IDS } from '../../src/mocks/entity-fixtures';
import { signIn } from '../support';
import {
  EDITOR,
  awaitCardSettled,
  cardById,
  expectResetHidden,
  groupSelect,
  heroOf,
  numberOf,
  openOverview,
  overviewPath,
  platformSelect,
  resetScope,
  scopeBar,
  waitForOverview,
} from '../support/ai-overview';

/**
 * The scope of the AI visibility Overview as the redesign has it: the Platform and Group selects change the cards and
 * the address and Reset scope puts them back, an old link that names several platforms reads as All platforms, a
 * competitor name opens its drawer and Escape closes it with the focus back on the name, and a group that has no
 * prompt in the chosen location keeps the scope bar. Fynix: ChatGPT and Gemini are on, 23 prompts, 4 of them in
 * Technical SEO.
 */
test.describe.configure({ timeout: 120_000 });

const paramsOf = (page: Page): URLSearchParams => new URL(page.url()).searchParams;

test.describe('the Overview scope and the competitor drawer', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EDITOR);
  });

  test('Platform changes the headline and the cards and writes engine to the address, and Reset scope puts All platforms back', async ({
    page,
  }) => {
    await openOverview(page, 'Fynix', { width: 1440 });
    await expect(heroOf(page)).toContainText('Average of 2 platforms');
    const outcomes = cardById(page, 'outcome-mix');
    await awaitCardSettled(outcomes);
    await expect(outcomes).toContainText('ChatGPT');
    await expectResetHidden(page);

    await platformSelect(page).click();
    await page.getByRole('option', { name: 'Gemini', exact: true }).click();
    await expect.poll(() => paramsOf(page).get('engine')).toBe('gemini_web');
    await expect(platformSelect(page, 'Gemini')).toBeVisible();
    // One platform: the rate is of its own answers, and the outcome card draws that platform alone
    await expect(heroOf(page)).toContainText(/\d+ of \d+ answers/);
    await expect(heroOf(page)).not.toContainText('Average of');
    await expect(outcomes).not.toContainText('ChatGPT');
    await expect(outcomes).toContainText('Gemini');
    await expect(resetScope(page)).toHaveCSS('visibility', 'visible');

    await resetScope(page).click();
    await expect.poll(() => paramsOf(page).has('engine')).toBe(false);
    await expect(platformSelect(page)).toBeVisible();
    await expect(heroOf(page)).toContainText('Average of 2 platforms');
    await expectResetHidden(page);
  });

  test('Group narrows the prompts of the headline and writes topic to the address, and Reset scope clears it', async ({
    page,
  }) => {
    await openOverview(page, 'Fynix', { width: 1440 });
    await expect.poll(async () => (await numberOf(page, 'Prompts')).value).toBe('23');

    await groupSelect(page).click();
    await page.getByRole('option', { name: /Technical SEO$/ }).click();
    await expect.poll(() => paramsOf(page).get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
    await expect(groupSelect(page, /^Group: .*Technical SEO$/)).toBeVisible();
    await expect.poll(async () => (await numberOf(page, 'Prompts')).value).toBe('4');

    await resetScope(page).click();
    await expect.poll(() => paramsOf(page).has('topic')).toBe(false);
    await expect(groupSelect(page)).toBeVisible();
    await expect.poll(async () => (await numberOf(page, 'Prompts')).value).toBe('23');
  });

  test('an old link that names every platform, one of them off, reads as All platforms and the address is tidied', async ({
    page,
  }) => {
    await openOverview(page, 'Fynix', { search: '?engine=gemini_web,chatgpt_web,google_ai_mode' });
    await expect(platformSelect(page)).toBeVisible();
    await expect.poll(() => paramsOf(page).has('engine')).toBe(false);
    await expectResetHidden(page);
    await expect(heroOf(page)).toContainText('Average of 2 platforms');
  });

  test('a competitor name opens its drawer, and Escape closes it with the focus back on the name', async ({ page }) => {
    await openOverview(page, 'Fynix', { width: 1440 });
    const share = cardById(page, 'share-of-voice');
    await awaitCardSettled(share);
    const opener = share.getByRole('button', { name: 'Open Brightwave Digital', exact: true });
    await opener.click();

    const drawer = page
      .getByRole('complementary', { name: 'Brightwave Digital' })
      .or(page.getByRole('dialog', { name: 'Brightwave Digital' }));
    await expect(drawer).toBeVisible();
    await expect.poll(() => paramsOf(page).get('inspect')).toMatch(/^competitor:/);
    for (const tab of ['Overview', 'Prompts', 'Cited domains']) {
      await expect(drawer.getByRole('tab', { name: tab, exact: true })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect.poll(() => paramsOf(page).has('inspect')).toBe(false);
    await expect(opener).toBeFocused();
  });

  test('a group with no prompt in the chosen location keeps the scope bar and says why, and Clear location brings the cards back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(overviewPath('Fynix', `?topic=${MOCK_TERM_IDS.paidSearch}&country=US`));
    const state = page.locator('[data-slot="empty-state"]');
    await expect(state.getByRole('heading', { level: 2 })).toContainText(/^No prompts ask in /);
    // The bar is still there, with the group that was chosen, so the scope can be changed from it
    await expect(scopeBar(page)).toBeVisible();
    await expect(groupSelect(page, 'Paid Search')).toBeVisible();
    await expect(platformSelect(page)).toBeVisible();

    await page.getByRole('button', { name: 'Clear location' }).click();
    await waitForOverview(page);
    await expect(groupSelect(page, 'Paid Search')).toBeVisible();
  });
});
