import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectAccessible, signIn } from '../support';

const EDITOR = 'priya@digibranders.test';
const THEME_KEY = 'idraft.theme';
const FYNIX_PROMPTS = '/digibranders/fynix/ai/prompts';
/**
 * The second fixture prompt (`src/mocks/prompt-fixtures.ts`): its ChatGPT answers cite an address inside the text (so
 * they have a citation marker), name the own brand and competitors, and the newest has an earlier answer to compare with.
 */
const FIRST_PROMPT_ID = '0192d1a8-e000-7a10-8e00-000000000002';
/** Its number among the fixture prompts, which the answer ids are made from. */
const FIRST_PROMPT_INDEX = 1;
const OPEN_ANSWER = /^Open the ChatGPT answer of /;
const COMPARE_TITLE = 'Change since the last answer that named the brand';

/** The answer viewer: beside the table on a wide window, a sheet over it on a narrow one. */
const viewerOf = (page: Page): Locator =>
  page.getByRole('complementary', { name: /answer, / }).or(page.getByRole('dialog', { name: /answer, / }));

/** The section of the viewer under a heading. */
const sectionOf = (viewer: Locator, heading: string): Locator =>
  viewer.getByRole('heading', { name: heading, exact: true }).locator('xpath=ancestor::section[1]');

/** Waits until the viewer shows an answer with text: the views, the source list and the details are in. */
async function viewerReady(page: Page): Promise<Locator> {
  const viewer = viewerOf(page);
  await expect(viewer.getByRole('heading', { name: 'Details' })).toBeVisible();
  await expect(viewer.getByRole('radiogroup', { name: 'Answer view' })).toBeVisible();
  await expect(viewer.getByRole('list', { name: 'Sources cited in this answer' })).toBeVisible();
  return viewer;
}

/** Opens the newest answer of the prompt the way a person does: the prompt in the Prompts page, History, the date. */
async function openAnswer(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  await page.goto(
    `${FYNIX_PROMPTS}?tab=prompts&inspect=${encodeURIComponent(`prompt:${FIRST_PROMPT_ID}`)}&itab=history`,
  );
  const dates = page.getByRole('button', { name: OPEN_ANSWER });
  await expect(dates.first()).toBeVisible();
  await dates.first().click();
  return viewerReady(page);
}

const DAY_MS = 86_400_000;

/**
 * The number of the oldest ChatGPT answer of the prompt in the mock world, which has nothing before it. The mock
 * (`src/mocks/prompt-fixtures.ts`, not imported: it reads JSON, which this loader refuses) asks on Mondays and
 * Thursdays at 02:00 UTC for the last 92 days, and numbers an answer `day * 10000 + prompt * 10 + engine`, ChatGPT being 0.
 */
function oldestAnswerId(now: number): string {
  const today = Math.floor(now / DAY_MS);
  for (let day = today - 91; day <= today; day += 1) {
    const at = day * DAY_MS + 2 * 3_600_000;
    if ([1, 4].includes(new Date(at).getUTCDay()) && at <= now) return String(day * 10_000 + FIRST_PROMPT_INDEX * 10);
  }
  throw new Error('The mock world has no answer run');
}

/** Opens the oldest answer by its address (History lists only the newest), once the test has signed in. */
async function openOldestAnswer(page: Page): Promise<Locator> {
  const id = oldestAnswerId(Date.now());
  // Signed in already, by `openAnswer`
  await page.goto(`${FYNIX_PROMPTS}?tab=prompts&inspect=${encodeURIComponent(`answer:${id}`)}`);
  return viewerReady(page);
}

/** Chooses an answer view. The label sits twice in the control (a hidden copy keeps the width), so the first is clicked. */
async function chooseView(viewer: Locator, name: 'Evidence' | 'Formatted' | 'Raw'): Promise<void> {
  const views = viewer.getByRole('radiogroup', { name: 'Answer view' });
  await views.getByText(name, { exact: true }).first().click();
  await expect(views.getByRole('radio', { name })).toBeChecked();
}

const ownMarks = (viewer: Locator): Locator => viewer.locator('[aria-label*="mention, own brand"]');

