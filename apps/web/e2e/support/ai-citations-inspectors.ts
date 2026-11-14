import { expect, type Locator, type Page } from '@playwright/test';

import { defaultInspectorWidth, inspectorPlacement, type InspectorMode } from '../../src/lib/inspector/placement';
import { signIn } from '../support';
import { EDITOR, FYNIX_CITATIONS, domainsTable, openCitations, stripOf } from './ai-citations';

/**
 * What the WP-22 Citations e2e shares (apps/web/e2e/flows/ai-citations-inspectors.spec.ts): the New and lost lists, the
 * two inspectors and the way into each, the strip figures, the request log and the docking rule. The WP-21 helpers
 * (`./ai-citations`) and `e2e/support.ts` are imported, never edited.
 */

/** The domain only the newest answers cite, so it is new in the default window (`citation-change-fixtures.ts`). */
export const NEW_DOMAIN = 'agency-radar.example';
/** The domain only old answers cite, so it is lost in the default window. */
export const LOST_DOMAIN = 'legacy-seo-wiki.example';
/** The most cited domain of the Fynix mock, first in the Domains table. */
export const FIRST_DOMAIN = 'searchenginejournal.com';

export type ChangeKind = 'new' | 'lost';

/** Below this width the tabs are lists and the inspector is a sheet (19 section 6.7, 16 section 2.6). */
const TABLE_FROM = 768;
export const isNarrow = (page: Page): boolean => (page.viewportSize()?.width ?? TABLE_FROM) < TABLE_FROM;

/** The text of a strip figure's value, from its term to its definition. */
const stripValue = (page: Page, term: string): Locator =>
  stripOf(page).getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::*[1]');

/** The whole number a strip figure shows ("1,204" is 1204). */
export async function stripCount(page: Page, term: string): Promise<number> {
  const text = (await stripValue(page, term).textContent()) ?? '';
  const digits = /\d[\d,]*/.exec(text)?.[0];
  if (digits === undefined) throw new Error(`The strip figure "${term}" has no number: "${text}"`);
  return Number(digits.replaceAll(',', ''));
}

/** The table (from 768 px) or the list (below) of one kind of the New and lost tab. */
export const changeCollection = (page: Page, kind: ChangeKind): Locator => {
  const caption = kind === 'new' ? 'New sources' : 'Lost sources';
  return isNarrow(page)
    ? page.getByRole('list', { name: new RegExp(`^${caption}, \\d+ results?$`) })
    : page.getByRole('grid', { name: caption });
};

/** The rows of that collection that name `domain`. */
export const changeRows = (page: Page, kind: ChangeKind, domain: string): Locator =>
  changeCollection(page, kind)
    .getByRole(isNarrow(page) ? 'listitem' : 'row')
    .filter({ hasText: domain });

/** The New or Lost segment of the tab, named with its count ("New 1"). */
export const changeSegment = (page: Page, kind: ChangeKind): Locator =>
  page.getByRole('radiogroup', { name: 'New or lost' }).getByRole('radio', {
    name: new RegExp(`^${kind === 'new' ? 'New' : 'Lost'} \\d+$`),
  });

