import { expect, test, type Locator, type Page } from '@playwright/test';

import { LIVE_REGION_ID } from '../../src/lib/a11y/announcer';
import { expectAccessible, signIn } from '../support';

/**
 * AI settings of WP-31 in the production build with every API route mocked: the Engines page (class badges, the
 * Perplexity row, the cost change summary, the device of Google AI Mode), Data retention and the Added column of
 * Entities, as an editor who may change them and as a viewer who may not.
 *
 * Two things this flow does not do, and why:
 * - It does not reload to prove the device is kept. The mock keeps the engines in the memory of the page, so a
 *   reload starts again from the fixtures (the shortcut noted in src/mocks/prompts-state.ts). The device is proven
 *   kept by leaving Engines through the settings navigation and coming back: the list is read again from the mock's
 *   memory, which only holds Mobile if the PUT stored it and the GET returned it.
 * - It does not look for the setup checklist. `AiSetupChecklist` is built and tested in features/onboarding, but no
 *   page mounts it until Overview goes live (WP-33, WP-40), so there is nothing to open.
 *
 * Every save is waited for before the next click: the toast (turn on) and the polite live region (device) are said
 * only after the list was read again, so the device control is never clicked while a save is still under way.
 * Axe runs at 390 and 1280 px; the Added column is hidden below 768 px, so it is read at 1280 px.
 */
const EDITOR = 'priya@digibranders.test';
const VIEWER = 'mei@digibranders.test';
const ENGINES = '/digibranders/fynix/settings/engines';
const AI_MODE = 'Google AI Mode';
const DEVICE_GROUP = `Device of ${AI_MODE}`;
const POLITE_REGION = `#${LIVE_REGION_ID.polite}`;
const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;

/** The four kinds of raw data and how long each is kept (doc 23 section 9.2, backend storage/raw.py). */
const RETENTION: readonly (readonly [string, string])[] = [
  ['Search results', '400 days'],
  ['AI answers', 'Kept indefinitely'],
  ['Search Console and other first-party imports', '90 days'],
  ['Error responses', '30 days'],
];

const settingsNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Settings sections' });
const enginesRegion = (page: Page): Locator => page.getByRole('region', { name: 'Engines' });
const engineRow = (page: Page, name: string): Locator =>
  enginesRegion(page).getByRole('listitem').filter({ hasText: name }).first();

