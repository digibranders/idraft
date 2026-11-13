import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockId } from '../../src/mocks/mock-ids';
import { expectAccessible, signIn } from '../support';

/** An editor adds prompts and runs them; the drawer's header shows both. */
const EDITOR = 'priya@digibranders.test';
const THEME_KEY = 'idraft.theme';
const TOPICS = '/digibranders/fynix/ai/prompts';
/** The topics of the Fynix fixtures (`src/mocks/entity-fixtures.ts`): SEO holds Technical SEO and Local SEO; Paid Search stands alone. */
const SEO = mockId('term', 1);
const TECHNICAL_SEO = mockId('term', 2);
const PAID_SEARCH = mockId('term', 6);
/** The code of ChatGPT in the mock engines. */
const CHATGPT = 'chatgpt_web';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
/** Compact is the density every table opens in; Default is chosen with `?density=default`. */
const DENSITIES = ['compact', 'default'] as const;

const inspectUrl = (topicId: string, params: Record<string, string> = {}): string => {
  const query = new URLSearchParams({ inspect: `topic:${topicId}`, ...params });
  return `${TOPICS}?${query.toString()}`;
};

/** The drawer of a topic: beside the table on a wide window, a sheet over it on a narrow one. */
const drawerOf = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name }).or(page.getByRole('dialog', { name }));

/** Whichever topic drawer is open (its tab list names it), docked or a sheet. */
const anyDrawer = (page: Page): Locator =>
  page
    .getByRole('complementary')
    .or(page.getByRole('dialog'))
    .filter({ has: page.getByRole('tablist', { name: 'Topic sections' }) });

const topicsGrid = (page: Page): Locator => page.getByRole('treegrid', { name: 'Topics' });

