import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible } from '../support';

const THEME_STORAGE_KEY = 'idraft.theme';
const SLUG = '/design-system/metric-parts';
const WIDTHS = [390, 768, 1024, 1280] as const;

/**
 * The metric parts of WP-07 (Delta, DeltaCell, EngineLogo, EngineBadge, Meter, BudgetMeter, Banner,
 * SampleCount, MetricInfo, StatisticsPanel) as the gallery shows them, in the production build. jsdom has no
 * layout, no stylesheet and no focus order, so contrast, overflow and the keyboard path are checked here.
 */

/** The gallery group (`<section>`) whose heading is `title`. */
function group(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 2, name: title, exact: true }).locator('xpath=ancestor::section[1]');
}

async function open(page: Page, theme: 'light' | 'dark', width: number): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.setViewportSize({ width, height: 900 });
  await page.goto(SLUG);
  await page.getByRole('heading', { level: 2, name: 'Delta', exact: true }).waitFor();
}

/** Presses Tab until `target` has focus, at most `limit` times: the target is reachable from the keyboard. */
async function tabTo(page: Page, target: Locator, limit: number): Promise<void> {
  for (let press = 0; press < limit; press += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the element within ${String(limit)} presses`);
}

/** Puts the keyboard's starting point on a heading, so the next Tab goes to the first stop after it. */
async function startAt(page: Page, heading: Locator): Promise<void> {
  await heading.scrollIntoViewIfNeeded();
  await heading.click();
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of WIDTHS) {
    test(`metric parts at ${String(width)} px in the ${theme} theme: no accessibility violation and no sideways page scroll`, async ({
      page,
    }) => {
      await open(page, theme, width);
      await expectAccessible(page);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    });
  }
}

test.describe('the metric parts at 1280 px in the light theme', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, 'light', 1280);
  });

  test('an engine mark is decorative and sits beside the engine name', async ({ page }) => {
    const logos = group(page, 'EngineLogo');
    const engines = ['ChatGPT', 'Gemini', 'Google AI Mode', 'Google AI Overview'];
    const marks = logos.locator('img');
    await expect(marks).toHaveCount(engines.length);
    for (const [index, name] of engines.entries()) {
      const mark = marks.nth(index);
      await expect(mark).toHaveAttribute('alt', '');
      // The name is visible text in the same box as the mark
      await expect(mark.locator('xpath=..')).toHaveText(name);
      await expect(logos.getByText(name, { exact: true }).first()).toBeVisible();
      // The SVG import resolved to a URL the production build serves
      await expect.poll(() => mark.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    // An engine with no mark of its own shows its name alone
    await expect(logos.getByText('Perplexity', { exact: true })).toBeVisible();
  });

  test('Tab reaches a change with a tooltip and opens it, and Escape closes it', async ({ page }) => {
    const deltas = group(page, 'Delta');
    const first = deltas.locator('span[tabindex="0"]').first();
    await startAt(page, page.getByRole('heading', { level: 2, name: 'Delta', exact: true }));
    await tabTo(page, first, 4);
    const tooltip = page.locator('[data-slot="tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Previous 29.0%');
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
  });

  test('the About Mention rate popover opens on Enter, ends in the Methodology link, and Escape returns focus', async ({
    page,
  }) => {
    const info = group(page, 'MetricInfo');
    const trigger = info.getByRole('button', { name: 'About Mention rate' });
    await startAt(page, page.getByRole('heading', { level: 2, name: 'MetricInfo', exact: true }));
    await tabTo(page, trigger, 4);
    await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', { name: 'Mention rate' });
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Open statistics' })).toBeVisible();
    const links = popover.getByRole('link');
    await expect(links.last()).toHaveText('Methodology');
    // Nothing focusable follows it: the last Tab stop of the popover is the link
    const last = await popover.evaluate((node) => {
      const stops = node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
      return stops[stops.length - 1]?.textContent;
    });
    expect(last).toBe('Methodology');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
    // The second trigger has no statistics button, and its link is the last line too
    await info.getByRole('button', { name: 'About Visibility score' }).click();
    const plain = page.getByRole('dialog', { name: 'Visibility score' });
    await expect(plain.getByRole('button', { name: 'Open statistics' })).toHaveCount(0);
    await expect(plain.getByRole('link').last()).toHaveText('Methodology');
    await page.keyboard.press('Escape');
    await expect(plain).toBeHidden();
  });

  test('the Back and Try again buttons of the statistics panels are reached by Tab and act on Enter', async ({
    page,
  }) => {
    // Counts the clicks a key press makes: the specimens' handlers do nothing a person can see
    const pressEnterOn = async (button: Locator): Promise<number> => {
      await button.evaluate((node) => {
        const target = node as HTMLElement & { clicks?: number };
        target.clicks = 0;
        node.addEventListener('click', () => {
          target.clicks = (target.clicks ?? 0) + 1;
        });
      });
      await page.keyboard.press('Enter');
      return button.evaluate((node) => (node as HTMLElement & { clicks?: number }).clicks ?? 0);
    };

    const heading = page.getByRole('heading', { level: 2, name: 'StatisticsPanel', exact: true });
    const loading = page.getByRole('region', { name: 'StatisticsPanel, loading' });
    const back = loading.getByRole('button', { name: 'Back to prompt best crm for startups' });
    await startAt(page, heading);
    await tabTo(page, back, 4);
    await expect(back).toBeFocused();
    expect(await pressEnterOn(back)).toBe(1);
    await expect(back).toBeFocused();

    const error = page.getByRole('region', { name: 'StatisticsPanel, error' });
    const retry = error.getByRole('button', { name: 'Try again' });
    await startAt(page, error.getByText('Could not load statistics'));
    await tabTo(page, retry, 4);
    await expect(retry).toBeFocused();
    expect(await pressEnterOn(retry)).toBe(1);
    await expect(retry).toBeFocused();
  });
});