/** Axe clean at 390 and 1280 px, with no horizontal scroll on the phone; ends at 1280 px. */
async function expectAccessibleAtBothWidths(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await expectAccessible(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize(DESKTOP);
  await expectAccessible(page);
}

/** Opens a section of the settings navigation as a link, since a page load would clear the mock's memory. */
async function openSection(page: Page, name: string, heading: string): Promise<void> {
  await settingsNav(page).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
}

test.describe('AI settings', () => {
  test('an editor reads the engines, turns Google AI Mode on, sets its device, then reads retention and the Added column', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, EDITOR);
    await page.goto(ENGINES);
    await expect(enginesRegion(page)).toBeVisible();

    // Three engines, each with its class; the Perplexity API is listed and cannot be turned on
    await expect(engineRow(page, 'ChatGPT')).toContainText(/Class:\s*Consumer UI/);
    await expect(engineRow(page, 'Gemini')).toContainText(/Class:\s*Consumer UI/);
    await expect(engineRow(page, AI_MODE)).toContainText(/Class:\s*SERP AI/);
    const perplexity = engineRow(page, 'Perplexity API');
    await expect(perplexity).toContainText('Not available yet');
    await expect(perplexity).toContainText(/Class:\s*Official API/);
    await expect(perplexity.getByRole('switch')).toBeDisabled();
    await expect(perplexity.getByRole('switch')).not.toBeChecked();

    // Fynix has ChatGPT and Gemini on: no summary until a switch changes
    await expect(page.getByText(/^Estimated cost change:/)).toHaveCount(0);
    const aiMode = page.getByRole('switch', { name: AI_MODE });
    await expect(aiMode).not.toBeChecked();
    // The countries have loaded when the project's own one is chosen: turning on needs one
    await expect(engineRow(page, AI_MODE).getByText('Germany', { exact: true })).toBeVisible();
    await aiMode.click();
    const confirm = page.getByRole('alertdialog', { name: `Turn on ${AI_MODE}?` });
    await expect(confirm.getByText(/starts scheduled spend from the next run/)).toBeVisible();
    await confirm.getByRole('button', { name: `Turn on ${AI_MODE}` }).click();
    // Said after the list was read again: the save has settled
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText(`${AI_MODE} is on`)).toBeVisible();
    await expect(aiMode).toBeChecked();
    // Three engines are on now, and the estimate says how much the switch added to the month
    await expect(
      page.getByText(
        /^Estimated cost change: about \$[\d,.]+ a month more\. Estimated total for 3 engines that are on: \$[\d,.]+ a month\. Estimate from the price book\.$/,
      ),
    ).toBeVisible();

    // The device is a radio group on Google AI Mode only
    await expect(page.getByRole('group', { name: DEVICE_GROUP })).toBeVisible();
    await expect(page.getByRole('group', { name: /^Device of (ChatGPT|Gemini)$/ })).toHaveCount(0);
    const device = page.getByRole('group', { name: DEVICE_GROUP });
    await expect(device.getByRole('radio', { name: 'Desktop' })).toBeChecked();
    await device.getByRole('radio', { name: 'Mobile' }).click();
    await expect(page.locator(POLITE_REGION)).toHaveText(`Device of ${AI_MODE} set to Mobile.`);
    await expect(device.getByRole('radio', { name: 'Mobile' })).toBeChecked();
    await expectAccessibleAtBothWidths(page);

    // Data retention: read only, the four periods
    await openSection(page, 'Data retention', 'Data retention');
    await expect(page.getByText('Retention is set by the platform and cannot be changed here.')).toBeVisible();
    const retention = page.getByRole('table', { name: 'Retention of raw data by kind' });
    for (const [data, period] of RETENTION) {
      await expect(retention.getByRole('row').filter({ hasText: data })).toContainText(period);
    }
    await expect(retention.getByRole('row')).toHaveCount(RETENTION.length + 1);
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    // Back on Engines the list is read again: the engine is still on and the device is still Mobile
    await openSection(page, 'Engines', 'Engines');
    await expect(page.getByRole('switch', { name: AI_MODE })).toBeChecked();
    await expect(page.getByRole('group', { name: DEVICE_GROUP }).getByRole('radio', { name: 'Mobile' })).toBeChecked();

    // Entities: each role shows the date it was added, and Competitors say what the date means
    await openSection(page, 'Entities and aliases', 'Entities and aliases');
    const own = page.getByRole('table', { name: 'Own brand' });
    await expect(own.getByRole('columnheader', { name: 'Added' })).toBeVisible();
    await expect(own.locator('td[title]').last()).toHaveText(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/);
    await expect(
      page.getByText(
        'Share of voice counts a competitor from the date it was added. Adding or removing one changes share of voice for all entities from that day.',
      ),
    ).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });

  test('a viewer reads the engines, the retention periods and the entities and has nothing to change', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, VIEWER);
    await page.goto(ENGINES);
    await expect(enginesRegion(page)).toBeVisible();
    await expect(page.getByText('Owners, admins and editors can turn engines on and off.')).toBeVisible();
    for (const name of ['ChatGPT', 'Gemini', AI_MODE, 'Perplexity API']) {
      await expect(page.getByRole('switch', { name })).toBeDisabled();
    }
    await expect(engineRow(page, AI_MODE)).toContainText(/Class:\s*SERP AI/);
    // The device is shown, with its choice, and cannot be changed
    const device = page.getByRole('group', { name: DEVICE_GROUP });
    await expect(device.getByRole('radio', { name: 'Desktop' })).toBeChecked();
    await expect(device.getByRole('radio', { name: 'Desktop' })).toBeDisabled();
    await expect(device.getByRole('radio', { name: 'Mobile' })).toBeDisabled();
    await expect(page.getByText(/^Estimated cost change:/)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    await openSection(page, 'Data retention', 'Data retention');
    const retention = page.getByRole('table', { name: 'Retention of raw data by kind' });
    for (const [data, period] of RETENTION) {
      await expect(retention.getByRole('row').filter({ hasText: data })).toContainText(period);
    }
    await expectAccessibleAtBothWidths(page);

    await openSection(page, 'Entities and aliases', 'Entities and aliases');
    await expect(
      page.getByRole('table', { name: 'Own brand' }).getByRole('columnheader', { name: 'Added' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add competitor' })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });
});
