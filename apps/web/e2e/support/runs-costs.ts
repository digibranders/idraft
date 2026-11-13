import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../../src/mocks/fixtures';
import { signIn, waitForContent } from '../support';

/**
 * What the runs, costs and budgets e2e of WP-30 shares (apps/web/e2e/flows/ai-runs-costs.spec.ts): the people, the
 * addresses, a finished AI run made through the mock API, the helpers of the budgets page and of the axe and
 * screenshot matrix. The helpers live here because `e2e/support.ts` is frozen.
 *
 * The mocks of an end to end run start without the Eventus Security data set (`src/mocks/ai-seed.ts`), so the
 * project of every flow here is Fynix, which has no AI run until the flow starts one. The run is started the way
 * the page does (the bulk run route) and finished by moving the browser's clock past the mock's 15 seconds.
 */

/** An admin holds `budgets:manage`; an editor reads costs and may not manage budgets; a viewer reads no costs. */
export const ADMIN = 'tomas@digibranders.test';
export const EDITOR = 'priya@digibranders.test';
export const VIEWER = 'mei@digibranders.test';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const FYNIX_ID = fynix.project_id;
const FYNIX_LOCATION = fynix.location_id;

const WORKSPACE = `/${MOCK_WORKSPACE.slug}`;
export const PROMPTS_PAGE = `${WORKSPACE}/fynix/ai/prompts`;
export const RUNS_PAGE = `${WORKSPACE}/fynix/ops/runs`;
export const UNIT_COSTS_PAGE = `${WORKSPACE}/fynix/costs?tab=units`;
export const BUDGETS_PAGE = `${WORKSPACE}/settings/budgets`;

/** The day of every flow, so the month, the runs and the budgets do not move with the machine's clock. */
export const TODAY = new Date('2026-10-05T10:00:00Z');
/** The mock plans a run 3 seconds after it starts and works 12 seconds: 5 s is planned, 9 s is under way, 20 s is over. */
const UNDER_WAY_MS = 9_000;
const FINISHED_MS = 20_000;

export const WIDTHS = [390, 768, 1024, 1280] as const;
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The words the degraded engine of the newest AI run is reported in (mock profile: Gemini 132 of 150). */
export const GEMINI_NOTICE = /^Gemini: 132 of 150 answers valid, 88%\. Below 90%, so this engine is degraded/;

/** The AI run the flow started, with the id its inspector opens under. */
export interface StartedRun {
  runId: string;
}

