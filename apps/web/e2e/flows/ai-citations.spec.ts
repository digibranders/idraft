import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { formatInteger } from '../../src/lib/format';
import { expectAccessible, signIn } from '../support';
import {
  domainCount,
  domainsTable,
  EDITOR,
  FIRST_PROMPT,
  FYNIX_CITATIONS,
  inspectorOf,
  openCitations,
  openInspectorCitations,
  pagesTable,
  scopeUnits,
  stripOf,
  THEME_KEY,
  visitCitations,
  visitInspectorCitations,
} from '../support/ai-citations';

/** The domains the Fynix mock answers cite, most cited first, with the role the project gives each. */
const OWN = 'fynix.digital';
const COMPETITOR = 'brightwave.digital';
const THIRD_PARTIES = ['searchenginejournal.com', 'example.com'];
const STRIP_FIGURES = [
  'Citation units',
  'Distinct domains',
  'Effective sources',
  'Own citation share',
  'New sources',
  'Lost sources',
];

const domainRow = (page: Page, domain: string): Locator =>
  domainsTable(page).getByRole('row', { name: new RegExp(`^${domain.replaceAll('.', '\\.')} `) });

/** The text of a strip figure's value, from its term to its definition. */
const stripValue = (page: Page, term: string): Locator =>
  stripOf(page).getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::*[1]');

const textOf = async (locator: Locator): Promise<string> => (await locator.textContent()) ?? '';

/** Reads a downloaded file as text, without its byte order mark. */
async function readDownload(download: { path: () => Promise<string> }): Promise<string[]> {
  const text = await readFile(await download.path(), 'utf8');
  return text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
}

