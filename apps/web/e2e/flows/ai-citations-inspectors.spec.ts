import { expect, test, type Locator, type Page } from '@playwright/test';

import { formatInteger } from '../../src/lib/format';
import { expectAccessible, signIn } from '../support';
import { EDITOR, pagesTable, THEME_KEY, openCitations } from '../support/ai-citations';
import {
  FIRST_DOMAIN,
  FLAGS,
  LOST_DOMAIN,
  NEW_DOMAIN,
  REDIRECTS_FLAG,
  addFlagFilter,
  awaitDomainInspector,
  awaitSourceInspector,
  changeCollection,
  changeRows,
  changeSegment,
  chooseTab,
  domainInspectorOf,
  expectPlacement,
  flagChip,
  inspectParam,
  openCitationsList,
  openDomainInspector,
  openNewLost,
  openSourceInspector,
  recordAiReads,
  routeOf,
  sourceInspectorOf,
  stripCount,
  visitDomainInspector,
  visitNewLost,
} from '../support/ai-citations-inspectors';

const PROMPTS_PATH = '/digibranders/fynix/ai/prompts';
const WIDTHS = [390, 768, 1024, 1280] as const;
const THEMES = ['light', 'dark'] as const;
/** Compact is the density every table opens in; Default is chosen with `?density=default`. */
const DENSITIES = ['compact', 'default'] as const;
const ENGINE_NAMES = /ChatGPT|Gemini/;

const tableOf = (inspector: Locator, name: string | RegExp): Locator => inspector.getByRole('table', { name });

/** The section of an inspector under a level 3 heading. */
const sectionOf = (inspector: Locator, heading: string): Locator =>
  inspector.getByRole('heading', { level: 3, name: heading, exact: true }).locator('xpath=ancestor::section[1]');

/** The answer viewer of the prompts page: beside the table on a wide window, a sheet over it on a narrow one. */
const viewerOf = (page: Page): Locator =>
  page.getByRole('complementary', { name: /answer, / }).or(page.getByRole('dialog', { name: /answer, / }));

/** Every row of `table` has its first cell (after the row's name) matching `pattern`: the cell is a bar until it loads. */
async function expectCells(table: Locator, pattern: RegExp): Promise<void> {
  const rows = table.getByRole('row');
  await expect(rows.nth(1)).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 1; index < count; index += 1) {
    await expect(rows.nth(index).getByRole('cell').first()).toHaveText(pattern);
  }
}

test.describe('The New and lost tab', () => {
  test('lists agency-radar.example as new and legacy-seo-wiki.example as lost', async ({ page }) => {
    await openNewLost(page, 1280);
    await expect(page.getByRole('tab', { name: 'New and lost' })).toHaveAttribute('aria-selected', 'true');
    // New is the shown kind and is not written to the address
    await expect(page).not.toHaveURL(/[?&]kind=/);
    await expect(changeSegment(page, 'new')).toBeChecked();
    await expect(changeRows(page, 'new', NEW_DOMAIN)).toContainText('Third party');
    await expect(changeRows(page, 'new', LOST_DOMAIN)).toHaveCount(0);

    await changeSegment(page, 'lost').click();
    await expect(page).toHaveURL(/[?&]kind=lost(&|$)/);
    await expect(changeSegment(page, 'lost')).toBeChecked();
    await expect(changeRows(page, 'lost', LOST_DOMAIN)).toContainText('Third party');
    await expect(changeRows(page, 'lost', NEW_DOMAIN)).toHaveCount(0);
    // The tab has no file to export
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  });

  test('the strip counts equal the segment counts', async ({ page }) => {
    await openNewLost(page, 1280);
    const added = await stripCount(page, 'New sources');
    const lost = await stripCount(page, 'Lost sources');
    // Both listed domains are counted, and a count is the same figure wherever it is drawn
    expect(added).toBeGreaterThan(0);
    expect(lost).toBeGreaterThan(0);
    await expect(changeSegment(page, 'new')).toHaveAccessibleName(`New ${formatInteger(added)}`);
    await expect(changeSegment(page, 'lost')).toHaveAccessibleName(`Lost ${formatInteger(lost)}`);
  });

  test('the Lost list says how many days it reads', async ({ page }) => {
    await openNewLost(page, 1280, 'lost');
    const note = page.getByText(
      /^Lost sources read [\d,]+ days of answers, three windows of [\d,]+ days, so this list can take a moment\.$/,
    );
    await expect(note).toBeVisible();
    const [read = 0, window = 0] =
      ((await note.textContent()) ?? '').match(/[\d,]+(?= days)/g)?.map((days) => Number(days.replaceAll(',', ''))) ??
      [];
    expect(window).toBeGreaterThan(0);
    // The lost read covers the asked window and the two before it
    expect(read).toBe(3 * window);
    // The New list has no such line
    await changeSegment(page, 'new').click();
    await expect(changeCollection(page, 'new')).toBeVisible();
    await expect(note).toHaveCount(0);
  });
});

