import { expect, test, type Locator, type Page } from '@playwright/test';

import { signIn, watchPolicy } from '../support';
import { applyTheme, expectNoSidewaysScroll, saveLayout, startCustomizing } from '../support/ai-overview-competitors';
import {
  ADDED_CARDS,
  ALL_TITLES,
  BUILTIN_IDS,
  EDITOR,
  EVENTUS_PATH,
  FYNIX_PATH,
  KEY_CHANGES_TITLE,
  NOT_BUILT,
  POLITE,
  TOP_DOMAINS_TITLE,
  VIEWER,
  addCardDialog,
  addCatalogCard,
  addTenCards,
  awaitAllCards,
  awaitCard,
  cardById,
  cardGrid,
  cardByTitle,
  chooseDensity,
  customizeButton,
  engineTabs,
  expectNoDashes,
  hasAiEngines,
  makeRoom,
  openScreen,
  saveBar,
  saveSourcesLayout,
  tableToggle,
  viewChoice,
} from '../support/ai-overview-sources';
import { DENSITIES, THEMES, WIDTHS, expectNoSeriousViolations } from '../support/layouts';

/**
 * The source, fan-out, activity and operations cards of the AI visibility screen (WP-37, plan task T8): the cards of
 * the built-in layout are real, the others come through Customize and Add card, counts stand beside every percent, a
 * domain row opens the Citations page and Back returns with the scope, the By role view, the New and lost list, the
 * engine switch of the calendar and status cards by keyboard, the AI spend card and the permission that hides it,
 * and every card at four widths in both themes and both densities with no serious accessibility violation.
 *
 * Deviations from the plan, stated plainly:
 * - The plan names Eventus Security. Its AI runs, schedules and 92 days of answers exist only in a server that
 *   starts with the AI seed (`mocks/ai-seed.ts`: the development server). The production build this suite runs
 *   against (NEXT_PUBLIC_APP_ENV=test) has the seed off, so there Eventus says "No AI engine is on". The flows that
 *   need runs and a collection history (collection status with "View runs", the calendar and status cards with data,
 *   the key changes notices) are therefore written for Eventus and SKIP themselves, with the reason, when the server
 *   is not seeded. Everything else runs on Fynix in every build: three engines (two on), 23 prompts, sources, fan-out
 *   and one new source. On Fynix the collection status card shows its empty state (no run, no schedule) and the
 *   calendar and status cards show "No collection in this window", with their engine toolbar.
 * - A key changes row that is plain text because the Citations page cannot show the scope is not reproducible with the
 *   mock data: a scope that Citations cannot show (branded prompts alone) makes the feed leave the new sources row
 *   out ("Not checked: new sources") and no other row links to Citations. The plain text rule itself is covered by
 *   the unit tests of the card and of `parts/drill.ts`, not here.
 * - The viewer (no `costs:read`) cannot be given a layout that holds the spend card, so "no spend card on the page"
 *   rests on the catalog not offering it, the page not showing it, and no request to `budgets/status`.
 * - The role share card is named "Citation share by domain type" in the catalog and "Citation share by source role and
 *   engine" on the card; the diversity card "Source diversity" and "Source diversity over time" likewise.
 * - A layout holds 12 cards at most and the built-in one holds 9, so the flow hides seven of them to add the ten cards
 *   of this package (twelve in all).
 * - The mock keeps its state in page memory and in cookies, so no step reloads after a write except the theme and
 *   density changes of the accessibility flow, which only read.
 */
test.describe.configure({ timeout: 180_000 });

/**
 * What the page says of an error the browser logs: any console error fails the test. The one exception is a favicon
 * of a cited domain that the third-party favicon service does not know (a 404 of the browser, not of the app): the
 * Citations page asks it for the invented domains of the mock data.
 */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.includes('/s2/favicons')) errors.push(message.text());
  });
  return errors;
}

