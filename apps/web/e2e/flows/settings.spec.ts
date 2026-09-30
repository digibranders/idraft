import { expect, test } from '@playwright/test';

import { LIVE_REGION_ID } from '../../src/lib/a11y/announcer';
import { MOCK_PASSWORD } from '../../src/mocks/fixtures';
import { expectAccessible, signIn, watchPolicy } from '../support';

test.describe('account settings', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'priya@digibranders.test');
    await expect(page).toHaveURL(/\/digibranders$/);
  });

  test('Profile saves a new name through the save bar', async ({ page }) => {
    const policy = watchPolicy(page);
    await page.goto('/digibranders/fynix/settings/profile');
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('Priya N.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    // Said in the polite live region, not in a toast (10-forms.md section 13.2)
    await expect(page.locator(`#${LIVE_REGION_ID.polite}`)).toHaveText('Name saved');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Priya N.');
    await expectAccessible(page);
    expect(policy.violations).toEqual([]);
  });

  test('Security changes the password and lists the sessions', async ({ page }) => {
    await page.goto('/digibranders/fynix/settings/security');
    await expect(page.getByRole('table', { name: 'Active sessions' })).toBeVisible();
    await page.getByRole('button', { name: 'Change password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await dialog.getByRole('textbox', { name: 'Current password', exact: true }).fill(MOCK_PASSWORD);
    await dialog.getByRole('textbox', { name: 'New password', exact: true }).fill('a-new-long-passphrase');
    await dialog.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('a-new-long-passphrase');
    await dialog.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible();
    // Checked once the dialog has faded out: axe reads the colors of a fading dialog as low contrast
    await expect(dialog).toBeHidden();
    await expectAccessible(page);
  });

  test('Preferences apply at once: reduce motion reaches the page', async ({ page }) => {
    await page.goto('/digibranders/fynix/settings/preferences');
    await page.getByRole('switch', { name: 'Reduce motion' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeChecked();
    await expectAccessible(page);
  });
});