test.describe('The Citations page', () => {
  test('shows the strip, the Domains table and a domain that expands to its pages', async ({ page }) => {
    await openCitations(page, 1280);

    // The strip: six figures, and the own share is of the units the tables' shares are of
    const strip = stripOf(page);
    for (const figure of STRIP_FIGURES) await expect(strip.getByRole('term').filter({ hasText: figure })).toBeVisible();
    const units = formatInteger(await scopeUnits(page));
    await expect(stripValue(page, 'Citation units')).toContainText(units);
    await expect(stripValue(page, 'Own citation share')).toContainText(new RegExp(`\\d+ of ${units} units`));

    // The Domains table: the columns of DS 9.7, each domain with its role
    const table = domainsTable(page);
    for (const column of ['Domain', 'Role', 'Units', 'Share', 'Change', 'Cited with', 'Status', 'Trend']) {
      // A column's name is its title and the name of its options button
      await expect(table.getByRole('columnheader', { name: `${column} ${column} column options` })).toBeVisible();
    }
    await expect(table.getByRole('columnheader', { name: 'ChatGPT ChatGPT column options' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Gemini Gemini column options' })).toBeVisible();
    await expect(domainRow(page, OWN)).toContainText('Own');
    await expect(domainRow(page, COMPETITOR)).toContainText('Competitor');
    for (const domain of THIRD_PARTIES) await expect(domainRow(page, domain)).toContainText('Third party');
    await expect(page.getByText(/^\d+ domains?$/).first()).toBeVisible();

    // A domain opens onto its pages and closes again
    const open = page.getByRole('button', { name: `Expand pages of ${THIRD_PARTIES[0]}` });
    await open.click();
    await expect(
      table.getByRole('link', { name: /^Open searchenginejournal\.com\/seo-guide in a new tab$/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: `Collapse pages of ${THIRD_PARTIES[0]}` }).click();
    await expect(
      table.getByRole('link', { name: /^Open searchenginejournal\.com\/seo-guide in a new tab$/ }),
    ).toHaveCount(0);
    await expect(open).toBeVisible();
  });

  test('opens View all pages on the Pages tab filtered to the domain, with Cited with', async ({ page }) => {
    await openCitations(page, 1280);

    // The Fynix mock holds one page for each domain, so a domain never has more pages than the 10 it opens onto
    // and "View all N pages" is not drawn. The link goes to the address the Domains tab builds for it (`tab=pages`
    // and `domain=equals:<domain>`), which is driven here
    await page.getByRole('button', { name: `Expand pages of ${COMPETITOR}` }).click();
    await expect(
      domainsTable(page).getByRole('link', { name: /^Open brightwave\.digital\/blog in a new tab$/ }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /^View all/ })).toHaveCount(0);

    await visitCitations(page, { tab: 'pages', domain: `equals:${COMPETITOR}` });
    await expect(page.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Domain/ })).toContainText(
      COMPETITOR,
    );
    const table = pagesTable(page);
    await expect(table.getByRole('link', { name: /^Open brightwave\.digital\/blog in a new tab$/ })).toBeVisible();
    await expect(table.getByRole('rowheader')).toHaveCount(1);
    // Cited with is the domain's, and the column says so
    await expect(table.getByRole('columnheader', { name: /^Cited with \(domain\)/ })).toBeVisible();
    await expect(
      table.getByRole('row', { name: new RegExp(`^https://${COMPETITOR.replaceAll('.', '\\.')}/blog `) }),
    ).toContainText('Brightwave Digital');

    // The card above the table: the prompts whose answers cite no page of the project, each with the domains cited instead
    await expect(page.getByRole('region', { name: 'Prompts with no own page cited' })).toBeVisible();
  });

  test('a Role filter narrows the rows and leaves the Own citation share', async ({ page }) => {
    await openCitations(page, 1280);
    // Every row the table draws, so the filter has something to narrow: the four domains of the answers and any
    // the New and lost fixtures add (agency-radar.example)
    const all = await domainCount(page);
    expect(all).toBeGreaterThan(THIRD_PARTIES.length);
    const share = await textOf(stripValue(page, 'Own citation share'));
    const units = await textOf(stripValue(page, 'Citation units'));

    await page.getByRole('button', { name: 'Add a filter' }).click();
    await page.getByRole('button', { name: 'Role', exact: true }).click();
    await page.getByRole('button', { name: 'Only Third party' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/[?&]role=third_party(&|$)/);
    await expect(page.getByRole('button', { name: 'Role: Third party. Edit filter' })).toBeVisible();
    await expect(domainsTable(page).getByRole('rowheader')).toHaveCount(THIRD_PARTIES.length);
    expect(THIRD_PARTIES.length).toBeLessThan(all);
    for (const domain of THIRD_PARTIES) await expect(domainRow(page, domain)).toBeVisible();
    await expect(domainRow(page, OWN)).toHaveCount(0);
    await expect(domainRow(page, COMPETITOR)).toHaveCount(0);
    // The strip is of the whole scope: the role filter never narrows it
    await expect(stripValue(page, 'Own citation share')).toHaveText(share);
    await expect(stripValue(page, 'Citation units')).toHaveText(units);
  });

  test('a larger minimum leaves rows out and keeps the strip', async ({ page }) => {
    await openCitations(page, 1280);
    const all = await domainCount(page);
    expect(all).toBeGreaterThan(0);
    const units = await textOf(stripValue(page, 'Citation units'));
    const share = await textOf(stripValue(page, 'Own citation share'));

    await page.goto(`${FYNIX_CITATIONS}?min=1000`);
    // No row reaches 1,000 units, so the table has none to draw and says why
    await expect(
      page.getByRole('heading', { level: 2, name: 'No domain or page matches these filters' }),
    ).toBeVisible();
    await expect(page.getByText('Lower the fewest citation units to see more rows.')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Fewest citation units' })).toHaveText('At least 1,000 units');
    await expect(domainsTable(page).getByRole('rowheader')).toHaveCount(0);
    // The strip does not change with the minimum, which only sets what counts as a New source
    await expect(stripValue(page, 'Citation units')).toHaveText(units);
    await expect(stripValue(page, 'Own citation share')).toHaveText(share);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/[?&]min=/);
    await expect(domainsTable(page).getByRole('rowheader')).toHaveCount(all);
    await expect(page.getByRole('combobox', { name: 'Fewest citation units' })).toHaveText('At least 2 units');
  });

  test('exports the table as a CSV with the units and the total', async ({ page }) => {
    await openCitations(page, 1280);
    const total = await scopeUnits(page);
    const all = await domainCount(page);
    expect(all).toBeGreaterThan(0);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^citations-domains-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
      `${String(all)} of ${String(all)} domains exported`,
    );
    const [header = '', ...rows] = await readDownload(download);
    const columns = header.split(',');
    // The units and what they are of: a share is never exported without the units it is a share of
    expect(columns.slice(0, 7)).toEqual([
      'Domain',
      'Role',
      'Citation units',
      'Source share (%)',
      'Total citation units in scope',
      'Answers',
      'Prompts',
    ]);
    expect(columns).toContain('Citation units on ChatGPT');
    expect(columns).toContain('Citation units on Gemini');
    expect(rows).toHaveLength(all);
    let listed = 0;
    for (const row of rows) {
      const cells = row.split(',');
      expect(Number(cells[4])).toBe(total);
      listed += Number(cells[2]);
    }
    // Every domain is listed, so their units are the whole scope
    expect(listed).toBe(total);
    expect(rows[0]?.startsWith(`${THIRD_PARTIES[0] ?? ''},Third party,`)).toBe(true);

    // The Pages tab exports its own rows, each with its address
    await visitCitations(page, { tab: 'pages' });
    const [pagesDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(pagesDownload.suggestedFilename()).toMatch(/^citations-pages-/);
    const [pagesHeader = '', ...pageRows] = await readDownload(pagesDownload);
    expect(pagesHeader.split(',').slice(0, 5)).toEqual(['URL', 'Title', 'Domain', 'Role', 'Citation units']);
    expect(pageRows).toHaveLength(4);
    expect(pageRows[0]?.startsWith('https://www.searchenginejournal.com/seo-guide/,')).toBe(true);
  });

  test('the sidebar link Citations opens the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, EDITOR);
    await page.goto('/digibranders/fynix/seo/keywords');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const link = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Citations' });
    await expect(link).not.toHaveAttribute('aria-current', 'page');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${FYNIX_CITATIONS}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('tab', { name: 'Domains' })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('The Citations tab of the prompt inspector', () => {
  test('shows the banner, Top domains with roles, Top pages and the answers, and says Source N of M', async ({
    page,
  }) => {
    const inspector = await openInspectorCitations(page, 1280);

    // The banner says what is so and judges nothing
    await expect(
      inspector.getByText(/^Cited in \d+ of \d+ answers?; last answer .+; \d+ own pages? cited$/),
    ).toBeVisible();

    const domains = inspector.getByRole('table', { name: 'Most cited domains for this prompt' });
    await expect(
      domains.getByRole('row', { name: new RegExp(`^${COMPETITOR.replaceAll('.', '\\.')} Competitor `) }),
    ).toBeVisible();
    await expect(domains.getByRole('row', { name: new RegExp(`^${OWN.replaceAll('.', '\\.')} Own `) })).toBeVisible();
    // Every share names the units it is a share of
    await expect(domains.getByRole('row', { name: /of \d+ units?/ }).first()).toBeVisible();

    const pages = inspector.getByRole('table', { name: 'Most cited pages for this prompt' });
    await expect(pages.getByRole('link', { name: /^Open fynix\.digital\/seo-audit in a new tab$/ })).toBeVisible();

    // The answers: where the own page stood among the sources of the answer, never as a rank
    const answers = inspector.getByRole('table', { name: 'Own page cited in each answer' });
    await expect(answers.getByRole('button', { name: /^Open the (ChatGPT|Gemini) answer of / }).first()).toBeVisible();
    await expect(answers.getByText(/^Source \d+ of \d+$/).first()).toBeVisible();
    await expect(answers.getByText('Not cited').first()).toBeVisible();
    await expect(inspector.getByRole('tabpanel', { name: 'Citations' })).not.toContainText(/rank/i);
  });

  test('the engine select splits the lists by engine and never writes rank', async ({ page }) => {
    const inspector = await openInspectorCitations(page, 1280);
    const panel = inspector.getByRole('tabpanel', { name: 'Citations' });
    const domains = inspector.getByRole('table', { name: 'Most cited domains for this prompt' });

    // All engines: one column of units for each engine, never one pooled figure, and they add up to the Units
    await expect(inspector.getByRole('radio', { name: 'All engines' })).toBeChecked();
    await expect(domains.getByRole('columnheader')).toHaveText(['Domain', 'Units', /^ChatGPT/, /^Gemini/]);
    const first = domains.getByRole('row').nth(1);
    const [unitsCell = '', chatgpt = '', gemini = ''] = await first.getByRole('cell').allInnerTexts();
    expect(Number(/^\d+/.exec(unitsCell)?.[0])).toBe(Number(chatgpt) + Number(gemini));
    await expect(panel).not.toContainText(/rank/i);
    const allUnits = await scopeUnits(inspector);

    // One engine: its own lists, read over its own answers, and the page says which engine is read
    await inspector.getByRole('radio', { name: 'ChatGPT' }).click();
    await expect(inspector.getByRole('radio', { name: 'ChatGPT' })).toBeChecked();
    await expect(
      inspector.getByText('Only ChatGPT is read. The last answer date above covers all engines.'),
    ).toBeVisible();
    await expect(domains.getByRole('columnheader')).toHaveText(['Domain', 'Units']);
    await expect.poll(() => scopeUnits(inspector)).toBeLessThan(allUnits);
    await expect(panel).not.toContainText(/rank/i);

    await inspector.getByRole('radio', { name: 'Gemini' }).click();
    await expect(
      inspector.getByText('Only Gemini is read. The last answer date above covers all engines.'),
    ).toBeVisible();
    await expect(panel).not.toContainText(/rank/i);

    await inspector.getByRole('radio', { name: 'All engines' }).click();
    await expect(domains.getByRole('columnheader')).toHaveText(['Domain', 'Units', /^ChatGPT/, /^Gemini/]);
    await expect.poll(() => scopeUnits(inspector)).toBe(allUnits);
  });

  test('the count of other domains opens a list of at most 5 domains', async ({ page }) => {
    const inspector = await openInspectorCitations(page, 1280);
    const answers = inspector.getByRole('table', { name: 'Own page cited in each answer' });
    const trigger = answers.getByRole('button', { name: /^\d+ domains? cited in this answer, show them$/ }).first();
    await trigger.click();
    const list = page.getByRole('dialog', { name: /^(Cited instead|Also cited)$/ });
    await expect(list).toBeVisible();
    const items = await list.getByRole('listitem').count();
    expect(items).toBeGreaterThan(0);
    expect(items).toBeLessThanOrEqual(5);
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('is a sheet on a phone with its tabs reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, EDITOR);
    const sheet = await visitInspectorCitations(page);
    await expect(page.getByRole('dialog', { name: FIRST_PROMPT })).toBeVisible();
    await expect(page.getByRole('complementary', { name: FIRST_PROMPT })).toHaveCount(0);
    // The Citations tab is in the row and is the one chosen; its lists and answers are in the sheet
    await expect(sheet.getByRole('tab', { name: 'Citations' })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.getByRole('heading', { level: 3, name: 'Top domains' })).toBeVisible();
    await expect(sheet.getByRole('heading', { level: 3, name: 'Cited in each answer' })).toBeAttached();
    // Another tab is reached from the row, and the one that does not fit is under More tabs
    await sheet.getByRole('tab', { name: 'History' }).click();
    await expect(sheet.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    await sheet.getByRole('button', { name: 'More tabs' }).click();
    await page.getByRole('menuitem', { name: 'Stats' }).click();
    await expect(sheet.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
    await sheet.getByRole('tab', { name: 'Citations' }).click();
    await expect(sheet.getByRole('tab', { name: 'Citations' })).toHaveAttribute('aria-selected', 'true');
    // Nothing widens the page
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Citations in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
    });

    for (const width of [1280, 390]) {
      test(`has no accessibility violation on Domains, Pages and the prompt tab at ${String(width)} px`, async ({
        page,
      }) => {
        // At 390 px the Domains and Pages tabs are lists (WP-22), so `openCitations` waits for the list there
        await openCitations(page, width);
        await expectAccessible(page);
        await visitCitations(page, { tab: 'pages' });
        await expectAccessible(page);
        // A popover of the page, open: the card of prompts with no own page names the domains cited instead
        await page
          .getByRole('button', { name: /^\d+ domains? cited instead for this prompt, show them$/ })
          .first()
          .click();
        await expect(page.getByRole('dialog', { name: 'Cited instead' })).toBeVisible();
        await expectAccessible(page);
        await visitInspectorCitations(page);
        await expectAccessible(page);
        await expect(inspectorOf(page).getByRole('tab', { name: 'Citations' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
      });
    }
  });
}