/** A percent and the counts beside it, per card (the counts are the card's own denominators, never a bare percent). */
const COUNTS_BESIDE_PERCENTS: ReadonlyArray<readonly [string, RegExp]> = [
  [TOP_DOMAINS_TITLE, /: \d+(?:\.\d)?% of citation units, [\d,]+ of [\d,]+ units, in [\d,]+ answers?/],
  [ADDED_CARDS.ownPages.title, /: [\d,]+ citation units?, in [\d,]+ prompts?, in [\d,]+ answers?/],
  [ADDED_CARDS.roleShare.title, /\d+(?:\.\d)?%, [\d,]+ of [\d,]+ units/],
  [ADDED_CARDS.fanout.title, /\d+(?:\.\d)?% of answers, issued in [\d,]+ of [\d,]+ answers?/],
  [ADDED_CARDS.newLost.title, /\d+ new domains?\s*of \d+ domains? cited/],
  [ADDED_CARDS.diversity.title, /\d+ distinct domains? over /],
  [ADDED_CARDS.engines.title, /\$[\d,.]+ (?:estimate|if on)/],
  [ADDED_CARDS.spend.title, /\$[\d,.]+ of \$[\d,.]+ this month \(\d+(?:\.\d)?%\)/],
];

/** The accessible text of every link of a card: the domain is the text before the first comma. */
async function linkNames(card: Locator): Promise<string[]> {
  return card.getByRole('link').evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
}

/** The inspector of a domain on the Citations page: beside the table on a wide window, a sheet over it on a narrow one. */
const domainInspector = (page: Page, domain: string): Locator =>
  page.getByRole('complementary', { name: domain }).or(page.getByRole('dialog', { name: domain }));

/** Presses Tab until the focus is on `target`; it takes a few presses to cross the controls before it. */
async function tabTo(page: Page, target: Locator, maxPresses = 12): Promise<void> {
  const focused = target.and(page.locator(':focus'));
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    if ((await focused.count()) > 0) return;
  }
  throw new Error(`The focus did not reach the target in ${String(maxPresses)} presses of Tab`);
}

/** Every card of the saved layout at four widths in both themes and both densities, with no serious axe violation. */
async function expectEveryCardAccessible(page: Page, email: string): Promise<void> {
  for (const density of DENSITIES) {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        await test.step(`${density} density, ${theme}, ${String(width)} px`, async () => {
          await page.setViewportSize({ width, height: 1100 });
          await chooseDensity(page, email, density);
          await applyTheme(page, theme);
          await awaitAllCards(page);
          await expect(cardGrid(page)).not.toContainText(NOT_BUILT);
          await expectNoSidewaysScroll(page, width);
          expectNoDashes(await cardGrid(page).innerText());
          await expectNoSeriousViolations(page);
        });
      }
    }
  }
}

