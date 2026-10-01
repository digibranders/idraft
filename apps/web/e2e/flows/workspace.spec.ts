import { expect, test } from '@playwright/test';

import { MOCK_PASSWORD } from '../../src/mocks/fixtures';
import { ageSession, expectAccessible, signIn } from '../support';

const ADMIN = 'tomas@digibranders.test';
const EDITOR = 'priya@digibranders.test';
const ANALYST = 'jonas@digibranders.test';
// The owner fixture is a platform operator, with a second sign-in step
const OPERATOR = 'ana@digibranders.test';

test.describe('setting up the workspace', () => {
  test('an admin invites someone, sees the invitation wait, and withdraws it', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/settings/members');
    await expect(page.getByRole('table', { name: 'Members' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Invite people' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await dialog.getByRole('textbox', { name: 'Email' }).fill('new.client@example.test');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog).toBeHidden();
    const invitations = page.getByRole('table', { name: 'Pending invitations' });
    await expect(invitations.getByText('new.client@example.test')).toBeVisible();
    await invitations.getByRole('button', { name: 'Withdraw the invitation for new.client@example.test' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Withdraw the invitation for new.client@example.test?' });
    await confirm.getByRole('button', { name: 'Withdraw invitation' }).click();
    await expect(invitations.getByText('new.client@example.test')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Invitations' })).toBeFocused();
  });

  test('an admin changes a member’s role, and the table says so after a reload', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/settings/members');
    await page.getByRole('button', { name: 'Actions for Mei Chen' }).click();
    await page.getByRole('menuitem', { name: 'Change role and access' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change role and access' });
    await dialog.getByRole('radio', { name: /^Analyst/ }).check();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    const row = page.getByRole('row', { name: /Mei Chen/ });
    await expect(row.getByText('Analyst')).toBeVisible();
  });

  test('an admin whose sign-in is old confirms it is them, and the change goes through', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/settings/members');
    await expect(page.getByRole('table', { name: 'Members' })).toBeVisible();
    await ageSession(page);
    await page.getByRole('button', { name: 'Actions for Mei Chen' }).click();
    await page.getByRole('menuitem', { name: 'Change role and access' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change role and access' });
    await dialog.getByRole('radio', { name: /^Editor/ }).check();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(confirm).toBeVisible();
    await expectAccessible(page);
    await confirm.getByRole('textbox', { name: 'Password', exact: true }).fill(MOCK_PASSWORD);
    await confirm.getByRole('button', { name: 'Confirm' }).click();
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: /Mei Chen/ }).getByText('Editor')).toBeVisible();
  });

  test('an editor creates a project and lands on it', async ({ page }) => {
    await signIn(page, EDITOR);
    await expect(page).toHaveURL(/\/digibranders$/);
    await page.getByRole('link', { name: 'New project' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Northwind Traders');
    await page.getByRole('textbox', { name: 'Site' }).fill('northwind-traders.example');
    await expect(page.getByRole('textbox', { name: 'Address' })).toHaveValue('northwind-traders');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/digibranders\/northwind-traders(\/|$)/);
    await page.goto('/digibranders');
    await expect(page.getByRole('link', { name: 'Northwind Traders' })).toBeVisible();
  });

  test('an operator creates a workspace from the account menu and lands on it', async ({ page }) => {
    await signIn(page, OPERATOR, { code: true });
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Create a workspace' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('textbox', { name: 'Name' }).fill('Second Agency');
    await expect(page.getByRole('textbox', { name: 'Address' })).toHaveValue('second-agency');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/second-agency$/);
  });

  test('an admin gives the workspace a new address, and the page follows it', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/settings/workspace');
    await expectAccessible(page);
    const address = page.getByRole('textbox', { name: 'Address' });
    await address.fill('digibranders-agency');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/digibranders-agency\/fynix\/settings\/workspace$/);
    await expect(page.getByRole('textbox', { name: 'Address' })).toHaveValue('digibranders-agency');
  });

  test('an analyst sees the project and workspace settings read-only', async ({ page }) => {
    await signIn(page, ANALYST);
    await page.goto('/digibranders/fynix/settings/general');
    await expect(page.getByText('Owners, admins and editors can change project settings.')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expectAccessible(page);
    await page.goto('/digibranders/fynix/settings/workspace');
    await expect(page.getByText('Owners and admins can change workspace settings.')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.goto('/digibranders/fynix/settings/members');
    await expect(page.getByText('Owners and admins can manage members.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
    await expectAccessible(page);
  });
});
