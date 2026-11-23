import { expect, type Locator, type Page } from '@playwright/test';

import { canvasOf, expectNoEquity, openLinks } from './internal-links';

export { THEME_STORAGE_KEY } from './internal-links';

/** The names the Changes, Opportunities and Path finder tabs give their parts, as the catalog words them. */
export const lostTable = (page: Page): Locator => page.getByRole('table', { name: 'Lost links' });
export const opportunitiesGrid = (page: Page): Locator => page.getByRole('grid', { name: 'Link opportunities' });
export const crawlButton = (page: Page): Locator => page.getByRole('button', { name: /^Crawled .+, \d+ pages?$/ });
export const alertDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Alert rules' });
export const suggestionsTable = (page: Page): Locator => page.getByRole('table', { name: 'Suggested tiers' });
export const anyRoute = (page: Page): Locator => page.getByRole('heading', { name: /^Over any link/ });
export const editorialRoute = (page: Page): Locator =>
  page.getByRole('heading', { name: /^Over editorial links only/ });
/** The alert banner's sentence about links lost to the important tiers. */
export const lostAlert = (page: Page): Locator => page.getByText(/editorial links? to T1 and T2 pages (was|were) lost/);

export async function openChanges(page: Page): Promise<void> {
  await openLinks(page, 'tab=changes');
  await expect(lostTable(page)).toBeVisible();
}

export async function openOpportunities(page: Page): Promise<void> {
  await openLinks(page, 'tab=opportunities');
  await expect(opportunitiesGrid(page).getByRole('rowheader').first()).toBeVisible();
}

export async function openPathFinder(page: Page, focus = '103'): Promise<void> {
  await openLinks(page, `tab=journey&jv=paths&focus=${focus}`);
  await expect(anyRoute(page)).toBeVisible();
}

/** The journey on the By tier layout: lanes of tiers, each with its page count. */
export async function openTierCanvas(page: Page): Promise<void> {
  await openLinks(page, 'tab=journey&focus=103');
  await expect(canvasOf(page).getByRole('button', { name: /focus page$/ })).toBeVisible();
  await page.getByRole('radio', { name: 'By tier' }).click();
  await expect(page.getByRole('radio', { name: 'By tier' })).toBeChecked();
  await expect(canvasOf(page).getByRole('heading', { level: 3 }).first()).toBeVisible();
}

/** Sets the alert threshold in the alert rules dialog and saves it. */
export async function saveAlertThreshold(page: Page, threshold: number): Promise<void> {
  await page.getByRole('button', { name: 'Change alert rules' }).click();
  const dialog = alertDialog(page);
  await dialog.getByRole('textbox', { name: 'Lost links that raise an alert' }).fill(String(threshold));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Alert rules saved')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expectNoEquity(page);
}