test.describe('the source, fan-out, activity and operations cards, as an editor', () => {
  let policy: { violations: string[] };
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    policy = watchPolicy(page);
    errors = watchConsole(page);
    await signIn(page, EDITOR);
  });

  test.afterEach(() => {
    expect(policy.violations, 'Content Security Policy violations').toEqual([]);
    expect(errors, 'console errors').toEqual([]);
  });

  test('the built-in cards are real, the other ten are added and saved, and each shows counts beside its percents', async ({
    page,
  }) => {
    await test.step('the top cited domains and key changes cards of the built-in layout are real', async () => {
      await openScreen(page, FYNIX_PATH);
      for (const [id, title] of [
        [BUILTIN_IDS.topDomains, TOP_DOMAINS_TITLE],
        [BUILTIN_IDS.keyChanges, KEY_CHANGES_TITLE],
      ] as const) {
        const card = cardById(page, id);
        await card.scrollIntoViewIfNeeded();
        await expect(card.getByRole('heading', { name: title })).toBeVisible();
        await expect(card).not.toContainText(NOT_BUILT);
      }
      await expect(cardById(page, BUILTIN_IDS.topDomains)).toContainText(/\d+ citation units? in \d+ answers?/);
    });

    await test.step('the AI spend card is in the Add card catalog for an editor, with the others', async () => {
      await startCustomizing(page);
      await makeRoom(page);
      await cardGrid(page).locator('[data-add-card-slot]').click();
      const dialog = addCardDialog(page);
      for (const card of Object.values(ADDED_CARDS)) {
        await expect(dialog.getByRole('button', { name: `Add ${card.catalog}`, exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

    await test.step('add the ten cards and save the layout', async () => {
      await addTenCards(page);
      await saveLayout(page);
      await expect(cardGrid(page).locator('[data-layout-card]')).toHaveCount(12);
      await awaitAllCards(page);
      await expect(cardGrid(page)).not.toContainText(NOT_BUILT);
      for (const title of ALL_TITLES) await expect(cardByTitle(page, title)).toBeVisible();
    });

    await test.step('every card that shows a percent shows the counts beside it', async () => {
      for (const [title, counts] of COUNTS_BESIDE_PERCENTS) {
        await expect(cardByTitle(page, title), title).toContainText(counts);
      }
    });

    await test.step('the AI spend card shows the budget meter with its figures', async () => {
      const spend = cardByTitle(page, ADDED_CARDS.spend.title);
      const meter = spend.getByRole('meter');
      await expect(meter).toBeVisible();
      await expect(meter).toHaveAttribute('aria-valuemin', '0');
      await expect(meter).toHaveAttribute('aria-valuemax', '100');
      await expect(spend).toContainText(/Workspace budget|Project budget/);
    });

    await test.step('the engines card names each engine, its cost as an estimate, and adds nothing up', async () => {
      const engines = cardByTitle(page, ADDED_CARDS.engines.title);
      await expect(engines).toContainText(/\d of \d engines on/);
      await expect(engines).toContainText(/never added up/);
    });

    await test.step('the collection card and the activity cards without runs say why in their empty state', async () => {
      // Fynix has no AI run and no schedule; the next step of the Eventus flow reads the same cards with a history
      if (await hasAiEngines(page)) {
        await expect(cardByTitle(page, ADDED_CARDS.collection.title)).toContainText('No AI run has finished yet');
        await expect(cardByTitle(page, ADDED_CARDS.calendar.title)).toContainText('No collection in this window');
        await expect(cardByTitle(page, ADDED_CARDS.status.title)).toContainText('No collection in this window');
      }
    });
  });

  test('a domain row opens the Citations page with the domain inspector, and Back returns to the scope', async ({
    page,
  }) => {
    // The comparison off is a scope that the card carries into its links and that Back must return to
    await openScreen(page, FYNIX_PATH, 1280, '?cmp=off');
    const card = await awaitCard(page, TOP_DOMAINS_TITLE);
    await expect(card).not.toContainText(/\b(?:up|down) [\d.]+ pts\b/);
    const row = card.getByRole('link', { name: /^searchenginejournal\.com, Third party: / });
    await expect(row).toHaveAttribute('href', /\/ai\/citations\?.*tab=domains/);
    await row.click();

    await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeVisible();
    await expect(page).toHaveURL(/\/ai\/citations\?/);
    await expect(page).toHaveURL(/[?&]tab=domains(&|$)/);
    await expect(page).toHaveURL(/[?&]cmp=off(&|$)/);
    await expect(page).toHaveURL(/[?&]inspect=domain%3Asearchenginejournal\.com(&|$)/);
    await expect(domainInspector(page, 'searchenginejournal.com')).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'AI visibility' })).toBeVisible();
    await expect(page).toHaveURL(/\/ai\?cmp=off$/);
    const back = await awaitCard(page, TOP_DOMAINS_TITLE);
    await expect(back).toContainText(/citation units/);
    await expect(back).not.toContainText(/\b(?:up|down) [\d.]+ pts\b/);
  });

  test('the By role view switches by keyboard, and the Table view lists every domain in both views', async ({
    page,
  }) => {
    await openScreen(page, FYNIX_PATH);
    const card = await awaitCard(page, TOP_DOMAINS_TITLE);
    const choice = viewChoice(card);
    const ranked = choice.getByRole('radio', { name: 'Ranked', exact: true });
    const byRole = choice.getByRole('radio', { name: 'By role', exact: true });
    await expect(ranked).toBeChecked();

    await test.step('the Table view of the ranked list has every domain', async () => {
      const domains = (await linkNames(card)).map((name) => name.split(',')[0] ?? '');
      expect(domains.length).toBeGreaterThan(2);
      await tableToggle(card).click();
      await expect(tableToggle(card)).toHaveAttribute('aria-pressed', 'true');
      const table = card.getByRole('table');
      for (const domain of domains) await expect(table).toContainText(domain);
      expect(await table.getByRole('row').count()).toBeGreaterThanOrEqual(domains.length + 1);
      await tableToggle(card).click();
      await expect(tableToggle(card)).toHaveAttribute('aria-pressed', 'false');
    });

    await test.step('an arrow key moves to By role and the change is announced', async () => {
      await ranked.focus();
      await page.keyboard.press('ArrowRight');
      await expect(byRole).toBeChecked();
      await expect(page.locator(POLITE)).toHaveText('View changed to By role');
      for (const role of ['Own', 'Competitor', 'Third party']) {
        await expect(card.getByText(new RegExp(`^${role}$`)).first()).toBeVisible();
      }
      await expect(card).toContainText(/of citation units, [\d,]+ of [\d,]+ units/);
    });

    await test.step('the Table view of By role lists every domain with its role and units', async () => {
      const domains = (await linkNames(card)).map((name) => name.split(',')[0] ?? '');
      expect(domains.length).toBeGreaterThan(2);
      await tableToggle(card).click();
      const table = card.getByRole('table');
      await expect(table.getByRole('columnheader', { name: 'Role' })).toBeVisible();
      for (const domain of domains) await expect(table).toContainText(domain);
      await expect(table).toContainText(/[\d,]+ of [\d,]+ units/);
      await tableToggle(card).click();
    });

    await test.step('an arrow key moves back to Ranked', async () => {
      await byRole.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(ranked).toBeChecked();
      await expect(page.locator(POLITE)).toHaveText('View changed to Ranked');
    });
  });

  test('the New and lost card counts its domains and a row opens the New and lost tab of Citations', async ({
    page,
  }) => {
    await openScreen(page, FYNIX_PATH);
    await startCustomizing(page);
    await addCatalogCard(page, ADDED_CARDS.newLost.catalog);
    await saveLayout(page);
    const card = await awaitCard(page, ADDED_CARDS.newLost.title);

    const tabs = card.getByRole('toolbar', { name: /new or lost/i });
    await expect(tabs).toBeVisible();
    await expect(card).toContainText(/\d+ new domains?\s*of \d+ domains? cited/);
    const newTab = tabs.getByRole('button', { name: /^New, \d+$/ });
    const lostTab = tabs.getByRole('button', { name: /^Lost, \d+$/ });
    await expect(tabs.getByRole('button', { name: /^Both, \d+$/ })).toBeVisible();
    await expect(newTab).toHaveAttribute('aria-pressed', 'true');

    // Keyboard: the toolbar is one Tab stop (the pressed tab), arrows move the focus, Enter presses
    // Tab starts from the card's title: a click on text does not move the focus start in a headless window
    await card.getByRole('heading', { level: 2 }).evaluate((title: HTMLElement) => {
      title.tabIndex = -1;
      title.focus();
    });
    await tabTo(page, newTab);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(lostTab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(POLITE)).toContainText(/Lost domains shown/);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(newTab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(POLITE)).toContainText(/New domains shown/);

    const row = card.getByRole('link', { name: /: new, [\d,]+ citation units? now/ }).first();
    await expect(row).toHaveAttribute('href', /\/ai\/citations\?.*tab=new-lost/);
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]tab=new-lost(&|$)/);
    await expect(page).toHaveURL(/[?&]kind=new(&|$)/);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'AI visibility' })).toBeVisible();
  });

  test('the key changes feed names its groups and links no row to Citations when the page cannot show the scope', async ({
    page,
  }) => {
    await openScreen(page, FYNIX_PATH);
    const feed = cardById(page, BUILTIN_IDS.keyChanges);
    await feed.scrollIntoViewIfNeeded();
    await expect(feed).toContainText(/Changes\s*\d+ changes?/);
    await expect(feed.getByRole('link', { name: /^New sources: \d+ domains?/ })).toHaveAttribute(
      'href',
      /\/ai\/citations\?.*tab=new-lost/,
    );

    // Branded prompts alone is a scope that Citations cannot show: the feed does not read the sources then
    await openScreen(page, FYNIX_PATH, 1280, '?branded=only');
    const limited = cardById(page, BUILTIN_IDS.keyChanges);
    await limited.scrollIntoViewIfNeeded();
    await expect(limited).toContainText('Not checked: new sources');
    await expect(limited.locator('a[href*="/citations"]')).toHaveCount(0);
  });

  test('every card renders at 390, 768, 1024 and 1280 px in both themes and densities with no serious axe violation', async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await openScreen(page, FYNIX_PATH);
    await saveSourcesLayout(page);
    await expectEveryCardAccessible(page, EDITOR);
  });
});

