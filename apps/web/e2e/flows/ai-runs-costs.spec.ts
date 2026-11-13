import { expect, test, type Page } from '@playwright/test';

import { signIn, waitForContent } from '../support';
import {
  addAiBudget,
  addAiBudgetButton,
  addBudgetButton,
  ADMIN,
  aiBudgetCard,
  budgetDialog,
  BUDGETS_PAGE,
  budgetsHeading,
  budgetsTable,
  budgetsTableScroll,
  collectionLine,
  collectSeriousViolations,
  EDITOR,
  expectNoSeriousViolations,
  GEMINI_NOTICE,
  inspectAddress,
  minorFindings,
  openBudgets,
  openWithFinishedRun,
  PROMPTS_PAGE,
  runFinished,
  runInspector,
  runUnderWay,
  seriousFindings,
  setTheme,
  shoot,
  startAiRun,
  submitBudget,
  THEMES,
  TODAY,
  UNIT_COSTS_PAGE,
  VIEWER,
  WIDTHS,
} from '../support/runs-costs';

/**
 * Runs, costs, budgets and collection health of WP-30 against the mock API, in the production build.
 *
 * The project is Fynix, not Eventus Security: the end to end mocks start without the Eventus data set
 * (`src/mocks/ai-seed.ts`), and Fynix has no AI run until a flow starts one. The flow starts one the way the page
 * does and moves the browser's clock past its end, after which the mock reports the newest finished AI run with
 * Gemini degraded (132 of 150 answers valid, 88%), ChatGPT at 141 of 150 and Google AI Mode at 146 of 150.
 *
 * The mock keeps budgets in the memory of the page (`src/mocks/ai-health-model.ts`), so the budget steps never
 * reload: a reload would start again from the fixtures.
 */

