import { expect, test } from '@playwright/test';

import { expectAccessible, signIn } from '../support';

const EDITOR = 'priya@digibranders.test';
const ANALYST = 'jonas@digibranders.test';

test.describe('entities, domains and taxonomy', () => {
  test('an editor creates a project with its site, location and brand', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto('/digibranders/onboarding');
    await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Acme Studio');
    await page.getByRole('textbox', { name: 'Site' }).fill('https://www.acme-studio.example/about');
    await expect(page.getByText('Will track: acme-studio.example (path /about ignored)')).toBeVisible();
    await page.getByRole('combobox', { name: /^Location/ }).fill('Ger');
    await page.getByRole('option', { name: /^Germany/ }).click();
    await expect(page.getByRole('textbox', { name: 'Brand name' })).toHaveValue('Acme Studio');
    await page.getByRole('combobox', { name: /^Other names/ }).fill('Acme');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/digibranders\/acme-studio(\/|$)/);
    await page.goto('/digibranders/acme-studio/settings/entities');
    await expect(
      page.getByRole('table', { name: 'Own brand' }).getByRole('link', { name: 'Acme Studio' }),
    ).toBeVisible();
    await page.goto('/digibranders/acme-studio/settings/general');
    await expect(page.getByRole('combobox', { name: /^Location/ })).toHaveValue('Germany');
  });

  test('an editor adds a competitor, opens its editor and tests an alias', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/settings/entities');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Add competitor' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add competitor' });
    await dialog.getByRole('textbox', { name: 'Domain' }).fill('hubspot.com');
    await dialog.getByRole('button', { name: 'Add competitor' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('table', { name: 'Competitors' }).getByRole('link', { name: 'Hubspot' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Hubspot' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Add alias' }).click();
    const aliasDialog = page.getByRole('dialog', { name: 'Add an alias to Hubspot' });
    await aliasDialog.getByRole('textbox', { name: 'Alias' }).fill('HubSpot CRM');
    await aliasDialog.getByRole('button', { name: 'Add alias' }).click();
    await expect(aliasDialog).toBeHidden();
    await page.getByRole('textbox', { name: 'Sample answer' }).fill('Most agencies start with HubSpot CRM or Fynix.');
    await expect(page.getByLabel(/^Hubspot mention/)).toBeVisible();
    await expect(page.getByLabel(/^Fynix mention/)).toBeVisible();
  });

  test('an editor builds a topic and moves it', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/settings/taxonomy');
    const tree = page.getByRole('tree', { name: 'Terms of Topics' });
    await expect(tree).toBeVisible();
    await expectAccessible(page);
    await tree.getByRole('treeitem', { name: 'SEO', exact: true }).click();
    await page.getByRole('button', { name: 'Add under SEO' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a term under SEO' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Enterprise SEO');
    await dialog.getByRole('button', { name: 'Add term' }).click();
    await expect(tree.getByRole('treeitem', { name: 'Enterprise SEO' })).toHaveAttribute('aria-level', '2');
    await page.getByRole('button', { name: 'Move to' }).click();
    const move = page.getByRole('dialog', { name: 'Move Enterprise SEO' });
    await move.getByRole('combobox', { name: 'New place' }).click();
    await page.getByRole('option', { name: 'Top level' }).click();
    await move.getByRole('button', { name: 'Move' }).click();
    await expect(tree.getByRole('treeitem', { name: 'Enterprise SEO' })).toHaveAttribute('aria-level', '1');
  });

  test('an analyst sees entities, domains and taxonomy read-only', async ({ page }) => {
    await signIn(page, ANALYST);
    await page.goto('/digibranders/fynix/settings/entities');
    await expect(page.getByText('Owners, admins and editors can change the entities of a project.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add competitor' })).toHaveCount(0);
    await page.goto('/digibranders/fynix/settings/domains');
    await expect(page.getByRole('table', { name: 'Own brand' })).toBeVisible();
    await expectAccessible(page);
    await page.goto('/digibranders/fynix/settings/taxonomy');
    await expect(page.getByText('Owners, admins and editors can change the taxonomy.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add term' })).toHaveCount(0);
  });
});