/** The drawer is in once its tabs and the engine rows of the panel are. */
async function drawerReady(page: Page, name: string): Promise<Locator> {
  const drawer = drawerOf(page, name);
  await expect(drawer.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
  return drawer;
}

async function chooseOption(page: Page, scope: Locator, control: string | RegExp, option: string): Promise<void> {
  await scope.getByRole('combobox', { name: control }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** The names of the engine cells of a column that open a topic's prompts, with their text. */
const engineCells = (grid: Locator, engine: string): Locator =>
  grid.getByRole('button', { name: new RegExp(`^Open the prompts of .* on ${engine}$`) });

/** Cells that show a bare 0 without being a rate a person can open: where an answer is missing, the cell says so in words. */
const bareZeroCells = (grid: Locator): Promise<string[]> =>
  grid.evaluate((node) =>
    [...node.querySelectorAll('[role="gridcell"]')]
      .filter((cell) => cell.querySelector('button, a') === null)
      .map((cell) => (cell.textContent ?? '').trim())
      .filter((text) => /^0(\.0)?%?$/.test(text)),
  );

async function noSidewaysScroll(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_KEY, theme] as const,
  );
}

test.describe('Topics by engine: the views', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, EDITOR);
  });

  test('the view switch moves between the List, By engine and the Heat map, and the address keeps the choice', async ({
    page,
  }) => {
    await page.goto(TOPICS);
    const views = page.getByRole('radiogroup', { name: 'Topic view' });
    await expect(views.getByRole('radio', { name: 'List' })).toBeChecked();
    await expect(topicsGrid(page)).toBeVisible();

    await views.getByRole('radio', { name: 'By engine' }).click();
    await expect(page).toHaveURL(/[?&]view=engines(&|$)/);
    // "ChatGPT mention", not the List's "ChatGPT mentioned"
    await expect(topicsGrid(page).getByRole('columnheader', { name: /^ChatGPT mention\b/ })).toBeVisible();

    await views.getByRole('radio', { name: 'Heat map' }).click();
    await expect(page).toHaveURL(/[?&]view=heatmap(&|$)/);
    await expect(page.getByRole('heading', { name: 'Mention by topic and engine' })).toBeVisible();

    await views.getByRole('radio', { name: 'List' }).click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(topicsGrid(page).getByRole('columnheader', { name: /^ChatGPT mention\b/ })).toHaveCount(0);
    await expect(topicsGrid(page).getByRole('columnheader', { name: /^Citation rate/ })).toBeVisible();
  });

  test('By engine has a column per engine shown, the metric changes the values, and an unknown value is never 0', async ({
    page,
  }) => {
    await page.goto(`${TOPICS}?view=engines`);
    const grid = topicsGrid(page);
    for (const engine of ['ChatGPT', 'Gemini']) {
      await expect(grid.getByRole('columnheader', { name: new RegExp(`^${engine} mention`) })).toBeVisible();
    }
    // AI Mode is off for Fynix: no column for an engine that is not shown
    await expect(grid.getByRole('columnheader', { name: /^AI Mode/ })).toHaveCount(0);
    await expect(grid.getByRole('columnheader', { name: /^Engine gap/ })).toBeVisible();
    // At 1280 px every engine and the gap are on screen without scrolling the table sideways
    await expect(grid.getByRole('columnheader', { name: /^Gemini mention\b/ })).toBeInViewport();
    await expect(grid.getByRole('columnheader', { name: /^Engine gap/ })).toBeInViewport();
    await expect(engineCells(grid, 'ChatGPT').first()).toBeVisible();
    expect(await bareZeroCells(grid)).toEqual([]);

    const mention = await engineCells(grid, 'ChatGPT').allInnerTexts();
    await chooseOption(page, page.getByRole('main'), 'Metric of the engine columns', 'Citation');
    await expect(page).toHaveURL(/[?&]metric=citation(&|$)/);
    await expect(grid.getByRole('columnheader', { name: /^ChatGPT citation/ })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: /^ChatGPT mention\b/ })).toHaveCount(0);
    await expect.poll(() => engineCells(grid, 'ChatGPT').allInnerTexts()).not.toEqual(mention);
    expect(await bareZeroCells(grid)).toEqual([]);
  });

  test('one click on a By engine cell opens the prompts of that engine, and Back closes the drawer', async ({
    page,
  }) => {
    await page.goto(`${TOPICS}?view=engines`);
    await engineCells(topicsGrid(page), 'ChatGPT').first().click();
    const drawer = anyDrawer(page);
    await expect(drawer.getByRole('tab', { name: 'Prompts', selected: true })).toBeVisible();
    await expect(drawer.getByText('Engine: ChatGPT')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]eng=${CHATGPT}(&|$)`));

    await page.goBack();
    await expect(page).not.toHaveURL(/eng=/);
    await expect(page).not.toHaveURL(/inspect=/);
    await expect(drawer.getByText('Engine: ChatGPT')).toBeHidden();
    await expect(topicsGrid(page)).toBeVisible();
  });

  test('one click on a heat map cell opens the prompts of that engine; a topic name opens its Overview', async ({
    page,
  }) => {
    await page.goto(`${TOPICS}?view=heatmap`);
    await expect(page.getByRole('heading', { name: 'Mention by topic and engine' })).toBeVisible();
    await page.getByRole('link', { name: /^Paid Search on ChatGPT: / }).click();
    const drawer = await drawerReady(page, 'Paid Search');
    await expect(drawer.getByRole('tab', { name: 'Prompts', selected: true })).toBeVisible();
    await expect(drawer.getByText('Engine: ChatGPT')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]eng=${CHATGPT}(&|$)`));
    await expect(page).toHaveURL(/[?&]view=heatmap(&|$)/);

    // The chip's own button shows every engine again
    await drawer.getByRole('button', { name: 'Show every engine' }).click();
    await expect(page).not.toHaveURL(/eng=/);
    await expect(drawer.getByText('Engine: ChatGPT')).toBeHidden();
  });
});