const toastsOf = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test.describe('runs, costs and budgets', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(TODAY);
  });

  test('Topics & Prompts follows a run, then names the degraded engine and links to the run', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, ADMIN);
    await page.goto(PROMPTS_PAGE);
    await waitForContent(page);
    // Nothing to say before an AI run: no notice, no progress
    await expect(page.getByText('Collecting answers')).toHaveCount(0);
    await expect(page.getByText(/degraded in the latest run/)).toHaveCount(0);
    await expect(collectionLine(page)).toContainText(/^Last run /);

    await startAiRun(page);
    await runUnderWay(page);
    await page.reload();
    await waitForContent(page);
    await expect(page.getByText(/^Collecting answers: [\d,]+ of [\d,]+ tasks/)).toBeVisible();
    await expect(collectionLine(page)).toHaveText('Running now');
    await expect(page.getByRole('link', { name: 'View run' })).toBeVisible();

    // The poll (every 10 s while a run is open) sees the end: the progress goes and the notice comes
    await runFinished(page);
    await expect(page.getByText(/^Collecting answers/)).toHaveCount(0, { timeout: 25_000 });
    await expect(page.getByText(GEMINI_NOTICE)).toBeVisible();
    await expect(page.getByText(/^ChatGPT: .* valid/)).toHaveCount(0);
    await expect(page.getByText(/^Google AI Mode: .* valid/)).toHaveCount(0);
    await expect(collectionLine(page)).toContainText(/^Last run .*, [\d,]+ of [\d,]+ answers$/, { timeout: 70_000 });

    // The notice links to the run, which opens in the inspector of the Runs page
    await page.getByRole('link', { name: 'View run for Gemini' }).click();
    await expect(page).toHaveURL(/\/ops\/runs\?inspect=run(%3A|:)/);
    await expect(runInspector(page)).toBeVisible();
  });

  test('the Updated text is a link that opens the Runs inspector with the run open', async ({ page }) => {
    const { runId } = await openWithFinishedRun(page, ADMIN, PROMPTS_PAGE, 1440);
    const updated = page.getByRole('link', { name: /Open the run that collected these answers\.$/ });
    await expect(updated).toBeVisible();
    await expect(updated).toHaveText(/^Updated /);
    await updated.click();
    await expect(page).toHaveURL(/\/ops\/runs\?inspect=run(%3A|:)/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('inspect') ?? '')).toMatch(/^run:/);
    await expect(runInspector(page)).toBeVisible();
    // The link opens the newest finished AI run, which is the one this flow started
    expect(runId).toBeTruthy();
  });

  test('the inspector of an AI run counts the answers by engine and lists the missing ones', async ({ page }) => {
    const { runId } = await openWithFinishedRun(page, ADMIN, '/digibranders/fynix/ops/runs', 1440);
    await page.goto(inspectAddress(runId));
    const inspector = runInspector(page);
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'Tasks by status' })).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'Answers by engine' })).toBeVisible();
    await expect(inspector.getByText('141 of 150 answers valid, 94%')).toBeVisible();
    const gemini = inspector.getByText('132 of 150 answers valid, 88%');
    await expect(gemini).toBeVisible();
    await expect(inspector.getByText('Below 90%, so this engine is degraded in this run.')).toBeVisible();
    await expect(inspector.getByText('146 of 150 answers valid, 97%')).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'Missing answers' })).toBeVisible();
    await expect(inspector.getByText(/^[\d,]+ planned answers have not arrived\.$/)).toBeVisible();
    const missing = inspector.getByRole('table', { name: 'Planned answers that have not arrived' });
    await expect(missing.getByRole('columnheader', { name: 'Task status' })).toBeVisible();
    await expect(missing.getByRole('row')).not.toHaveCount(1);
  });

  test('Unit costs lists the cost per AI answer of each engine with its count', async ({ page }) => {
    await openWithFinishedRun(page, ADMIN, UNIT_COSTS_PAGE, 1440);
    await expect(page.getByRole('tab', { name: 'Unit costs' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Cost per AI answer' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Cost per AI answer' });
    await expect(table.getByRole('columnheader', { name: 'Cost per answer and answers counted' })).toBeVisible();
    // ChatGPT and Gemini report a cost; Google AI Mode reports none and says so, never $0
    // The table has a row per project and engine: Fynix is the one with a run
    await expect(table.getByRole('row', { name: /^Fynix ChatGPT \$0\.0015\s*145 answers / })).toBeVisible();
    await expect(table.getByRole('row', { name: /^Fynix Gemini \$0\.0009\s*144 answers / })).toBeVisible();
    const aiMode = table.getByRole('row', { name: /^Fynix Google AI Mode/ });
    await expect(aiMode).toContainText('No answers with a cost this month');
    await expect(aiMode).not.toContainText('$0.00');
  });

  test('an admin adds an AI budget, is refused a duplicate, edits the limit and deletes it', async ({ page }) => {
    await openBudgets(page, ADMIN);
    const usage = page.getByRole('region', { name: 'Usage this month' });
    // Used of limit, as a line and as a meter
    await expect(usage.getByText(/^\d+ of 150$/).first()).toBeVisible();
    await expect(usage.getByRole('meter', { name: 'Active prompts' })).toBeVisible();
    await expect(usage.getByRole('meter', { name: 'AI answers this month' })).toBeVisible();
    await expect(usage.getByRole('meter', { name: 'AI answers this month' })).toHaveAccessibleDescription(/.*/);
    await expect(usage.getByText(/^[\d,]+ of [\d,]+$/)).toHaveCount(2);

    // No AI budget yet: the empty state offers one
    await expect(page.getByRole('heading', { name: 'No AI budget' })).toBeVisible();
    await addAiBudget(page, '100');
    await expect(toastsOf(page).getByText('Budget added for AI answers in Workspace')).toBeVisible();
    const card = aiBudgetCard(page);
    await expect(card.getByText(/^\$[\d,.]+ spent of \$100\.00$/)).toBeVisible();
    await expect(card.getByRole('meter')).toBeVisible();
    await expect(card.getByText(/^About \$[\d,.]+ this month \(estimate from the price book\)$/)).toBeVisible();
    const row = budgetsTable(page).getByRole('row', { name: /Workspace.*AI answers/ });
    await expect(row).toContainText('$100.00');

    // The same scope and group again: the field says so, and the dialog stays open
    await addBudgetButton(page).click();
    const dialog = budgetDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Group' }).click();
    await page.getByRole('option', { name: 'AI answers' }).click();
    await submitBudget(page, '50', 'Add budget');
    await expect(dialog.getByText('A budget for this scope and group already exists. Edit it instead.')).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect(budgetsTable(page).getByRole('row', { name: /Workspace.*AI answers/ })).toHaveCount(1);

    // Edit: the scope and the group are fixed, the limit changes
    await budgetsTable(page).getByRole('button', { name: 'Actions for Workspace, AI answers' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit budget' });
    await expect(edit.getByText('The scope and the group cannot change.')).toBeVisible();
    await submitBudget(page, '150', 'Save');
    await expect(edit).toBeHidden();
    await expect(toastsOf(page).getByText('Budget saved for AI answers in Workspace')).toBeVisible();
    await expect(card.getByText(/^\$[\d,.]+ spent of \$150\.00$/)).toBeVisible();
    await expect(budgetsTable(page).getByRole('row', { name: /Workspace.*AI answers/ })).toContainText('$150.00');

    // Delete: asked first, then the card is the empty state again
    await budgetsTable(page).getByRole('button', { name: 'Actions for Workspace, AI answers' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this budget?' });
    await expect(confirm.getByText(/will no longer be capped/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete budget' }).click();
    await expect(toastsOf(page).getByText('Budget deleted for AI answers in Workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No AI budget' })).toBeVisible();
    await expect(budgetsTable(page).getByRole('row', { name: /Workspace.*AI answers/ })).toHaveCount(0);
  });

  test('a member who may not manage budgets reads them with a banner and no button', async ({ page }) => {
    await openBudgets(page, EDITOR);
    await expect(page.getByText('Owners, admins and billing members can change budgets.')).toBeVisible();
    await expect(addAiBudgetButton(page)).toHaveCount(0);
    await expect(addBudgetButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
    await expect(page.getByText('Owners, admins and billing members can add one.')).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Active prompts' })).toBeVisible();
    await expectNoSeriousViolations(page, 'budgets, read only');
  });

  test('a viewer, who reads no costs, is told so on the budgets page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, VIEWER);
    await page.goto(BUDGETS_PAGE);
    await expect(page.getByRole('heading', { name: 'You do not have access to budgets' })).toBeVisible();
    await expect(addAiBudgetButton(page)).toHaveCount(0);
  });

  test('the budget dialog opens from the keyboard, keeps Tab inside and gives focus back on Escape', async ({
    page,
  }) => {
    await openBudgets(page, ADMIN);
    for (const trigger of [addAiBudgetButton(page), addBudgetButton(page)]) {
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = budgetDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Limit (USD)' })).toBeVisible();
      // Whether focus is inside the dialog. The dialog's two focus guards sit just outside it and hand focus back
      // within a frame, so a Tab that lands on one is given that frame to settle, never longer
      const inside = (): Promise<boolean> =>
        page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null);
      // More presses than the dialog has controls, in both directions: focus never rests outside it
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let press = 0; press < 14; press += 1) {
          await page.keyboard.press(key);
          await expect.poll(inside, { message: `${key} ${String(press + 1)}`, timeout: 1000 }).toBe(true);
        }
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  });

  test('axe finds no serious or critical violation on the four surfaces, at four widths, in both themes', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const { runId } = await openWithFinishedRun(page, ADMIN, PROMPTS_PAGE, 1280);
    const surfaces = [
      {
        name: 'topics',
        address: PROMPTS_PAGE,
        ready: async (): Promise<void> => {
          await expect(page.getByText(GEMINI_NOTICE)).toBeVisible();
        },
      },
      {
        name: 'run-inspector',
        address: inspectAddress(runId),
        ready: async (): Promise<void> => {
          await expect(runInspector(page).getByRole('heading', { name: 'Missing answers' })).toBeVisible();
        },
      },
      {
        name: 'unit-costs',
        address: UNIT_COSTS_PAGE,
        ready: async (): Promise<void> => {
          await expect(page.getByRole('table', { name: 'Cost per AI answer' }).getByRole('row')).not.toHaveCount(1);
        },
      },
    ];
    const measures: string[] = [];
    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const surface of surfaces) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(surface.address);
          await waitForContent(page);
          await surface.ready();
          await setTheme(page, theme);
          await collectSeriousViolations(page, `${surface.name} ${String(width)} ${theme}`);
          await shoot(page, `${surface.name}-${String(width)}-${theme}`);
          if (surface.name === 'run-inspector') {
            // The inspector scrolls inside the window: a tall window shows all of it
            await page.setViewportSize({ width, height: 2400 });
            await shoot(page, `${surface.name}-tall-${String(width)}-${theme}`);
          }
        }
      }
      // Budgets: the mock keeps them in the page, so the AI budget is added once and the window is resized
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(BUDGETS_PAGE);
      await expect(budgetsHeading(page)).toBeVisible();
      await setTheme(page, theme);
      await addAiBudget(page, '100');
      for (const width of [...WIDTHS].reverse()) {
        await page.setViewportSize({ width, height: 900 });
        await expect(aiBudgetCard(page)).toBeVisible();
        await collectSeriousViolations(page, `budgets ${String(width)} ${theme}`);
        await shoot(page, `budgets-${String(width)}-${theme}`);
        if (width === 1280 || width === 390) {
          const scroll = await budgetsTableScroll(page);
          measures.push(
            `budgets table ${theme} ${String(width)}: scrollWidth ${String(scroll.scrollWidth)}, clientWidth ${String(scroll.clientWidth)}, scrolls ${String(scroll.scrolls)}`,
          );
        }
      }
    }
    console.log(measures.join('\n'));
    console.log(`axe findings below serious:\n${minorFindings.join('\n') || 'none'}`);
    expect(seriousFindings).toEqual([]);
  });
});