test.describe('The flag toggles and the country scope', () => {
  test('the flag toggles are off by default and a chip appears when on', async ({ page }) => {
    await openNewLost(page, 1280);
    for (const flag of FLAGS) {
      await expect(flagChip(page, flag)).toHaveCount(0);
      expect(new URL(page.url()).searchParams.has(flag.key)).toBe(false);
    }
    for (const flag of FLAGS) {
      await addFlagFilter(page, flag);
      await expect(flagChip(page, flag)).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get(flag.key)).toBe('include');
    }
  });

  for (const flag of FLAGS) {
    test(`the request carries ${flag.param} only when ${flag.key} is on`, async ({ page }) => {
      const reads = recordAiReads(page);
      await openNewLost(page, 1280);
      // The strip asks for New and Lost; with the flag off no read of the page carries it
      await expect.poll(() => reads.filter((url) => routeOf(url) === '/ai/sources/changes').length).toBeGreaterThan(1);
      const sources = reads.filter((url) => routeOf(url).startsWith('/ai/sources/'));
      expect(sources.length).toBeGreaterThan(0);
      for (const url of sources) expect(url.searchParams.has(flag.param)).toBe(false);

      const flagged = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return routeOf(url) === '/ai/sources/changes' && url.searchParams.get(flag.param) === 'true';
      });
      await addFlagFilter(page, flag);
      await flagged;

      // The citations list route answers 422 for a flag, so it never gets one, flag on or off
      const citations = reads.filter((url) => routeOf(url) === '/ai/citations');
      expect(citations.length).toBeGreaterThan(0);
      for (const url of citations) expect(url.searchParams.has(flag.param)).toBe(false);
    });
  }

  test('the country control sets country=DE, narrows the strip and survives Clear filters', async ({ page }) => {
    await openCitations(page, 1280);
    const everywhere = await stripCount(page, 'Citation units');
    await expect(page).not.toHaveURL(/[?&]country=/);

    await page.getByRole('combobox', { name: 'Country: All countries' }).click();
    await page.getByRole('option', { name: 'Germany' }).click();
    await expect(page).toHaveURL(/[?&]country=DE(&|$)/);
    await expect(page.getByRole('combobox', { name: 'Country: Germany' })).toBeVisible();
    await expect(page.getByText(/^Only the prompts set in Germany are read\./)).toBeVisible();
    // The Hindi prompt is set in India, so Germany reads fewer units
    await expect.poll(() => stripCount(page, 'Citation units')).toBeLessThan(everywhere);

    // Country is scope: Clear filters takes the flag away and leaves the country
    await addFlagFilter(page, REDIRECTS_FLAG);
    await expect(page).toHaveURL(/[?&]redirects=include(&|$)/);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/[?&]redirects=/);
    await expect(page).toHaveURL(/[?&]country=DE(&|$)/);
    await expect(page.getByRole('combobox', { name: 'Country: Germany' })).toBeVisible();
    await expect(page.getByText(/^Only the prompts set in Germany are read\./)).toBeVisible();
  });
});