test.describe('The topic drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, EDITOR);
  });

  test('two clicks from a topic name reach the prompts behind one engine, and Close takes the engine away', async ({
    page,
  }) => {
    await page.goto(TOPICS);
    await topicsGrid(page).getByRole('button', { name: 'Open the topic Paid Search' }).click();
    const drawer = await drawerReady(page, 'Paid Search');
    await expect(drawer.getByRole('tab', { name: 'Overview', selected: true })).toBeVisible();
    // Click 2: an engine row of the By engine panel
    await drawer.getByRole('link', { name: /^ChatGPT: / }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]eng=${CHATGPT}(&|$)`));
    await expect(drawer.getByRole('tab', { name: 'Prompts', selected: true })).toBeVisible();
    await expect(drawer.getByText('Engine: ChatGPT')).toBeVisible();
    await expect(drawer.getByText(/^\d+ prompts? (has|have) answers on ChatGPT, ordered by Mention\.$/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]eng=${CHATGPT}(&|$)`));

    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('complementary', { name: 'Paid Search' })).toBeHidden();
    await expect(page).not.toHaveURL(/eng=/);
    await expect(page).not.toHaveURL(/inspect=/);
  });

  test('shows the header badges, steps through the topics with J and K, and says where it is', async ({ page }) => {
    await page.goto(TOPICS);
    await topicsGrid(page).getByRole('button', { name: 'Open the topic Content Marketing' }).click();
    const drawer = anyDrawer(page);
    await expect(drawer.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
    await expect(drawer.getByText(/^\d+ prompts?$/).first()).toBeVisible();
    await expect(drawer.getByRole('group', { name: /^Scope of the counts: 2 engines/ })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Add prompt' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Run now' })).toBeVisible();

    // "N of M" is the topic's place in the order of the table, whichever order the rates give
    const position = drawer.getByText(/^\d+ of \d+$/);
    await expect(position).toBeVisible();
    const [at, total] = (await position.innerText()).split(' of ').map(Number);
    if (at === undefined || total === undefined || at < 2 || at >= total) {
      throw new Error('Content Marketing is not between two topics of the list');
    }
    const place = (index: number): string => `${String(index)} of ${String(total)}`;
    await page.keyboard.press('j');
    await expect(position).toHaveText(place(at + 1));
    await page.keyboard.press('k');
    await expect(position).toHaveText(place(at));
    await drawer.getByRole('button', { name: 'Previous topic' }).click();
    await expect(position).toHaveText(place(at - 1));
    await drawer.getByRole('button', { name: 'Next topic' }).click();
    await expect(position).toHaveText(place(at));
  });

  test('Add prompt opens the add dialog with the topic chosen, and Run now asks before it starts the prompts', async ({
    page,
  }) => {
    await page.goto(inspectUrl(PAID_SEARCH));
    const drawer = await drawerReady(page, 'Paid Search');
    await drawer.getByRole('button', { name: 'Add prompt' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add prompts' });
    await expect(dialog.getByRole('combobox', { name: /Topic/ })).toHaveText(/Paid Search/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    const run = drawer.getByRole('button', { name: 'Run now' });
    // The prompts are read first: the button waits for them
    await expect(run).not.toHaveAttribute('aria-disabled', 'true');
    await run.click();
    await page.getByRole('button', { name: 'Run 2 prompts' }).click();
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByText('Run started: 2 prompts on 2 engines'),
    ).toBeVisible();
  });

  test('has the tabs Overview, Prompts, Competitors and Related', async ({ page }) => {
    await page.goto(inspectUrl(PAID_SEARCH));
    const drawer = await drawerReady(page, 'Paid Search');
    await expect(drawer.getByRole('tab')).toHaveCount(4);
    for (const name of ['Overview', 'Prompts', 'Competitors', 'Related']) {
      await expect(drawer.getByRole('tab', { name, exact: true })).toBeVisible();
    }
  });

  test('the Overview has the engine panel with its counts, the comparison, the trend as a table, and In search', async ({
    page,
  }) => {
    await page.goto(inspectUrl(PAID_SEARCH));
    const drawer = await drawerReady(page, 'Paid Search');
    for (const engine of ['ChatGPT', 'Gemini']) {
      await expect(drawer.getByRole('link', { name: new RegExp(`^${engine}: `) })).toBeVisible();
    }
    // Every figure of the panel comes with its answers
    await expect(drawer.getByText(/\d+ of \d+ answers/).first()).toBeVisible();
    await expect(
      drawer.getByText(
        /^(Best on .* a gap of [\d.]+ pts\.|Every engine with a rate is at |Fewer than 2 engines have a rate|No engine names the brand|Left out for too few answers)/,
      ),
    ).toBeVisible();
    await expect(drawer.getByText('Each prompt counts once, whatever the number of its answers.')).toBeVisible();

    // The metric of the panel is its own control: it names the panel, and moves the Prompts of an engine too
    await chooseOption(page, drawer, 'Metric of the engine panel', 'Citation');
    await expect(drawer.getByRole('combobox', { name: 'Metric of the engine panel' })).toHaveText(/Citation/);

    const trend = drawer.getByRole('group', { name: 'Trend by engine view' });
    await trend.scrollIntoViewIfNeeded();
    await trend.getByRole('button', { name: 'Table' }).click();
    const table = drawer.getByRole('region', { name: 'Table of Trend by engine' });
    await expect(table.getByRole('columnheader', { name: 'Week' })).toBeVisible();
    await expect(table.getByRole('row').nth(1)).toBeVisible();

    await expect(drawer.getByRole('heading', { name: 'Visibility trend against competitors' })).toBeVisible();
    const inSearch = drawer.getByRole('heading', { name: 'In search' });
    await inSearch.scrollIntoViewIfNeeded();
    await expect(inSearch).toBeVisible();
  });

  test('the Competitors tab reads each entity by engine and the Related tab lists the topics beside this one', async ({
    page,
  }) => {
    await page.goto(inspectUrl(TECHNICAL_SEO));
    const drawer = await drawerReady(page, 'Technical SEO');
    // A topic under another says what is above it
    await expect(drawer.getByText('SEO', { exact: true }).first()).toBeVisible();

    await drawer.getByRole('tab', { name: 'Competitors' }).click();
    const competitors = drawer.getByRole('table', { name: 'Competitors by engine' });
    await expect(competitors.getByRole('columnheader', { name: 'Entity' })).toBeVisible();
    await expect(competitors.getByRole('row').nth(1)).toContainText('Fynix');
    await expect(competitors.getByText('own brand')).toBeVisible();

    await drawer.getByRole('tab', { name: 'Related' }).click();
    const related = drawer.getByRole('table', { name: 'Topics beside this one' });
    await expect(related.getByRole('columnheader', { name: 'Mention' })).toBeVisible();
    await related.getByRole('button', { name: 'Open the topic Local SEO' }).click();
    const sibling = await drawerReady(page, 'Local SEO');
    await expect(sibling.getByRole('tab', { name: 'Related', selected: true })).toBeVisible();
  });

  test('the Prompts tab of a topic lists the prompts of the topics under it', async ({ page }) => {
    await page.goto(inspectUrl(SEO, { itab: 'prompts' }));
    const drawer = await drawerReady(page, 'SEO');
    await expect(drawer.getByRole('tab', { name: 'Prompts', selected: true })).toBeVisible();
    await expect(drawer.getByText('Which SEO agency is best for a SaaS startup in Germany?')).toBeVisible();
    // Prompts of the topics under SEO are in the list too
    await expect(drawer.getByText('How do I run a technical SEO audit on a large site?')).toBeVisible();
  });
});