test.describe('the activity cards with a collection history (a server that starts with the AI seed)', () => {
  let policy: { violations: string[] };
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    policy = watchPolicy(page);
    errors = watchConsole(page);
    await signIn(page, EDITOR);
    await openScreen(page, EVENTUS_PATH);
    test.skip(
      !(await hasAiEngines(page)),
      'Eventus Security has no AI engine on in a server without the AI seed (the production test build): its runs and collection history exist only in the development server',
    );
  });

  test.afterEach(() => {
    expect(policy.violations, 'Content Security Policy violations').toEqual([]);
    expect(errors, 'console errors').toEqual([]);
  });

  test('collection status counts its answers and View runs opens Runs', async ({ page }) => {
    await saveSourcesLayout(page);
    const card = await awaitCard(page, ADDED_CARDS.collection.title);
    await expect(card).toContainText(/AI prompts, .+: [\d,]+ of [\d,]+ answers asked collected, [\d,]+ failed/);
    await expect(card).toContainText(/Next run: /);

    const engines = await awaitCard(page, ADDED_CARDS.engines.title);
    await expect(engines).toContainText(/Mon and Thu/);

    await card.getByRole('link', { name: 'View runs', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await expect(page).toHaveURL(/\/ops\/runs/);
  });

  test('the calendar and status cards switch engine by keyboard and the key changes feed names its groups', async ({
    page,
  }) => {
    await saveSourcesLayout(page);

    for (const title of [ADDED_CARDS.calendar.title, ADDED_CARDS.status.title]) {
      await test.step(`${title}: one engine at a time, switched with the keyboard`, async () => {
        const card = await awaitCard(page, title);
        const tabs = engineTabs(card);
        await expect(tabs).toBeVisible();
        const buttons = tabs.getByRole('button');
        expect(await buttons.count()).toBeGreaterThanOrEqual(3);
        // The first press is the first engine ("All" means the first engine here, never a sum)
        await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
        const metaBefore = (await card.innerText()).match(/valid answers? of|answers collected are valid/);
        expect(metaBefore).not.toBeNull();
        await buttons.first().focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect(page.locator(POLITE)).toContainText(/ shown, [\d,]+ answers collected$/);
        await expect(buttons.nth(2)).toHaveAttribute('aria-pressed', 'true');
        await expect(buttons.first()).toHaveAttribute('aria-pressed', 'false');
        // The cell is not a tab stop: its words are in the names and tooltip, the Table view and the export
        await expect(card.locator('[data-cell][tabindex="0"]')).toHaveCount(0);
        await tableToggle(card).click();
        await expect(card.getByRole('table')).toContainText(/Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d{4}|[A-Z][a-z]{2} \d{1,2}/);
        await tableToggle(card).click();
      });
    }

    await test.step('the key changes feed lists its group with a count', async () => {
      const feed = cardById(page, BUILTIN_IDS.keyChanges);
      await feed.scrollIntoViewIfNeeded();
      await expect(feed).toContainText(/Notices\s*\d+ changes?/);
      await expect(feed.getByRole('link', { name: /answers failed in the AI run/ })).toHaveAttribute(
        'href',
        /\/ops\/runs/,
      );
    });
  });

  test('every card renders at 390, 768, 1024 and 1280 px in both themes and densities with no serious axe violation', async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await saveSourcesLayout(page);
    await expectEveryCardAccessible(page, EDITOR);
  });
});