test.describe('The domain inspector', () => {
  test('a domain name opens the domain inspector, J and K step to the next and previous domain, Escape closes', async ({
    page,
  }) => {
    const inspector = await openDomainInspector(page, 1280);
    await expect.poll(() => inspectParam(page)).toBe(`domain:${FIRST_DOMAIN}`);
    const title = inspector.getByRole('heading', { level: 2 });
    await expect(title).toHaveText(FIRST_DOMAIN);
    await expect(inspector.getByText(/^1 of \d+$/)).toBeVisible();

    // J and K step from inside the card
    await title.focus();
    await page.keyboard.press('j');
    await expect(inspector.getByText(/^2 of \d+$/)).toBeVisible();
    await expect(title).not.toHaveText(FIRST_DOMAIN);
    await expect.poll(() => inspectParam(page)).not.toBe(`domain:${FIRST_DOMAIN}`);
    await page.keyboard.press('k');
    await expect(inspector.getByText(/^1 of \d+$/)).toBeVisible();
    await expect(title).toHaveText(FIRST_DOMAIN);
    await expect.poll(() => inspectParam(page)).toBe(`domain:${FIRST_DOMAIN}`);

    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);
    await expect.poll(() => inspectParam(page)).toBeNull();
  });

  test('the engine table, the trend and the entities show, and search share says not available', async ({ page }) => {
    const inspector = await openDomainInspector(page, 1280);
    await expect(inspector.getByRole('group', { name: 'Domain summary' })).toBeVisible();

    // One row for each engine, never a pooled one
    const engines = tableOf(inspector, `Citations of ${FIRST_DOMAIN} by engine`);
    await expect(engines.getByRole('rowheader', { name: 'ChatGPT' })).toBeVisible();
    await expect(engines.getByRole('rowheader', { name: 'Gemini' })).toBeVisible();
    await expect(engines.getByRole('rowheader', { name: /^(All|Total)/ })).toHaveCount(0);

    await expect(inspector.getByRole('heading', { level: 3, name: 'Share of citations by engine' })).toBeVisible();
    await expect(inspector.getByRole('img', { name: 'Share of citations by engine' })).toBeVisible();

    // The entities are named, or the card says none is: it has stopped reading either way
    const entities = sectionOf(inspector, 'Named when cited');
    await expect(entities).toBeVisible();
    await expect(entities).not.toHaveAttribute('aria-busy', 'true');
    await expect(entities.getByRole('listitem').or(entities.getByText('None named')).first()).toBeVisible();

    // No read of search share of voice exists: the card says so and draws no figure
    const share = sectionOf(inspector, 'Search share of voice');
    await expect(share.getByText('Not available yet')).toBeVisible();
    await expect(share).not.toContainText(/\d\s?%/);
    await expect(share.getByRole('link', { name: 'Open Rankings' })).toBeVisible();
  });

  test('its Pages tab lists the cited pages and a page opens its source inspector', async ({ page }) => {
    const inspector = await openDomainInspector(page, 1280);
    await chooseTab(inspector, 'Pages');
    const pages = tableOf(inspector, `Most cited pages of ${FIRST_DOMAIN}`);
    const first = pages.getByRole('row').nth(1).getByRole('link').first();
    await expect(first).toBeVisible();
    // A real link, so a middle click opens a new browser tab: the colon of the record is encoded
    const href = (await first.getAttribute('href')) ?? '';
    expect(href).toContain('inspect=source%3A');
    expect(new URL(href, page.url()).searchParams.get('inspect')).toMatch(/^source:\d+$/);
    await first.click();
    await awaitSourceInspector(page);
    await expect.poll(() => inspectParam(page)).toMatch(/^source:\d+$/);
    await expect(domainInspectorOf(page)).toHaveCount(0);
  });

  test('the Prompts tab shows the engines of each prompt, or n/a', async ({ page }) => {
    const inspector = await openDomainInspector(page, 1280);
    await chooseTab(inspector, 'Prompts');
    const prompts = tableOf(inspector, `Prompts whose answers cite ${FIRST_DOMAIN}`);
    await expect(prompts.getByRole('columnheader', { name: 'Engines' })).toBeVisible();
    await expectCells(prompts, /ChatGPT|Gemini|n\/a/);
  });
});

