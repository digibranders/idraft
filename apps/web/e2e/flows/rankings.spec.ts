import { writeFileSync } from 'node:fs';

import { expect, test, type Locator } from '@playwright/test';

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

  test('a setting saved in the inspector is still there after a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await grid.getByRole('rowheader').first().click();
    const inspector = page.getByRole('complementary', { name: 'seo agency' });
    await inspector.getByRole('button', { name: 'Edit Tracking' }).click();
    await inspector.getByRole('textbox', { name: 'Target URL' }).fill('https://fynix.example/seo-agency');
    await inspector.getByRole('button', { name: 'Save' }).click();
    await expect(inspector.getByRole('button', { name: 'Save' })).toBeHidden();
    await expect(inspector.getByText('https://fynix.example/seo-agency', { exact: true })).toBeVisible();

    // The URL still names the keyword, so the inspector opens on it again; the target comes from the API
    await page.reload();
    const reopened = page.getByRole('complementary', { name: 'seo agency' });
    await expect(reopened.getByText('https://fynix.example/seo-agency', { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test('chosen keywords get a new priority from the bulk bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('checkbox', { name: 'Select seo agency, desktop, United States', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
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

  test('the bulk bar at 1280 px with the inspector open keeps every action in sight, Archive and Delete in the More menu', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await grid.getByRole('rowheader').first().click();
    await expect(page.getByRole('complementary', { name: 'seo agency' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    await expect(bar.getByText('1 selected')).toBeVisible();

    // Every control the bar shows is inside it and in view, so none is clipped yet reachable by Tab
    const barBox = await bar.boundingBox();
    if (barBox === null) throw new Error('The bulk bar has no box');
    for (const button of await bar.getByRole('button').all()) {
      const box = await button.boundingBox();
      if (box === null) throw new Error('A button of the bulk bar has no box');
      expect(box.x).toBeGreaterThanOrEqual(barBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);
      await expect(button).toBeInViewport({ ratio: 1 });
    }

    // What did not fit is in the More menu, with Delete last
    await bar.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    const items = await page.getByRole('menuitem').allTextContents();
    expect(items.at(-1)).toBe('Delete');
    await page.keyboard.press('Escape');
    await expectAccessible(page);
  });

  test('chosen keywords move to a group, are archived, and come back with Undo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    const grid = page.getByRole('grid', { name: 'Tracked keywords' });
    await expect(page.getByText('59 keywords', { exact: true })).toBeVisible();
    const rowOf = (keyword: string): Locator =>
      grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${keyword}`) }) });
    const bar = page.getByRole('group', { name: /Bulk actions/ });
    const choose = async (): Promise<void> => {
      await page.getByRole('checkbox', { name: 'Select seo agency, desktop, United States', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
      await expect(bar.getByText('2 selected')).toBeVisible();
    };

    // Neither keyword is in a group; the move puts both in Brand, an existing one
    await expect(rowOf('backlink checker')).not.toContainText('Brand');
    await choose();
    await bar.getByRole('button', { name: 'Move to group' }).click();
    const move = page.getByRole('dialog', { name: 'Move 2 keywords' });
    await move.getByRole('combobox', { name: 'Group' }).click();
    await page.getByRole('option', { name: /^Brand/ }).click();
    await move.getByRole('button', { name: 'Move 2 keywords' }).click();
    await expect(page.getByText('2 keywords moved to Brand')).toBeVisible();
    await expect(rowOf('backlink checker')).toContainText('Brand');
    await expect(rowOf('seo agency').first()).toContainText('Brand');

    // Archiving needs no question below 100 keywords: the rows leave and the toast offers Undo
    await choose();
    await bar.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('2 keywords archived')).toBeVisible();
    await expect(page.getByText('57 keywords', { exact: true })).toBeVisible();
    await expect(rowOf('backlink checker')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('2 keywords unarchived')).toBeVisible();
    await expect(page.getByText('59 keywords', { exact: true })).toBeVisible();
    await expect(rowOf('backlink checker')).toContainText('Brand');
    await expectAccessible(page);
  });

  test('a group is created while moving keywords, then renamed in Manage groups', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await page.getByRole('checkbox', { name: 'Select seo agency, desktop, United States', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select backlink checker, desktop, Germany', exact: true }).click();
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

  test('keywords are added from the header, appear pending, and fill with metrics once they arrive', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    // The mocks read the page's clock: Labs answers 2 minutes after a keyword is added, and the screen asks
    // again every 30 seconds while a row waits. The clock is moved by hand instead of waited for.
    await page.clock.install();
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
    const row = grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /seo reporting tool/ }) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Pending').first()).toBeVisible();

    // The 2 minutes pass: the next poll brings the metrics, and the row stops waiting
    await page.clock.runFor(150_000);
    await expect(row.getByText('Pending')).toHaveCount(0);
    await expect(row.getByRole('gridcell').filter({ hasText: /^\d[\d,]*$/ })).not.toHaveCount(0);
  });

  test('metrics are refreshed from More actions, and the run is followed in the header', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings');
    await expect(page.getByText('59 keywords', { exact: true })).toBeVisible();

    // The menu says how many manual runs the project has left today
    await page.getByRole('button', { name: 'More actions' }).click();
    const item = page.getByRole('menuitem', { name: /Refresh metrics/ });
    await expect(item).toContainText('20 of 20 left today');
    await expect(page.getByRole('menuitem', { name: 'Manage groups' })).toBeVisible();
    await item.click();

    const dialog = page.getByRole('dialog', { name: 'Refresh metrics' });
    await expect(dialog.getByRole('radio', { name: 'All keywords with stale metrics' })).toBeChecked();
    await expect(dialog.getByText('20 of 20 manual runs left today.')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Refresh metrics' }).click();
    await expect(dialog).toBeHidden();

    // Queued at once, then running; the run ends with one toast
    // (the live region says it aloud too, so the header is named)
    const header = page.locator('#main-content');
    await expect(header.getByText('Metrics refresh queued')).toBeVisible();
    await expect(header.getByText('Refreshing metrics')).toBeVisible({ timeout: 15_000 });
    await expectAccessible(page);
    await expect(page.getByText(/^Metrics refreshed: \d+ of \d+ read$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('progressbar')).toBeHidden();

    // The day's count moved on with the run
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Refresh metrics/ })).toContainText('19 of 20 left today');
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

  test('the review step lists an invalid row with its reason and a duplicate, and the choice changes the outcome', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/rankings/import');
    const dialog = page.getByRole('dialog', { name: 'Import keywords' });
    await expect(dialog).toBeVisible();

    // One new keyword, one search operator (not tracked) and one that Fynix tracks already
    const file = testInfo.outputPath('review.csv');
    writeFileSync(file, 'keyword\nimport review one\nsite:fynix.example\nseo audit\n');
    await dialog.locator('input[type="file"]').setInputFiles(file);
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText(/^Choose what each column of the file holds/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    const summary = dialog.getByRole('group', { name: 'Rows by outcome' });
    await expect(summary).toContainText('New1');
    await expect(summary).toContainText('Duplicate1');
    await expect(summary).toContainText('Invalid1');

    // The invalid row says why, in words
    const invalid = dialog.getByRole('region', { name: 'Invalid' });
    await expect(invalid.getByText('Row 2')).toBeVisible();
    await expect(invalid.getByText('site:fynix.example')).toBeVisible();
    await expect(invalid.getByText('Search operators such as site: are not tracked.')).toBeVisible();
    const duplicates = dialog.getByRole('region', { name: 'Duplicate' });
    await expect(duplicates.getByRole('radio', { name: 'Skip them' })).toBeChecked();
    await expect(duplicates.getByText('seo audit')).toBeVisible();
    await expect(duplicates.getByText('Row 3')).toBeVisible();
    await expectAccessible(page);

    // Skipped by default: only the new keyword is written, and the other two rows go to the report
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('1 keyword is tracked')).toBeVisible();
    await expect(dialog.getByText('2 rows are skipped and listed in the report')).toBeVisible();

    // Back on Review, merging the duplicates changes what Confirm says
    await dialog.getByRole('button', { name: 'Back' }).click();
    await duplicates.getByRole('radio', { name: 'Add their groups and tags to the tracked keywords' }).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText("1 tracked keyword gets the file's groups and tags")).toBeVisible();
    await expect(dialog.getByText('1 row is skipped and listed in the report')).toBeVisible();
    await dialog.getByRole('button', { name: 'Import 1 keyword' }).click();
    await expect(page.getByText(/^Import finished: 1 added, 1 updated, 1 skipped$/)).toBeVisible({ timeout: 30_000 });
  });
});
