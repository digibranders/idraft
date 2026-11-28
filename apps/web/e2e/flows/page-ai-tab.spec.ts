import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible, signIn } from '../support';
import { EDITOR, EVENTUS_LINKS, EVENTUS_PAGES_ALL, THEME_STORAGE_KEY, inspectorOf } from '../support/internal-links';

const SHOT_DIR = process.env.PAGE_AI_SCREENSHOT_DIR;
const VIEWPORT = { width: 1280, height: 720 };

async function saveShot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function expectDrawerFits(drawer: Locator): Promise<void> {
  const overflow = await drawer.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Page drawer, AI tab', () => {
  test('shows the strip, prompts, trend, Table switch, alongside pages and basis at 1280x720 and across widths', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await signIn(page, EDITOR);

    await page.goto(`${EVENTUS_PAGES_ALL}?inspect=page:104&itab=ai`);
    const drawer = inspectorOf(page, '/services/managed-detection-and-response');
    await expect(drawer.getByRole('heading', { name: 'Prompts that cited this page' })).toBeVisible();

    // Strip stays with Google AI Mode label and today's answers count
    await expect(drawer.getByText('Google AI Mode', { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText('Cited in 5 answers')).toBeVisible();

    // Printed period dates, prompts, trend line with change, alongside, and basis footnote
    await expect(drawer.getByText('Oct 22, 2026 to Nov 18, 2026, project days')).toBeVisible();
    await expect(drawer.getByText('6 of 6 prompts')).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Citations over time' })).toBeVisible();
    await expect(drawer.getByText('Cited in 14 answers')).toBeVisible();
    await expect(drawer.getByText('up +3 against the 28 days before (11)')).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Cited with this page' })).toBeVisible();
    await expect(drawer.getByText('Competitor', { exact: true })).toBeVisible();
    await expect(
      drawer.getByText(
        'These cards count answers of the prompts you track now (not paused or archived) on ChatGPT, Gemini and Google AI Mode.',
      ),
    ).toBeVisible();

    await expectDrawerFits(drawer);
    await expectAccessible(page);
    await saveShot(page, 'ai-tab-light-640.png');

    // Switch Citations over time to Table view and back
    const tableToggle = drawer.getByRole('button', { name: 'Table' });
    await tableToggle.click();
    await expect(tableToggle).toHaveAttribute('aria-pressed', 'true');
    const trendTable = drawer.getByRole('table', { name: 'Citations over time' });
    await expect(trendTable).toBeVisible();
    await expect(trendTable.getByRole('row')).toHaveCount(29);
    await tableToggle.click();
    await expect(tableToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(trendTable).toHaveCount(0);

    // Narrow to 480 px via the keyboard separator handle (10 steps of 16 px from 640)
    const separator = page.getByRole('separator', { name: 'Resize inspector' });
    await separator.focus();
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(separator).toHaveAttribute('aria-valuenow', '480');
    await expectDrawerFits(drawer);
    await expectAccessible(page);
    await saveShot(page, 'ai-tab-light-480.png');

    // Widen to maximum allowed inside 1280 px viewport (768 px)
    for (let step = 0; step < 18; step += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await expect(separator).toHaveAttribute('aria-valuenow', '768');
    await expectDrawerFits(drawer);

    // Dark theme check at default width
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('ArrowRight');
    }
    await page.evaluate((key) => {
      window.localStorage.setItem(key, 'dark');
    }, THEME_STORAGE_KEY);
    await page.reload();
    const darkDrawer = inspectorOf(page, '/services/managed-detection-and-response');
    await expect(darkDrawer.getByRole('heading', { name: 'Prompts that cited this page' })).toBeVisible();
    await expectDrawerFits(darkDrawer);
    await expectAccessible(page);
    await saveShot(page, 'ai-tab-dark-640.png');
  });

  test('opens an own alongside page, opens a citing prompt inspector across hosts, and renders empty states', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await signIn(page, EDITOR);

    // Clicking an own in-crawl alongside page opens its page drawer on the AI tab
    await page.goto(`${EVENTUS_PAGES_ALL}?inspect=page:104&itab=ai`);
    const drawer = inspectorOf(page, '/services/managed-detection-and-response');
    const alongsideTable = drawer.getByRole('table', { name: 'Other addresses cited in the same answers' });
    await alongsideTable.getByRole('button', { name: /\/pricing/ }).click();
    await expect(page).toHaveURL(/inspect=page:108/);
    await expect(inspectorOf(page, '/pricing')).toBeVisible();

    // Clicking a prompt row opens the prompt inspector and drops itab (in test builds Eventus AI prompts are unseeded,
    // so PromptDrawerHost renders its header/order shell with its own not-found body)
    const promptsTable = inspectorOf(page, '/pricing').getByRole('table', { name: 'Prompts that cited this page' });
    await promptsTable.getByRole('button').first().click();
    await expect(page).toHaveURL(/inspect=prompt:/);
    await expect(page).not.toHaveURL(/itab=/);
    await expect(page.getByRole('complementary', { name: 'Prompt' }).getByText('1 of 6')).toBeVisible();
    await expectAccessible(page);
    await saveShot(page, 'prompt-inspector-from-ai-tab.png');

    // Internal links host also opens AI tab and prompt inspector
    await page.goto(`${EVENTUS_LINKS}?inspect=page:104&itab=ai`);
    const linksDrawer = inspectorOf(page, '/services/managed-detection-and-response');
    await expect(linksDrawer.getByRole('heading', { name: 'Prompts that cited this page' })).toBeVisible();
    await linksDrawer.getByRole('table', { name: 'Prompts that cited this page' }).getByRole('button').first().click();
    await expect(page).toHaveURL(/inspect=prompt:/);
    await expect(page.getByRole('complementary', { name: 'Prompt' }).getByText('1 of 6')).toBeVisible();

    // Issues host also opens AI tab and prompt inspector
    await page.goto('/digibranders/eventus-security/seo/issues?inspect=page:104&itab=ai');
    const issuesDrawer = inspectorOf(page, '/services/managed-detection-and-response');
    await expect(issuesDrawer.getByRole('heading', { name: 'Prompts that cited this page' })).toBeVisible();
    await issuesDrawer.getByRole('table', { name: 'Prompts that cited this page' }).getByRole('button').first().click();
    await expect(page).toHaveURL(/inspect=prompt:/);
    await expect(page.getByRole('complementary', { name: 'Prompt' }).getByText('1 of 6')).toBeVisible();

    // Quiet ready state (uncited), no_answers, and no_prompts states
    await page.goto(`${EVENTUS_PAGES_ALL}?inspect=page:105&itab=ai`);
    const quietDrawer = inspectorOf(page, '/services/vapt');
    await expect(quietDrawer.getByText('No AI answer cited this page in the last 28 days')).toBeVisible();
    await expect(quietDrawer.getByRole('heading', { name: 'No prompt cited this page in this period' })).toBeVisible();
    await expect(quietDrawer.getByText('Not cited in this period')).toBeVisible();
    await expectAccessible(page);
    await saveShot(page, 'ai-tab-quiet-page.png');

    await page.goto(`${EVENTUS_PAGES_ALL}?inspect=page:109&itab=ai`);
    await expect(page.getByRole('heading', { name: 'No answers in this period' })).toBeVisible();
    await expectAccessible(page);

    await page.goto(`${EVENTUS_PAGES_ALL}?inspect=page:110&itab=ai`);
    await expect(page.getByRole('heading', { name: 'No prompts are tracked yet' })).toBeVisible();
    await expectAccessible(page);
  });
});