test.describe('The source inspector', () => {
  test('the Pages tab opens a source inspector from a page row', async ({ page }) => {
    await openCitations(page, 1280, { tab: 'pages' });
    // The page row opens the inspector: its link is a keyboard control inside the cell (F2), not the row's click target
    await pagesTable(page)
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: /^searchenginejournal\.com\/seo-guide\/?$/ }) })
      .getByRole('gridcell', { name: 'Third party' })
      .click();
    const inspector = await awaitSourceInspector(page);
    await expect.poll(() => inspectParam(page)).toMatch(/^source:\d+$/);
    for (const tab of ['Overview', 'Prompts', 'Answers']) {
      await expect(inspector.getByRole('tab', { name: tab, exact: true })).toBeVisible();
    }
    await expect(inspector.getByRole('heading', { level: 3, name: 'Citation trend' })).toBeVisible();
    await expect(inspector.getByRole('heading', { level: 3, name: 'Engines citing it' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);
    await expect.poll(() => inspectParam(page)).toBeNull();
  });

  test('the Answers tab link goes to the prompts page with the answer open', async ({ page }) => {
    const inspector = await openSourceInspector(page, 1280);
    await chooseTab(inspector, 'Answers');
    const link = inspector.getByRole('link', { name: /^Open the evidence of the answer of .+, source \d+$/ }).first();
    await expect(link).toBeVisible();

    // The link names the answer (colon encoded) and the source to show
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toContain('inspect=answer%3A');
    const target = new URL(href, page.url());
    expect(target.pathname).toBe(PROMPTS_PATH);
    const answer = target.searchParams.get('inspect') ?? '';
    expect(answer).toMatch(/^answer:.+/);
    const cite = target.searchParams.get('cite') ?? '';
    expect(cite).toMatch(/^[1-9]\d*$/);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`${PROMPTS_PATH}\\?`));
    const viewer = viewerOf(page);
    const sources = viewer.getByRole('list', { name: 'Sources cited in this answer' });
    await expect(sources).toBeVisible();
    // The key is read and spent: the cited source is the current one and has focus, and the address no longer names it
    const cited = sources.locator('li[aria-current="true"]');
    await expect(cited).toBeFocused();
    // The list item starts with its number and runs straight into the title: no word boundary between them
    await expect(cited).toContainText(new RegExp(`^${cite}(?!\\d)`));
    await expect.poll(() => new URL(page.url()).searchParams.has('cite')).toBe(false);
    expect(inspectParam(page)).toBe(answer);
  });

  test('the Prompts tab shows the engines of each prompt', async ({ page }) => {
    const inspector = await openSourceInspector(page, 1280);
    await chooseTab(inspector, 'Prompts');
    const prompts = tableOf(inspector, 'Prompts whose answers cite this page');
    await expect(prompts.getByRole('columnheader', { name: 'Engines' })).toBeVisible();
    await expectCells(prompts, ENGINE_NAMES);
  });
});

