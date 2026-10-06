import { expect, test } from '@playwright/test';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../../src/mocks/fixtures';
import { expectAccessible, signIn, waitForContent } from '../support';

const ADMIN = 'tomas@digibranders.test';
/** A viewer reads runs but not costs (`costs:read` starts at analysts). */
const VIEWER = 'mei@digibranders.test';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

/**
 * The day of the flows. The fixture runs and costs sit in the summer of 2026 and the month list is the
 * twelve months up to today, so the browser's clock is fixed to the days after them: a flow does not
 * start to miss its months a year from now.
 */
const TODAY = new Date('2026-10-05T10:00:00Z');

test.describe('costs and runs', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(TODAY);
  });

  test('Runs and Costs open from the sidebar, which stays on screen, and Rankings is one click back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/seo/rankings');
    const sidebar = page.getByRole('navigation', { name: 'Primary' });
    await expect(sidebar.getByRole('link', { name: 'Rankings' })).toHaveAttribute('aria-current', 'page');

    await sidebar.getByRole('link', { name: 'Runs' }).click();
    await expect(page).toHaveURL(/\/digibranders\/fynix\/ops\/runs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
    const crumbs = page.getByRole('banner').getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByText('Runs')).toHaveAttribute('aria-current', 'page');
    // The project is the route: the page has a month and filters, and no project to choose
    await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveCount(0);

    await sidebar.getByRole('link', { name: 'Costs' }).click();
    await expect(page).toHaveURL(/\/digibranders\/fynix\/costs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Costs' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Costs' })).toHaveAttribute('aria-current', 'page');

    await sidebar.getByRole('link', { name: 'Rankings' }).click();
    await expect(page).toHaveURL(/\/digibranders\/fynix\/seo\/rankings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Rankings' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Rankings' })).toHaveAttribute('aria-current', 'page');
  });

  test('the old routes of Costs and Runs end at the project version, with the sidebar and what the link held', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, ADMIN);
    // Costs has no project of its own: it opens in the first project by name, with its query kept
    await page.goto('/digibranders/costs?month=2026-09&tab=budgets');
    await expect(page).toHaveURL(/\/digibranders\/cleanstart\/costs\?month=2026-09&tab=budgets$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Costs' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    // A link of Runs that named its project by the `project` key keeps that project, and drops the key
    await page.goto('/digibranders/ops/runs?project=fynix&month=2026-09');
    await expect(page).toHaveURL(/\/digibranders\/fynix\/ops\/runs\?month=2026-09$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('a month with costs fills the summary and the tables', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/costs');
    await expect(page.getByRole('heading', { level: 1, name: 'Costs' })).toBeVisible();

    // The fixture runs are those of September: the month before this one has the costs
    await page.getByRole('combobox', { name: 'Month' }).click();
    await page.getByRole('option', { name: 'September 2026' }).click();
    await expect(page).toHaveURL(/[?&]month=2026-09/);
    const summary = page.getByRole('group', { name: 'Month summary' });
    await expect(summary.getByText('Month to date')).toBeVisible();
    await expect(summary.getByRole('meter')).toBeVisible();
    // By provider is the first tab
    await expect(page.getByRole('row', { name: /dataforseo/ })).toBeVisible();
    await page.getByRole('tab', { name: 'Budgets' }).click();
    await expect(page.getByRole('row', { name: /Workspace.*All workloads/ })).toBeVisible();
    await expectAccessible(page);
  });

  test('a member without costs:read is told so, and has no way back but the overview', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, VIEWER);
    await page.goto('/digibranders/costs');
    // The old route goes to the first project, where the page says so inside the shell; the sidebar has no Costs
    await expect(page).toHaveURL(/\/digibranders\/cleanstart\/costs$/);
    await expect(page.getByRole('heading', { name: 'You do not have access to Costs' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Costs' })).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Back to Overview' }).click();
    await expect(page).toHaveURL(/\/digibranders$/);
  });

  test('Runs opens from Settings, and a failed run of September opens in the inspector', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/settings/members');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Operations' }).click();
    // Settings is in Fynix, so Operations opens in Fynix, whose runs the fixture has, in September
    await expect(page).toHaveURL(/\/digibranders\/fynix\/ops\/runs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Month' }).click();
    await page.getByRole('option', { name: 'September 2026' }).click();
    await page.getByRole('button', { name: 'Add a filter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Status' }).click();
    await page.getByRole('dialog').getByRole('checkbox', { name: 'Failed' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/[?&]status=failed/);
    const grid = page.getByRole('grid', { name: 'Runs' });
    await expect(grid.getByRole('rowheader')).toHaveCount(1);
    await grid.getByRole('rowheader').first().click();
    const inspector = page.getByRole('complementary', { name: 'Keyword metrics' });
    await expect(inspector.getByRole('heading', { name: 'Tasks by status' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]inspect=run(%3A|:)/);
    await expectAccessible(page);
  });

  test('a run that is open is followed, opened and cancelled after asking', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, ADMIN);
    await page.goto('/digibranders/fynix/ops/runs');
    await waitForContent(page);
    // Start a refresh of keyword metrics, as the Rankings page will: the mock answers 202 with a planned run
    const started = await page.evaluate(
      async ({ workspaceId, projectId }) => {
        const response = await fetch(
          `/api/v1/workspaces/${workspaceId}/projects/${projectId}/keyword-metrics/refresh`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stale_days: 0 }),
          },
        );
        return response.status;
      },
      { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
    );
    expect(started).toBe(202);
    // The mock ends a run 15 seconds after it starts. The clock stands 5 seconds on, so the run is under
    // way and stays so for as long as the flow takes; it holds across the reload.
    await page.clock.setFixedTime(new Date(TODAY.getTime() + 5_000));
    await page.reload();
    await waitForContent(page);

    await page.getByRole('button', { name: 'Add a filter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Status' }).click();
    await page.getByRole('dialog').getByRole('checkbox', { name: 'Running' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/[?&]status=running/);
    const grid = page.getByRole('grid', { name: 'Runs' });
    await expect(grid.getByRole('rowheader')).toHaveCount(1);
    await grid.getByRole('rowheader').first().click();
    const inspector = page.getByRole('complementary', { name: 'Keyword metrics' });
    await expect(inspector.getByText('Running')).toBeVisible();

    await grid.getByRole('button', { name: /^Actions for / }).click();
    await page.getByRole('menuitem', { name: 'Cancel run' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel this run?' });
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Cancel run' }).click();
    await expect(page.getByText('Run cancelled')).toBeVisible();
    // The run is no longer running, so the filter leaves it out; the open inspector says it is cancelled
    await expect(page.getByText('No runs match these filters in October 2026')).toBeVisible();
    await expect(inspector.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Remove filter Status: Running' }).click();
    await expect(grid.getByRole('row', { name: /Cancelled/ })).toBeVisible();
  });
});