/** Starts a bulk AI run of every active prompt of Fynix, as the page does; the clock stands at `TODAY`. */
export async function startAiRun(page: Page): Promise<StartedRun> {
  const result = await page.evaluate(
    async ({ workspaceId, projectId, locationId }) => {
      const base = `/api/v1/workspaces/${workspaceId}/projects/${projectId}`;
      // Turning an engine on makes the project's weekly AI schedules, which the budget forecast reads
      const engine = await fetch(`${base}/engines/google_ai_mode`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location_ids: [locationId], is_enabled: true }),
      });
      if (engine.status !== 200) throw new Error(`Turning on Google AI Mode answered ${String(engine.status)}`);
      const listed = await fetch(`${base}/prompts`);
      const body: unknown = await listed.json();
      const ids =
        typeof body === 'object' && body !== null && 'data' in body && Array.isArray(body.data)
          ? body.data.map((row: { prompt_id: string }) => row.prompt_id)
          : [];
      const started = await fetch(`${base}/ai/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt_ids: ids }),
      });
      const run: unknown = await started.json();
      const runId =
        typeof run === 'object' && run !== null && 'data' in run && typeof run.data === 'object' && run.data !== null
          ? (run.data as { run_id?: string }).run_id
          : undefined;
      return { status: started.status, runId, prompts: ids.length };
    },
    { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: FYNIX_ID, locationId: FYNIX_LOCATION },
  );
  expect(result.prompts).toBeGreaterThan(0);
  expect(result.status).toBe(202);
  if (result.runId === undefined) throw new Error('The bulk run did not answer a run id');
  return { runId: result.runId };
}

/** Moves the browser's clock to when the run is under way (its progress is a few tasks of many). */
export const runUnderWay = (page: Page): Promise<void> =>
  page.clock.setFixedTime(new Date(TODAY.getTime() + UNDER_WAY_MS));

/** Moves the browser's clock to when the run has finished, with Gemini degraded in it. */
export const runFinished = (page: Page): Promise<void> =>
  page.clock.setFixedTime(new Date(TODAY.getTime() + FINISHED_MS));

/**
 * Signs in as `email`, starts an AI run on the prompts page and moves the clock past its end, then opens `address`
 * (the page is loaded again, so the run lives in the mock's cookie and the finished clock is what the page reads).
 */
export async function openWithFinishedRun(
  page: Page,
  email: string,
  address: string,
  width: number,
): Promise<StartedRun> {
  await page.clock.setFixedTime(TODAY);
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, email);
  await page.goto(PROMPTS_PAGE);
  await waitForContent(page);
  const started = await startAiRun(page);
  await runFinished(page);
  await page.goto(address);
  await waitForContent(page);
  return started;
}

/** The address of the Runs page with `runId` open in its inspector. */
export const inspectAddress = (runId: string): string =>
  `${RUNS_PAGE}?${new URLSearchParams({ inspect: `run:${runId}` }).toString()}`;

/** The inspector of a run: beside the table on a wide window, a sheet over it on a narrow one. */
export const runInspector = (page: Page): Locator =>
  page.getByRole('complementary').or(page.getByRole('dialog')).filter({ hasText: 'Answers by engine' });

/** The sidebar's collection line. */
export const collectionLine = (page: Page): Locator => page.locator('[data-slot="collection-line"]');

/**
 * Follows the theme the way a person without a choice does: the page starts with `system`, so the browser's
 * color scheme is the theme. Waits until the page has put the class on `html`.
 */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'dark');
}

// -------------------------------------------------------------------------------------------------
// Budgets page

export const budgetsHeading = (page: Page): Locator =>
  page.getByRole('heading', { level: 2, name: 'Budgets and usage', exact: true });
export const budgetsTable = (page: Page): Locator => page.getByRole('table', { name: 'Budgets' });
export const budgetDialog = (page: Page): Locator => page.getByRole('dialog', { name: /^(Add|Edit) budget$/ });
export const aiBudgetCard = (page: Page): Locator => page.getByRole('region', { name: 'AI answers budget' });
export const addAiBudgetButton = (page: Page): Locator => page.getByRole('button', { name: 'Add AI budget' });
export const addBudgetButton = (page: Page): Locator => page.getByRole('button', { name: 'Add budget', exact: true });

/** Opens the budgets page as `email` with a finished AI run behind it (so the AI answers used are above 0). */
export async function openBudgets(page: Page, email: string, width = 1280): Promise<void> {
  await openWithFinishedRun(page, email, BUDGETS_PAGE, width);
  await expect(budgetsHeading(page)).toBeVisible();
}

/** Fills the limit of the open dialog and presses its submit button. */
export async function submitBudget(page: Page, limit: string, submit: string): Promise<void> {
  const dialog = budgetDialog(page);
  await dialog.getByRole('textbox', { name: 'Limit (USD)' }).fill(limit);
  await dialog.getByRole('button', { name: submit, exact: true }).click();
}

/** Adds the workspace's AI budget from the empty state and waits for the card that replaces it. */
export async function addAiBudget(page: Page, limit = '100'): Promise<void> {
  await addAiBudgetButton(page).click();
  await expect(budgetDialog(page)).toBeVisible();
  await submitBudget(page, limit, 'Add budget');
  await expect(budgetDialog(page)).toBeHidden();
  await expect(aiBudgetCard(page)).toBeVisible();
}

/** The scroll measures of the budgets table's scroll region (the closest ancestor that clips its overflow). */
export interface ScrollMeasure {
  scrollWidth: number;
  clientWidth: number;
  scrolls: boolean;
}

export async function budgetsTableScroll(page: Page): Promise<ScrollMeasure> {
  return budgetsTable(page).evaluate((table) => {
    let node: HTMLElement | null = table.parentElement;
    while (node !== null && node !== document.body) {
      const { overflowX } = getComputedStyle(node);
      if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') break;
      node = node.parentElement;
    }
    const region = node ?? document.documentElement;
    return {
      scrollWidth: region.scrollWidth,
      clientWidth: region.clientWidth,
      scrolls: region.scrollWidth > region.clientWidth,
    };
  });
}

// -------------------------------------------------------------------------------------------------
// Axe and screenshots

/** The WCAG 2.2 AA rules axe checks on every page (20-accessibility.md). */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** What axe found below serious and critical: reported by the flow, never failed on. */
export const minorFindings: string[] = [];

/** An en or an em dash: copy has none (20-frontend-specification.md section 8.7). Written as escapes to keep this file ASCII. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/** Serious and critical violations of the matrix, each with where it was found: the flow fails once at its end. */
export const seriousFindings: string[] = [];

/** Audits the page and keeps the serious and critical violations in `seriousFindings`, so a matrix reports them all. */
export async function collectSeriousViolations(page: Page, where: string): Promise<void> {
  seriousFindings.push(...(await auditPage(page, where)));
}

/** Fails on a serious or critical violation; the others are kept in `minorFindings` with where they were found. */
export async function expectNoSeriousViolations(page: Page, where: string): Promise<void> {
  expect(await auditPage(page, where), where).toEqual([]);
}

async function auditPage(page: Page, where: string): Promise<string[]> {
  await waitForContent(page);
  // A sheet or a dialog still fading in would be measured at part of its opacity
  await page.evaluate(async () => {
    const ending = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
      );
    await Promise.race([
      Promise.all(ending.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
  expect(await page.locator('body').innerText(), `${where}: no en or em dash in the text`).not.toMatch(DASHES);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const describe = (violation: (typeof violations)[number]): string =>
    `${violation.impact ?? 'n/a'} ${violation.id}: ${violation.help} (${violation.nodes
      .map((node) => node.target.join(' '))
      .join(', ')})`;
  const serious = violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  for (const violation of violations) {
    if (!serious.includes(violation)) minorFindings.push(`${where}: ${describe(violation)}`);
  }
  return serious.map((violation) => `${where}: ${describe(violation)}`);
}

/**
 * A full page screenshot into the folder the run was given (`WP30_SHOT_DIR`), for a person to look at. Without the
 * variable nothing is written, so a run in CI leaves no file behind.
 */
export async function shoot(page: Page, name: string): Promise<void> {
  const folder = process.env['WP30_SHOT_DIR'];
  if (folder === undefined || folder === '') return;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, `${name}.png`), fullPage: true });
}
