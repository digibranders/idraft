import { writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { expectAccessible, signIn } from '../support';

const EDITOR = 'priya@digibranders.test';

test.describe('rankings', () => {
  test('a project opens on Rankings, and a filter and the archived view live in the URL', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix');
    await expect(page).toHaveURL(/\/digibranders\/fynix\/seo\/rankings$/);
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(grid.getByRole('rowheader').first()).toContainText('seo agency');
    await expect(page.getByText('59 keywords', { exact: true })).toBeVisible();
    await expectAccessible(page);

    // Intent: Commercial through the chip editor
    await page.getByRole('button', { name: 'Add a filter' }).click();
    // The field picker, not the Intent column's header
    await page.getByRole('dialog').getByRole('button', { name: 'Intent' }).click();
    await page.getByRole('dialog').getByRole('checkbox', { name: 'Commercial' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/[?&]intent=commercial/);
    await expect(page.getByRole('button', { name: 'Intent: Commercial. Edit filter' })).toBeVisible();
    await expect(page.getByText('24 keywords', { exact: true })).toBeVisible();

    // The archived view, kept across a reload
    await page.getByRole('button', { name: 'Remove filter Intent: Commercial' }).click();
    await page.getByRole('radio', { name: 'Archived' }).click();
    await expect(page).toHaveURL(/[?&]archived=true/);
    await page.reload();
    await expect(page.getByText('3 keywords', { exact: true })).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: /seo meme/ })).toBeVisible();
    await expectAccessible(page);
  });

  test('a keyword opens in the inspector, steps with J, and saves a setting in place', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await grid.getByRole('rowheader').first().click();
    const inspector = page.getByRole('complementary', { name: 'seo agency' });
    await expect(inspector).toBeVisible();
    await expect(page).toHaveURL(/[?&]inspect=keyword%3A|[?&]inspect=keyword:/);
    await expect(inspector.getByText('1 of 59')).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'Search volume by month' })).toBeVisible();
    await expectAccessible(page);

    await page.keyboard.press('j');
    const next = page.getByRole('complementary', { name: 'backlink checker' });
    await expect(next.getByText('2 of 59')).toBeVisible();

    await next.getByRole('button', { name: 'Edit Tracking' }).click();
    await next.getByRole('combobox', { name: 'Priority' }).click();
    await page.getByRole('option', { name: '2' }).click();
    await next.getByRole('button', { name: 'Save' }).click();
    await expect(next.getByRole('button', { name: 'Save' })).toBeHidden();
    await expect(next.getByText('2', { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test('chosen keywords get a new priority from the bulk bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('checkbox', { name: 'Select seo agency', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select backlink checker', exact: true }).click();
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    await expect(bar.getByText('2 selected')).toBeVisible();
    await bar.getByRole('button', { name: 'Set priority' }).click();
    const dialog = page.getByRole('dialog', { name: 'Priority for 2 keywords' });
    await dialog.getByRole('combobox', { name: 'Priority' }).click();
    await page.getByRole('option', { name: '5, lowest' }).click();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Set for 2 keywords' }).click();
    await expect(page.getByText('Priority 5 set for 2 keywords')).toBeVisible();
    await expect(bar).toBeHidden();
  });

  test('a group is created while moving keywords, then renamed in Manage groups', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('checkbox', { name: 'Select seo agency', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select backlink checker', exact: true }).click();
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    await bar.getByRole('button', { name: 'Move to group' }).click();
    const move = page.getByRole('dialog', { name: 'Move 2 keywords' });
    await move.getByRole('combobox', { name: 'Group' }).fill('E2E/Group');
    await page.getByRole('option', { name: 'Create group "E2E/Group"' }).click();
    await expectAccessible(page);
    await move.getByRole('button', { name: 'Move 2 keywords' }).click();
    await expect(page.getByText('2 keywords moved to E2E/Group')).toBeVisible();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Manage groups' }).click();
    const manage = page.getByRole('dialog', { name: 'Manage groups' });
    const tree = manage.getByRole('tree', { name: 'Keyword groups' });
    await tree.getByRole('treeitem', { name: 'E2E' }).click();
    await page.keyboard.press('ArrowRight');
    await tree.getByRole('treeitem', { name: 'Group', exact: true }).click();
    await manage.getByRole('button', { name: 'Rename' }).click();
    await manage.getByRole('textbox', { name: 'Rename Group' }).fill('Renamed');
    await expectAccessible(page);
    await manage.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Group renamed to Renamed')).toBeVisible();
    await expect(tree.getByRole('treeitem', { name: 'Renamed' })).toHaveAttribute('aria-selected', 'true');
    await manage.getByRole('button', { name: 'Close' }).last().click();
    await expect(manage).toBeHidden();
  });

  test('keywords are added from the header, and appear pending until their metrics arrive', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('button', { name: 'Add keywords' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add keywords' });
    await dialog.getByRole('textbox', { name: 'Keywords' }).fill('seo reporting tool\nSEO Reporting Tool');
    await expect(dialog.getByText('1 keyword · 1 repeat left out')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Add 1 keyword' }).click();
    await expect(page.getByText('1 keyword added')).toBeVisible();
    await page.getByRole('searchbox', { name: /Search/ }).fill('seo reporting');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(grid.getByRole('rowheader', { name: /seo reporting tool/ })).toBeVisible();
    await expect(grid.getByText('Pending').first()).toBeVisible();
  });

  test('keywords are imported from a CSV file, and the write is followed in the header', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(page.getByText('59 keywords', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page).toHaveURL(/\/seo\/rankings\/import$/);
    const dialog = page.getByRole('dialog', { name: 'Import keywords' });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);

    // Three new keywords and one that Fynix tracks already
    const file = testInfo.outputPath('keywords.csv');
    writeFileSync(
      file,
      'keyword,tags\nimport test one,e2e\nimport test two,e2e\nseo audit,e2e\nimport test three,e2e\n',
    );
    await dialog.locator('input[type="file"]').setInputFiles(file);
    await expect(dialog.getByText(/^keywords\.csv, /)).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    // The file's columns, read in the browser; the tags need the vocabulary they belong to
    await expect(dialog.getByText(/^Choose what each column of the file holds/)).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'keyword' })).toContainText('Keyword');
    await expect(dialog.getByText('Choose the vocabulary these terms belong to.')).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Vocabulary for tags' }).click();
    await page.getByRole('option', { name: 'Topics' }).click();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Continue' }).click();

    const summary = dialog.getByRole('group', { name: 'Rows by outcome' });
    await expect(summary).toContainText('New3');
    await expect(summary).toContainText('Duplicate1');
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('3 keywords are tracked')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Import 3 keywords' }).click();

    // The dialog is gone, the table stays, and the header follows the write until the report is ready
    await expect(page).toHaveURL(/\/seo\/rankings$/);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
    await expect(page.getByRole('progressbar', { name: 'Importing keywords' })).toBeVisible();
    await expect(page.getByText('Import finished: 3 added, 1 skipped')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('progressbar', { name: 'Importing keywords' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Download report' })).toBeVisible();

    await page.getByRole('searchbox', { name: /Search/ }).fill('import test');
    await expect(grid.getByRole('rowheader', { name: /import test one/ })).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: /import test three/ })).toBeVisible();
  });
});