/** Goes to the New and lost tab in the signed-in session and waits for the listed domain of `kind`. */
export async function visitNewLost(
  page: Page,
  kind: ChangeKind,
  params: Readonly<Record<string, string>> = {},
): Promise<void> {
  const query = new URLSearchParams({ tab: 'new-lost', ...(kind === 'lost' ? { kind } : {}), ...params });
  await page.goto(`${FYNIX_CITATIONS}?${query.toString()}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeVisible();
  await expect(changeRows(page, kind, kind === 'new' ? NEW_DOMAIN : LOST_DOMAIN)).toBeVisible();
}

/** Opens the page at `width` as the editor, on the New and lost tab. */
export async function openNewLost(
  page: Page,
  width: number,
  kind: ChangeKind = 'new',
  params: Readonly<Record<string, string>> = {},
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  await visitNewLost(page, kind, params);
}

/** Opens the Domains tab at a phone width as the editor: a list there, so no treegrid row header to wait for. */
export async function openCitationsList(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  await page.goto(FYNIX_CITATIONS);
  await expect(page.getByRole('heading', { level: 1, name: 'Citations' })).toBeVisible();
}

// -------------------------------------------------------------------------------------------------
// Filters

/**
 * Turns a flag toggle on through the filter bar. A one-choice enum applies when its option is picked, so no Apply
 * follows (13 section 3).
 */
export async function addFlagFilter(page: Page, flag: Flag): Promise<void> {
  await page.getByRole('button', { name: 'Add a filter' }).click();
  await page.getByRole('button', { name: flag.field, exact: true }).click();
  await page.getByRole('radio', { name: flag.option }).click();
}

export interface Flag {
  /** The URL key of the toggle. */
  key: 'redirects' | 'internal';
  /** The filter's name in the bar. */
  field: string;
  /** Its one option. */
  option: string;
  /** The query parameter the reads carry while it is on. */
  param: 'include_unresolved_redirects' | 'include_engine_internal';
}

export const REDIRECTS_FLAG: Flag = {
  key: 'redirects',
  field: 'Unresolved redirects',
  option: 'Include unresolved redirects',
  param: 'include_unresolved_redirects',
};
export const INTERNAL_FLAG: Flag = {
  key: 'internal',
  field: 'Engine links',
  option: 'Include engine-internal links',
  param: 'include_engine_internal',
};
export const FLAGS: readonly Flag[] = [REDIRECTS_FLAG, INTERNAL_FLAG];

/** The chip a flag that is on leaves in the filter bar. */
export const flagChip = (page: Page, flag: Flag): Locator =>
  page.getByRole('button', { name: `${flag.field}: ${flag.option}. Edit filter` });

// -------------------------------------------------------------------------------------------------
// Requests

/** Logs the API reads of the AI routes the page makes from now on, as addresses. */
export function recordAiReads(page: Page): URL[] {
  const seen: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/') && url.pathname.includes('/ai/')) seen.push(url);
  });
  return seen;
}

/** `/ai/sources/changes` for `.../projects/<id>/ai/sources/changes`. */
export const routeOf = (url: URL): string => url.pathname.slice(url.pathname.indexOf('/ai/'));

// -------------------------------------------------------------------------------------------------
// The inspectors

/** The inspector that holds a tab list named `tablist`: beside the list or over it, or a sheet on a phone. */
const inspectorWith = (page: Page, tablist: string): Locator => {
  const has = page.getByRole('tablist', { name: tablist });
  return page.getByRole('complementary').filter({ has }).or(page.getByRole('dialog').filter({ has }));
};
export const domainInspectorOf = (page: Page): Locator => inspectorWith(page, 'Domain views');
export const sourceInspectorOf = (page: Page): Locator => inspectorWith(page, 'Source views');

/** The record the address names, `domain:example.com` or `source:12`; `null` when none is open. */
export const inspectParam = (page: Page): string | null => new URL(page.url()).searchParams.get('inspect');

/** Waits until the domain inspector has its header and its strip is no longer reading. */
export async function awaitDomainInspector(page: Page, domain: string): Promise<Locator> {
  const inspector = domainInspectorOf(page);
  await expect(inspector.getByRole('heading', { level: 2, name: domain, exact: true })).toBeVisible();
  await expect(inspector.getByRole('group', { name: 'Domain summary' })).not.toHaveAttribute('aria-busy', 'true');
  return inspector;
}

/** Waits until the source inspector has its tabs and its strip is no longer reading. */
export async function awaitSourceInspector(page: Page): Promise<Locator> {
  const inspector = sourceInspectorOf(page);
  await expect(inspector.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(inspector.getByRole('group', { name: 'Source summary' })).not.toHaveAttribute('aria-busy', 'true');
  return inspector;
}

/** Goes to the Citations page with a domain inspector open on `itab`, in the signed-in session. */
export async function visitDomainInspector(
  page: Page,
  domain: string,
  params: Readonly<Record<string, string>> = {},
): Promise<Locator> {
  const query = new URLSearchParams({ inspect: `domain:${domain}`, ...params });
  await page.goto(`${FYNIX_CITATIONS}?${query.toString()}`);
  return awaitDomainInspector(page, domain);
}

/** Opens the Citations page at `width` and opens `domain` by its name in the Domains table (or its list below 768 px). */
export async function openDomainInspector(page: Page, width: number, domain = FIRST_DOMAIN): Promise<Locator> {
  await openCitations(page, width);
  if (isNarrow(page)) {
    await page
      .getByRole('list', { name: /^Cited domains, \d+ results?$/ })
      .getByRole('button', { name: new RegExp(`^${domain.replaceAll('.', '\\.')} `) })
      .click();
  } else {
    await domainsTable(page).getByRole('link', { name: domain, exact: true }).click();
  }
  return awaitDomainInspector(page, domain);
}

/** Chooses a tab of an inspector and waits until it is the chosen one. */
export async function chooseTab(inspector: Locator, name: string): Promise<void> {
  const tab = inspector.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Opens a source inspector the way the domain inspector offers it: its Pages tab lists the cited pages, each a link to
 * the page's inspector. Works at every width.
 */
export async function openSourceInspector(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, EDITOR);
  const domain = await visitDomainInspector(page, FIRST_DOMAIN, { itab: 'pages' });
  const table = domain.getByRole('table', { name: `Most cited pages of ${FIRST_DOMAIN}` });
  await table.getByRole('row').nth(1).getByRole('link').first().click();
  return awaitSourceInspector(page);
}

/**
 * Checks where the inspector of `tablist` is drawn against the docking rule of 16 section 2.6, and returns the mode:
 * a sheet below 768 px, else docked when the main column keeps 720 px and the card gets its minimum, else over the list.
 * Docked is the sticky card of the layout, over the list the fixed one.
 */
export async function expectPlacement(page: Page, tablist: string): Promise<InspectorMode> {
  const has = page.getByRole('tablist', { name: tablist });
  const aside = page.getByRole('complementary').filter({ has });
  const sheet = page.getByRole('dialog').filter({ has });
  const viewport = page.viewportSize()?.width ?? 0;
  if (viewport < TABLE_FROM) {
    await expect(sheet).toBeVisible();
    await expect(aside).toHaveCount(0);
    return 'sheet';
  }
  await expect(aside).toBeVisible();
  await expect(sheet).toHaveCount(0);
  // The layout measures the width beside the sidebar on its own wrapper, the card's parent
  const drawn = await aside.evaluate((element) => ({
    area: element.parentElement?.getBoundingClientRect().width ?? 0,
    position: getComputedStyle(element).position,
    right: element.getBoundingClientRect().right,
  }));
  const mode = inspectorPlacement({
    areaWidth: drawn.area,
    viewportWidth: viewport,
    preferred: defaultInspectorWidth('domain'),
  }).mode;
  expect(drawn.position).toBe(mode === 'docked' ? 'sticky' : 'fixed');
  expect(drawn.right).toBeLessThanOrEqual(viewport);
  return mode;
}