test.describe('Where the inspector is drawn', () => {
  test('390 px: the Domains tab is a list, a tap opens the inspector as a sheet with Back', async ({ page }) => {
    await openCitationsList(page, 390);
    const list = page.getByRole('list', { name: /^Cited domains, \d+ results?$/ });
    await expect(list).toBeVisible();
    await expect(page.getByRole('treegrid', { name: 'Cited domains' })).toHaveCount(0);

    await list.getByRole('button', { name: new RegExp(`^${FIRST_DOMAIN.replaceAll('.', '\\.')} `) }).click();
    const sheet = await awaitDomainInspector(page, FIRST_DOMAIN);
    expect(await expectPlacement(page, 'Domain views')).toBe('sheet');
    await expect(page.getByRole('dialog', { name: FIRST_DOMAIN })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Back to Citations' })).toBeVisible();
    await expect(sheet.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // Nothing widens the page
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await sheet.getByRole('button', { name: 'Back to Citations' }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => inspectParam(page)).toBeNull();
    await expect(page.getByRole('list', { name: /^Cited domains, \d+ results?$/ })).toBeVisible();
  });

  test('768 px: the inspector is an overlay card', async ({ page }) => {
    const inspector = await openDomainInspector(page, 768);
    // The main column cannot keep 720 px beside a card at this width, so the card lies over the list
    expect(await expectPlacement(page, 'Domain views')).toBe('overlay');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: 'Back to Citations' })).toHaveCount(0);
    await inspector.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(inspector).toHaveCount(0);
    await expect.poll(() => inspectParam(page)).toBeNull();
  });

  for (const width of [1024, 1280]) {
    test(`${String(width)} px: the inspector is docked or lies over the list by the docking rule`, async ({ page }) => {
      const inspector = await openDomainInspector(page, width);
      const mode = await expectPlacement(page, 'Domain views');
      expect(['docked', 'overlay']).toContain(mode);
      // A source inspector follows the same rule
      await chooseTab(inspector, 'Pages');
      await tableOf(inspector, `Most cited pages of ${FIRST_DOMAIN}`).getByRole('link').first().click();
      await awaitSourceInspector(page);
      expect(await expectPlacement(page, 'Source views')).toBe(mode);
    });
  }
});

for (const theme of THEMES) {
  test.describe(`Citations inspectors in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const width of WIDTHS) {
      for (const density of DENSITIES) {
        test(`has no accessibility violation on New and lost and with each inspector open at ${String(width)} px, ${density} density`, async ({
          page,
        }) => {
          test.setTimeout(240_000);
          const params = density === 'default' ? { density: 'default' } : {};
          await page.setViewportSize({ width, height: 900 });
          await signIn(page, EDITOR);

          // The New and lost tab, both lists
          await visitNewLost(page, 'new', params);
          await expectAccessible(page);
          await visitNewLost(page, 'lost', params);
          await expectAccessible(page);

          // The domain inspector, on each of its tabs
          const domain = await visitDomainInspector(page, FIRST_DOMAIN, params);
          await expect(domain.getByRole('img', { name: 'Share of citations by engine' })).toBeVisible();
          await expect(sectionOf(domain, 'Search share of voice').getByText('Not available yet')).toBeVisible();
          await expectAccessible(page);
          await chooseTab(domain, 'Pages');
          const pages = tableOf(domain, `Most cited pages of ${FIRST_DOMAIN}`);
          await expect(pages.getByRole('row').nth(1)).toBeVisible();
          await expectAccessible(page);
          await chooseTab(domain, 'Prompts');
          await expectCells(tableOf(domain, `Prompts whose answers cite ${FIRST_DOMAIN}`), /ChatGPT|Gemini|n\/a/);
          await expectAccessible(page);

          // The source inspector, reached from the domain's Pages tab, on each of its tabs
          await chooseTab(domain, 'Pages');
          await pages.getByRole('row').nth(1).getByRole('link').first().click();
          const source = await awaitSourceInspector(page);
          await expect(source.getByRole('heading', { level: 3, name: 'Engines citing it' })).toBeVisible();
          await expectAccessible(page);
          await chooseTab(source, 'Prompts');
          await expectCells(tableOf(source, 'Prompts whose answers cite this page'), ENGINE_NAMES);
          await expectAccessible(page);
          await chooseTab(source, 'Answers');
          await expect(tableOf(source, 'The latest answers that cite this page').getByRole('row').nth(1)).toBeVisible();
          await expectAccessible(page);

          // One inspector at a time: the source one replaced the domain one
          await expect(sourceInspectorOf(page)).toBeVisible();
          await expect(domainInspectorOf(page)).toHaveCount(0);
        });
      }
    }
  });
}