test.describe('The answer viewer', () => {
  test('jumps from a citation marker to its item in the source list', async ({ page }) => {
    const viewer = await openAnswer(page, 1280);
    const marker = viewer.getByRole('button', { name: /^Citation \d+: / }).first();
    await expect(marker).toBeVisible();
    const index = /^Citation (\d+): /.exec((await marker.getAttribute('aria-label')) ?? '')?.[1];
    expect(index).toBeDefined();
    await marker.click();
    const item = viewer
      .getByRole('list', { name: 'Sources cited in this answer' })
      .getByRole('button', { name: `Show in answer, citation ${String(index)}` })
      .locator('xpath=ancestor::li[1]');
    await expect(item).toHaveAttribute('aria-current', 'true');
    await expect(item).toBeFocused();
  });

  test('takes the marks of an entity away when it is toggled off, and puts them back', async ({ page }) => {
    const viewer = await openAnswer(page, 1280);
    const entities = viewer.getByRole('group', { name: 'Entities' });
    // The own brand is listed first
    const own = entities.getByRole('checkbox').first();
    await expect(ownMarks(viewer).first()).toBeVisible();
    await own.uncheck();
    await expect(ownMarks(viewer)).toHaveCount(0);
    await own.check();
    await expect(ownMarks(viewer).first()).toBeVisible();
  });

  test('shows the markdown as elements in Formatted, with no script element, and the raw answer in Raw', async ({
    page,
  }) => {
    const viewer = await openAnswer(page, 1280);
    const views = viewer.getByRole('radiogroup', { name: 'Answer view' });
    await expect(views.getByRole('radio', { name: 'Evidence' })).toBeChecked();

    await chooseView(viewer, 'Formatted');
    await expect(ownMarks(viewer)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Citation \d+: / })).toHaveCount(0);
    await expect(sectionOf(viewer, 'Answer').locator('p').first()).not.toBeEmpty();
    await expect(viewer.locator('script')).toHaveCount(0);

    await chooseView(viewer, 'Raw');
    const raw = viewer.locator('pre');
    await expect(raw).toBeVisible();
    await expect(raw).not.toBeEmpty();
    await expect(viewer.locator('script')).toHaveCount(0);
  });

  test('says what changed since the last answer that named the brand, or why there is no earlier answer', async ({
    page,
  }) => {
    const newest = await openAnswer(page, 1280);
    const compare = sectionOf(newest, COMPARE_TITLE);
    await expect(compare).toBeVisible();
    await expect(compare.getByText(/brands? gained$/)).toBeVisible();
    await expect(compare.getByText(/brands? lost$/)).toBeVisible();
    await expect(compare.getByText(/sources? gained$/)).toBeVisible();
    await expect(compare.getByText(/sources? lost$/)).toBeVisible();

    // The oldest answer has nothing before it: a reason, not an error
    const oldest = await openOldestAnswer(page);
    await expect(sectionOf(oldest, COMPARE_TITLE).getByText('No earlier answer to compare')).toBeVisible();
    await expect(oldest.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('opens the provider page in a new tab that cannot reach back', async ({ page, context }) => {
    // Nothing leaves the machine: the provider's page is answered here
    await context.route(
      (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
      (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>provider</title>' }),
    );
    const viewer = await openAnswer(page, 1280);
    const link = viewer.getByRole('link', { name: 'Open at the provider' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^https?:\/\//);
    const opened = context.waitForEvent('page');
    await link.click();
    const tab = await opened;
    expect(tab.url()).toBe(href);
    // `noopener`: the new tab has no `window.opener`
    expect(await tab.evaluate(() => window.opener === null)).toBe(true);
    await tab.close();
  });

  test('lists the facts with the hash of the answer and a button that copies it whole', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const viewer = await openAnswer(page, 1280);
    const facts = viewer.getByLabel('Extracted facts');
    await expect(facts).toBeVisible();
    const hash = facts.getByText(/^[0-9a-f]{12}/).first();
    await expect(hash).toBeVisible();
    await facts.getByRole('button', { name: 'Copy the full answer SHA-256' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^[0-9a-f]{64}$/);
    expect(copied.startsWith((await hash.textContent()) ?? '?')).toBe(true);
  });

  test('has no horizontal scroll on a phone, in any of its views', async ({ page }) => {
    const viewer = await openAnswer(page, 390);
    const fits = (): Promise<boolean> =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    for (const name of ['Formatted', 'Raw'] as const) {
      await chooseView(viewer, name);
      expect(await fits()).toBe(true);
    }
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`The answer viewer in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const width of [1280, 390]) {
      test(`has no accessibility violation in the Evidence, Formatted and Raw views at ${String(width)} px`, async ({
        page,
      }) => {
        const viewer = await openAnswer(page, width);
        await expect(sectionOf(viewer, COMPARE_TITLE)).toBeVisible();
        await expectAccessible(page);
        for (const name of ['Formatted', 'Raw'] as const) {
          await chooseView(viewer, name);
          await expectAccessible(page);
        }
      });
    }
  });
}