test.describe('the cards as a viewer without costs:read', () => {
  test('the Add card catalog does not list AI spend, the page has no spend card and made no budgets request', async ({
    page,
  }) => {
    const policy = watchPolicy(page);
    const errors = watchConsole(page);
    const budgetReads: string[] = [];
    page.on('request', (request) => {
      if (/\/budgets\/status/.test(request.url())) budgetReads.push(request.url());
    });
    await signIn(page, VIEWER);
    await openScreen(page, FYNIX_PATH);
    await awaitCard(page, TOP_DOMAINS_TITLE);

    await expect(cardGrid(page)).not.toContainText('AI spend');
    await expect(cardByTitle(page, ADDED_CARDS.spend.title)).toHaveCount(0);

    await expect(customizeButton(page)).toBeEnabled();
    await customizeButton(page).click();
    await expect(saveBar(page)).toBeVisible();
    await cardGrid(page).locator('[data-add-card-slot]').click();
    const dialog = addCardDialog(page);
    // The catalog is there (the other activity cards are offered) and it leaves the spend card out
    await expect(dialog.getByRole('button', { name: `Add ${ADDED_CARDS.engines.catalog}`, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add AI spend', exact: true })).toHaveCount(0);
    await expect(dialog).not.toContainText('AI spend');
    await page.keyboard.press('Escape');

    expect(budgetReads, 'requests to budgets/status').toEqual([]);
    expect(policy.violations, 'Content Security Policy violations').toEqual([]);
    expect(errors, 'console errors').toEqual([]);
  });
});