test.describe('Topics by engine on a phone', () => {
  test('the list rows say the best engine and the engine count, and a row opens the drawer as a sheet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, EDITOR);
    await page.goto(`${TOPICS}?view=engines`);
    const topics = page.getByRole('list', { name: /^Topics, \d+ results/ });
    await expect(topics).toBeVisible();
    // Under 768 px the By engine view is the list: the view switch offers List and Heat map only
    const views = page.getByRole('radiogroup', { name: 'Topic view' });
    await expect(views.getByRole('radio')).toHaveCount(2);
    await expect(topics.getByText(/^Best on .*, \d+ engines?$/).first()).toBeVisible();

    await topics.getByRole('button', { name: /Paid Search/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Paid Search' });
    await expect(sheet.getByRole('tablist', { name: 'Topic sections' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Paid Search' })).toHaveCount(0);
    // The panel stacks: an engine row is a full width link, and the sheet does not scroll sideways
    const row = sheet.getByRole('link', { name: /^ChatGPT: / });
    await expect(row).toBeVisible();
    const fits = await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth);
    expect(fits).toBe(true);

    // The scope badge and the two action buttons of the header sit side by side, none over another
    const scope = await sheet.getByRole('group', { name: /^Scope of the counts: / }).boundingBox();
    for (const name of ['Add prompt', 'Run now']) {
      const button = await sheet.getByRole('button', { name }).boundingBox();
      if (scope === null || button === null) throw new Error('The header has no box to measure');
      const apart =
        scope.x + scope.width <= button.x ||
        button.x + button.width <= scope.x ||
        scope.y + scope.height <= button.y ||
        button.y + button.height <= scope.y;
      expect(apart, `${name} is over the scope badge`).toBe(true);
    }

    // The Competitors table fits the sheet: the second engine is on screen without scrolling the names away
    await sheet.getByRole('tab', { name: 'Competitors' }).click();
    await expect(sheet.getByRole('columnheader', { name: 'Gemini' })).toBeInViewport();
    await sheet.getByRole('button', { name: 'Back to Topics & Prompts' }).click();
    await expect(sheet).toBeHidden();
  });
});

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    for (const density of DENSITIES) {
      test(`the Topics views and the drawer are accessible and fit at ${String(width)} px in the ${theme} theme, ${density} density`, async ({
        page,
      }) => {
        test.setTimeout(180_000);
        await setTheme(page, theme);
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, EDITOR);
        const densityParam = density === 'default' ? { density: 'default' } : {};
        const withDensity = (path: string): string => {
          const [base = '', query = ''] = path.split('?');
          const params = new URLSearchParams(query);
          for (const [key, value] of Object.entries(densityParam)) params.set(key, value);
          return `${base}?${params.toString()}`;
        };
        const check = async (): Promise<void> => {
          await expectAccessible(page);
          await noSidewaysScroll(page, width);
        };
        const checkDrawer = async (path: string, name: string, ready: (drawer: Locator) => Locator): Promise<void> => {
          await page.goto(withDensity(path));
          const drawer = await drawerReady(page, name);
          await expect(ready(drawer)).toBeVisible();
          await check();
          // The drawer's own content never scrolls sideways: a table wider than it scrolls inside its wrapper
          expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        };

        await page.goto(withDensity(`${TOPICS}?view=engines`));
        if (width < 768) await expect(page.getByRole('list', { name: /^Topics, \d+ results/ })).toBeVisible();
        else await expect(engineCells(topicsGrid(page), 'ChatGPT').first()).toBeVisible();
        await check();

        await page.goto(withDensity(`${TOPICS}?view=heatmap`));
        await expect(page.getByRole('link', { name: /^Paid Search on ChatGPT: / })).toBeVisible();
        await check();

        await checkDrawer(inspectUrl(PAID_SEARCH), 'Paid Search', (drawer) =>
          drawer.getByRole('link', { name: /^ChatGPT: / }),
        );
        await checkDrawer(inspectUrl(PAID_SEARCH, { itab: 'prompts', eng: CHATGPT }), 'Paid Search', (drawer) =>
          drawer.getByText('Engine: ChatGPT'),
        );
        await checkDrawer(inspectUrl(TECHNICAL_SEO, { itab: 'competitors' }), 'Technical SEO', (drawer) =>
          drawer.getByRole('table', { name: 'Competitors by engine' }),
        );
        await checkDrawer(inspectUrl(TECHNICAL_SEO, { itab: 'related' }), 'Technical SEO', (drawer) =>
          drawer.getByRole('table', { name: 'Topics beside this one' }),
        );
      });
    }
  }
}
