import { expect, test, type Locator, type Page } from '@playwright/test';

import { LIVE_REGION_ID } from '../../src/lib/a11y/announcer';
import { expectAccessible, signIn, watchPolicy } from '../support';

/** An editor holds `schedules:write` and `projects:write`; a viewer reads both screens and changes nothing. */
const EDITOR = 'priya@digibranders.test';
const VIEWER = 'mei@digibranders.test';

const SCHEDULES = '/digibranders/fynix/settings/schedules';
const GENERAL = '/digibranders/fynix/settings/general';

async function choose(page: Page, scope: Locator, field: string | RegExp, option: string | RegExp): Promise<void> {
  await scope.getByRole('combobox', typeof field === 'string' ? { name: field, exact: true } : { name: field }).click();
  await page.getByRole('option', typeof option === 'string' ? { name: option, exact: true } : { name: option }).click();
}

const rowOf = (page: Page, name: string): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${name}`) }) });

async function openMenu(page: Page, schedule: string, item: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${schedule}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('schedules and keyword defaults', () => {
  test('an editor makes a schedule, pauses and resumes it, changes it and deletes it', async ({ page }) => {
    const policy = watchPolicy(page);
    await signIn(page, EDITOR);
    await page.goto(SCHEDULES);
    await expect(page.getByRole('heading', { level: 2, name: 'Schedules' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Schedules of this project' });
    await expect(table.getByText('Every day at 02:00, 6 hour window')).toBeVisible();
    await expectAccessible(page);

    // Make a weekly rank schedule for the Local group
    await page.getByRole('button', { name: 'New schedule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New schedule' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Local ranks');
    await choose(page, dialog, 'What to collect', 'SEO rank');
    await choose(page, dialog, 'Repeats', 'Every week');
    await choose(page, dialog, 'On', 'Wednesday');
    await dialog.getByRole('radio', { name: /^Groups and terms/ }).click();
    await dialog.getByRole('combobox', { name: /^Groups/ }).click();
    await page.getByRole('option', { name: 'Local' }).click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Create schedule' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Local ranks created')).toBeVisible();
    const row = rowOf(page, 'Local ranks');
    await expect(row.getByText('Every Wednesday at 02:00, 6 hour window')).toBeVisible();
    await expect(row.getByText('Groups: Local')).toBeVisible();

    // Pause, then resume: the toast says when it runs next
    await openMenu(page, 'Local ranks', 'Pause');
    await expect(row.getByText('Paused')).toBeVisible();
    await openMenu(page, 'Local ranks', 'Resume');
    await expect(page.getByText('Local ranks resumed')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Local ranks resumed' }).getByText(/^Next run /)).toBeVisible();
    await expect(row.getByText('Paused')).toBeHidden();

    // Change the window and nothing else
    await openMenu(page, 'Local ranks', 'Edit');
    const edit = page.getByRole('dialog', { name: 'Edit Local ranks' });
    await choose(page, edit, 'Window', '4 hours');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    await expect(row.getByText('Every Wednesday at 02:00, 4 hour window')).toBeVisible();

    // Delete it after the question
    await openMenu(page, 'Local ranks', 'Delete');
    const confirm = page.getByRole('alertdialog', { name: 'Delete Local ranks?' });
    await expect(confirm.getByText(/Its past runs stay in Runs\.$/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete schedule' }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText('Local ranks deleted')).toBeVisible();
    await expectAccessible(page);
    expect(policy.violations).toEqual([]);
  });

  test('the keyword defaults are saved on their own and are still there after a reload', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto(GENERAL);
    const section = page.getByRole('region', { name: 'Keyword defaults' });
    await expect(section.getByRole('combobox', { name: 'Default device' })).toContainText('Desktop');
    await expect(section.getByRole('button', { name: 'Save defaults' })).toBeHidden();
    await choose(page, section, 'Default device', 'Desktop and mobile');
    await choose(page, section, 'Default depth profile', /^Deep/);
    await section.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.locator(`#${LIVE_REGION_ID.polite}`)).toHaveText('Keyword defaults saved');
    await expect(section.getByRole('button', { name: 'Save defaults' })).toBeHidden();
    await page.reload();
    await expect(section.getByRole('combobox', { name: 'Default device' })).toContainText('Desktop and mobile');
    await expect(section.getByRole('combobox', { name: 'Default depth profile' })).toContainText('Deep');
    await expectAccessible(page);
  });

  test('a viewer sees the schedules and the defaults and has nothing to change', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(SCHEDULES);
    await expect(page.getByText('Owners, admins and editors can change schedules.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Schedules of this project' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New schedule' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(GENERAL);
    const section = page.getByRole('region', { name: 'Keyword defaults' });
    await expect(section.getByText('Standard')).toBeVisible();
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await expectAccessible(page);
  });
});
