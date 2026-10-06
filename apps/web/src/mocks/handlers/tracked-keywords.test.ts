import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  keywordProjectCaller,
  MAX_FILTER_MATCHES,
  MAX_TRACKED_KEYWORDS,
  quotaProblem,
  selectedRows,
  subjectLimit,
  type KeywordProjectCaller,
} from './keyword-rules';
import { MOCK_ENTITY_IDS, MOCK_TERMS, MOCK_TERM_IDS } from '../entity-fixtures';
import { readingOf } from '../factories/keyword';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { MOCK_GROUP_IDS, MOCK_TRACKED_KEYWORDS, PENDING_TRACKED_IDS } from '../keyword-fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { KEYWORDS_COOKIE, keywordWorld, readKeywordChanges } from '../keywords-state';
import { mockId } from '../mock-ids';
import { MOCK_SCHEDULE_IDS } from '../operations-fixtures';
import { FAILED_IDS, rankStateOf, type TrackedKeywordState } from '../rank-state';
import { SESSION_COOKIE } from '../session';
import { TEST_API_ORIGIN } from '@/test/api-server';
import {
  BULK_ARCHIVE_RESULT,
  BULK_CREATE_RESULT,
  BULK_UPDATE_RESULT,
  COMPETITOR_SET,
  CONFIG_VERSION,
  TRACKED_KEYWORD,
  TRACKED_KEYWORD_DETAIL,
  TRACKED_KEYWORD_PAGE,
  TRACKED_KEYWORD_ROW,
} from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;
const TK = `${P}/tracked-keywords`;
const ROWS = z.array(TRACKED_KEYWORD_ROW);
const CREATED = z.array(TRACKED_KEYWORD);
const HISTORY = z.array(CONFIG_VERSION);

/** The fixture's tracked keyword id of a table row, by text and the row's other values. */
const trackedId = (text: string, extra: { location?: number; device?: string } = {}): string => {
  const index = KEYWORD_TABLE.findIndex(
    (row) =>
      row.text === text && row.location === (extra.location ?? 2276) && row.device === (extra.device ?? 'desktop'),
  );
  if (index < 0) throw new Error(`No fixture row for ${text}`);
  return mockId('tracked', index + 1);
};
const SERVICE_TERM = (slug: string): string => {
  const term = MOCK_TERMS.find((candidate) => candidate.slug === slug);
  if (term === undefined) throw new Error(`No term ${slug}`);
  return term.term_id;
};

const listOf = async (browser: MockBrowser, query: string): Promise<z.infer<typeof ROWS>> =>
  dataOf(await browser.call('GET', `${TK}?limit=200&${query}`), ROWS);
const textsOf = async (browser: MockBrowser, query: string): Promise<string[]> =>
  (await listOf(browser, query)).map((row) => row.keyword.text);

const ACTIVE = KEYWORD_TABLE.filter((row) => row.archived !== true);

describe('tracked keywords: the list', () => {
  it('pages active keywords by keyword then id, with the filtered total, and binds the cursor to the filters', async () => {
    const viewer = mockBrowser('viewer');
    const first = await viewer.call('GET', `${TK}?limit=5`);
    const page = pageOf(first, TRACKED_KEYWORD_PAGE);
    expect(page).toMatchObject({ limit: 5, has_more: true, total: ACTIVE.length });
    const texts = dataOf(first, ROWS).map((row) => row.keyword.text);
    expect(texts).toEqual([...texts].sort());
    expect(texts[0]).toBe('ai overviews seo');
    // `include` and `limit` may change between pages; the filters may not
    const second = await viewer.call('GET', `${TK}?limit=10&include=metrics&cursor=${page.next_cursor ?? ''}`);
    expect(dataOf(second, ROWS)[0]?.keyword.text).not.toBe(texts[4]);
    const other = await viewer.call('GET', `${TK}?limit=5&filter[device]=mobile&cursor=${page.next_cursor ?? ''}`);
    expect(other).toMatchObject({ status: 400, code: 'invalid_cursor' });
  });

  it('gives the blocks `include` names and null for the others', async () => {
    const [row] = await listOf(
      mockBrowser('viewer'),
      'filter[q]=seo agency berlin&filter[device]=desktop&include=groups,terms',
    );
    expect(row?.metrics).toBeNull();
    expect(row?.competitors).toBeNull();
    expect(row?.groups).toEqual([{ group_id: MOCK_GROUP_IDS.local, name: 'Local', path: 'Local' }]);
    expect(row?.terms?.map((term) => [term.path, term.vocabulary_kind])).toEqual([['seo/local-seo', 'topic']]);
    expect(fieldCodes(await mockBrowser('viewer').call('GET', `${TK}?include=ranks`))).toEqual(['include:enum']);
  });

  it('sorts a metric with the keywords that have none last in both directions', async () => {
    const viewer = mockBrowser('viewer');
    // Tied on the missing metric, so in row id order
    const pending = ['generative engine optimization', 'llm seo', 'chatgpt seo agency'];
    for (const sort of ['-search_volume', 'search_volume']) {
      const rows = await listOf(viewer, `sort=${sort}&include=metrics`);
      expect(rows.slice(-3).map((row) => row.keyword.text)).toEqual(pending);
      expect(rows.slice(-3).every((row) => row.metrics === null)).toBe(true);
      const volumes = rows.slice(0, -3).map((row) => row.metrics?.search_volume.value ?? -1);
      expect(volumes).toEqual([...volumes].sort((a, b) => (sort.startsWith('-') ? b - a : a - b)));
    }
    expect(fieldCodes(await viewer.call('GET', `${TK}?sort=rank`))).toEqual(['sort:invalid_sort']);
    expect(fieldCodes(await viewer.call('GET', `${TK}?sort=priority,-priority`))).toEqual(['sort:invalid_sort']);
  });

  it('filters by a group with its subgroups, by terms with the terms under them, and by text and metrics', async () => {
    const viewer = mockBrowser('viewer');
    const inServices = ACTIVE.filter((row) => row.group === 'audits' || row.group === 'content').length;
    expect(await listOf(viewer, `filter[group]=${MOCK_GROUP_IDS.services}`)).toHaveLength(inServices);
    // SEO takes in Technical SEO and Local SEO
    const seoFamily = ACTIVE.filter((row) => ['seo', 'technical', 'local'].includes(row.topic ?? '')).length;
    expect(await listOf(viewer, `filter[term_in]=${MOCK_TERM_IDS.seo}`)).toHaveLength(seoFamily);
    expect(await textsOf(viewer, 'filter[q]=SEO  Agentur')).toEqual(['seo agentur', 'seo agentur berlin']);
    // Spaces only normalize to nothing, which matches no keyword
    expect(await textsOf(viewer, 'filter[q]=%20%20')).toEqual([]);
    expect(await textsOf(viewer, 'filter[is_active]=false')).toEqual([
      'seo meme',
      'seo newsletter',
      'wordpress seo plugin',
    ]);
    const big = await listOf(viewer, 'filter[search_volume_gte]=20000&include=metrics');
    expect(big.map((row) => row.keyword.text)).toEqual(['backlink checker', 'seo agency']);
    expect(fieldCodes(await viewer.call('GET', `${TK}?filter[priority_lte]=9`))).toEqual([
      'filter[priority_lte]:less_than_equal',
    ]);
  });
});

describe('tracked keywords: tracking', () => {
  it('creates with the project defaults, `both` as two rows desktop first, and refuses viewers', async () => {
    const editor = mockBrowser('editor');
    const answer = await editor.call('POST', TK, { keyword: '  Fynix   Pricing ', device: 'both' });
    expect(answer.status).toBe(201);
    const rows = dataOf(answer, CREATED);
    expect(rows.map((row) => row.device)).toEqual(['desktop', 'mobile']);
    expect(rows[0]).toMatchObject({
      keyword: { text: 'Fynix Pricing', normalized_text: 'fynix pricing' },
      location_id: 2276,
      depth_profile: 'standard',
      frequency: 'daily',
      priority: 3,
      funnel_stage: 'unknown',
      intent: 'unknown',
      intent_source: null,
      config_version: 1,
    });
    expect(rows[0]?.keyword.keyword_id).toBe(rows[1]?.keyword.keyword_id);
    expect(await editor.as('viewer').call('POST', TK, { keyword: 'seo' })).toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('reports every service error together and refuses search operators', async () => {
    const editor = mockBrowser('editor');
    const answer = await editor.call('POST', TK, {
      keyword: 'site:fynix.digital seo',
      location_id: 1,
      group_ids: [mockId('group', 99)],
      target_url: 'ftp://fynix.digital',
    });
    expect(fieldCodes(answer)).toEqual([
      'keyword:search_operator_not_allowed',
      'location_id:location_unknown',
      'target_url:invalid_url',
      'group_ids:group_unknown',
    ]);
    expect(fieldCodes(await editor.call('POST', TK, { keyword: 'seo', priority: 6 }))).toEqual([
      'priority:less_than_equal',
    ]);
  });

  it('answers a live or archived duplicate with 409 and its id', async () => {
    const editor = mockBrowser('editor');
    expect(await editor.call('POST', TK, { keyword: 'SEO Audit' })).toMatchObject({
      status: 409,
      code: 'duplicate',
      body: { existing_id: trackedId('seo audit') },
    });
    expect(await editor.call('POST', TK, { keyword: 'seo meme' })).toMatchObject({
      status: 409,
      body: { existing_id: trackedId('seo meme') },
    });
  });

  it('brings a deleted keyword back with its stored settings, links and overrides, adding what fits', async () => {
    const editor = mockBrowser('editor');
    const id = trackedId('crawl budget');
    await editor.call('PATCH', `${TK}/${id}`, { priority: 1 });
    await editor.call('POST', `${TK}/bulk-update`, { ids: [id], add_term_ids: [SERVICE_TERM('seo-audit')] });
    await editor.call('PUT', `${TK}/${id}/competitors`, { exclude: [MOCK_ENTITY_IDS.rankforge] });
    expect((await editor.call('DELETE', `${TK}/${id}`)).status).toBe(204);
    expect(await editor.call('GET', `${TK}/${id}`)).toMatchObject({ status: 404 });
    const answer = await editor.call('POST', TK, {
      keyword: 'crawl budget',
      priority: 5,
      group_ids: [MOCK_GROUP_IDS.brand],
      term_ids: [SERVICE_TERM('link-building'), MOCK_TERM_IDS.paidSearch],
      competitor_overrides: { include: [MOCK_ENTITY_IDS.seoWeekly] },
    });
    const [row] = dataOf(answer, CREATED);
    expect(row).toMatchObject({ tracked_keyword_id: id, priority: 1, is_active: true });
    const detail = dataOf(await editor.call('GET', `${TK}/${id}`), TRACKED_KEYWORD_DETAIL);
    expect(detail.groups.map((group) => group.name).sort()).toEqual(['Brand', 'SEO audits']);
    // The single-valued Services vocabulary keeps the stored term; Topics takes the new one
    expect(detail.terms.map((term) => term.name).sort()).toEqual(['Paid Search', 'SEO Audit', 'Technical SEO']);
    expect(detail.competitor_overrides.map((override) => [override.entity.entity_id, override.mode])).toEqual([
      [MOCK_ENTITY_IDS.rankforge, 'exclude'],
    ]);
  });

  it('gives a keyword added in the browser metrics two minutes after it is first tracked', async () => {
    const editor = mockBrowser('editor');
    const [row] = dataOf(await editor.call('POST', TK, { keyword: 'seo for dentists' }), CREATED);
    if (row === undefined) throw new Error('Nothing was created');
    const world = keywordWorld(readKeywordChanges({ [KEYWORDS_COOKIE]: editor.cookie(KEYWORDS_COOKIE) ?? '' }));
    const created = Date.parse(row.created_at);
    expect(readingOf(world, row.keyword.keyword_id, 2276, row.language_code, created + 60_000)).toBeNull();
    expect(readingOf(world, row.keyword.keyword_id, 2276, row.language_code, created + 3 * 60_000)).not.toBeNull();
    // A fixture keyword without metrics stays pending
    const pending = MOCK_TRACKED_KEYWORDS.find((candidate) => candidate.tracked_keyword_id === trackedId('llm seo'));
    expect(pending && readingOf(world, pending.keyword_id, 2276, 'en', Date.now() + 3_600_000)).toBeNull();
  });
});

describe('tracked keywords: the workspace quota', () => {
  /** An editor's caller whose workspace already keeps `used` active keywords. */
  function callerUsing(used: number): KeywordProjectCaller {
    const request = new Request(`${TEST_API_ORIGIN}${TK}`);
    const session = `mock.active.${mockUser('editor').user_id}.${String(Date.now() + 60_000)}`;
    const caller = keywordProjectCaller(
      request,
      { [SESSION_COOKIE]: session },
      MOCK_WORKSPACE.workspace_id,
      fynix?.project_id,
      { permission: 'keywords:write' },
    );
    if (caller instanceof Response) throw new Error('The editor cannot write keywords');
    const [template] = MOCK_TRACKED_KEYWORDS;
    if (template === undefined) throw new Error('No tracked keyword fixture');
    const tracked = Array.from({ length: used }, (_, index) => ({
      ...template,
      tracked_keyword_id: mockId('tracked', index + 1),
    }));
    return { ...caller, keywords: { ...caller.keywords, tracked } };
  }

  it('lets the request through up to the limit and answers 422 with limit, used and requested past it', async () => {
    const request = new Request(`${TEST_API_ORIGIN}${TK}`, { method: 'POST' });
    expect(quotaProblem(request, callerUsing(MAX_TRACKED_KEYWORDS - 2), 2)).toBeNull();
    const over = quotaProblem(request, callerUsing(MAX_TRACKED_KEYWORDS - 1), 2);
    expect(over?.status).toBe(422);
    expect(await over?.json()).toMatchObject({
      code: 'quota_exceeded',
      limit: MAX_TRACKED_KEYWORDS,
      used: MAX_TRACKED_KEYWORDS - 1,
      requested: 2,
    });
  });
});

describe('tracked keywords: the text of a search', () => {
  it('takes 1 to 200 printable characters, and refuses a control character, a format character or an empty text', async () => {
    const viewer = mockBrowser('viewer');
    const list = (q: string): ReturnType<MockBrowser['call']> =>
      viewer.call('GET', `${TK}?limit=5&filter[q]=${encodeURIComponent(q)}`);
    expect((await list('seo agency')).status).toBe(200);
    expect(fieldCodes(await list('seo\tagency'))).toEqual(['filter[q]:value_error']);
    expect(fieldCodes(await list('seo​agency'))).toEqual(['filter[q]:value_error']);
    expect(fieldCodes(await list('seo agency'))).toEqual(['filter[q]:value_error']);
    expect(fieldCodes(await list(''))).toEqual(['filter[q]:string_too_short']);
    expect((await list('x'.repeat(200))).status).toBe(200);
    expect(fieldCodes(await list('x'.repeat(201)))).toEqual(['filter[q]:string_too_long']);
    // Characters, not UTF-16 units: 200 emoji are fine
    expect((await list('😀'.repeat(200))).status).toBe(200);
  });

  it('takes the same text in the filter of a bulk change', async () => {
    const editor = mockBrowser('editor');
    expect(
      fieldCodes(await editor.call('POST', `${TK}/bulk-delete`, { filter: { is_active: true, q: 'seo\tagency' } })),
    ).toEqual(['filter.q:value_error']);
  });
});

describe('tracked keywords: how many keywords one bulk change may touch', () => {
  /** A caller whose project tracks `count` live keywords. */
  function callerTracking(count: number): KeywordProjectCaller {
    const request = new Request(`${TEST_API_ORIGIN}${TK}`);
    const session = `mock.active.${mockUser('editor').user_id}.${String(Date.now() + 60_000)}`;
    const caller = keywordProjectCaller(
      request,
      { [SESSION_COOKIE]: session },
      MOCK_WORKSPACE.workspace_id,
      fynix?.project_id,
      { permission: 'keywords:write' },
    );
    if (caller instanceof Response) throw new Error('The editor cannot write keywords');
    const [template] = MOCK_TRACKED_KEYWORDS;
    if (template === undefined) throw new Error('No tracked keyword fixture');
    const tracked = Array.from({ length: count }, (_, index) => ({
      ...template,
      tracked_keyword_id: mockId('tracked', index + 1),
    }));
    return { ...caller, keywords: { ...caller.keywords, tracked } };
  }
  const idsOf = (count: number): string[] => Array.from({ length: count }, (_, index) => mockId('tracked', index + 1));
  const request = new Request(`${TEST_API_ORIGIN}${TK}/bulk-update`, { method: 'POST' });

  it('limits a request to 200,000 link changes in all: 20,000 rows, fewer as each row gains or loses more links', () => {
    expect(subjectLimit(0)).toBe(MAX_FILTER_MATCHES);
    expect(subjectLimit(1)).toBe(20_000);
    expect(subjectLimit(10)).toBe(20_000);
    expect(subjectLimit(50)).toBe(4_000);
    expect(subjectLimit(101)).toBe(1_980);
    expect(subjectLimit(400)).toBe(500);
  });

  it('refuses 5,000 chosen keywords when each gains or loses 50 groups, with the limit that would have fit', async () => {
    const caller = callerTracking(5_000);
    const body = { ids: idsOf(5_000) };
    const refused = selectedRows(request, caller, body, 'ids', 'filter', 50);
    expect(refused).toBeInstanceOf(Response);
    if (!(refused instanceof Response)) throw new Error('The mock took 5,000 keywords at 50 links each');
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'too_many_subjects', limit: 4_000 });
    // 4,000 keywords fit, and so do 5,000 at 40 links (200,000 in all)
    expect(selectedRows(request, caller, { ids: idsOf(4_000) }, 'ids', 'filter', 50)).toHaveLength(4_000);
    expect(selectedRows(request, caller, body, 'ids', 'filter', 40)).toHaveLength(5_000);
  });

  it('applies the same limit to the rows a filter matches, and counts a link whether or not the row has it', async () => {
    const caller = callerTracking(4_001);
    const body = { filter: { is_active: true } };
    const refused = selectedRows(request, caller, body, 'ids', 'filter', 50);
    expect(refused).toBeInstanceOf(Response);
    if (!(refused instanceof Response)) throw new Error('The mock took 4,001 matches at 50 links each');
    expect(await refused.json()).toMatchObject({ code: 'too_many_subjects', limit: 4_000 });
    expect(selectedRows(request, caller, body, 'ids', 'filter', 49)).toHaveLength(4_001);
  });
});

describe('tracked keywords: one keyword', () => {
  it('refuses identity fields, versions a target URL change, and marks a given intent as manual', async () => {
    const editor = mockBrowser('editor');
    const id = trackedId('seo audit');
    expect(fieldCodes(await editor.call('PATCH', `${TK}/${id}`, { device: 'mobile' }))).toEqual([
      'device:immutable_field',
    ]);
    const answer = await editor.call('PATCH', `${TK}/${id}`, {
      target_url: 'https://fynix.digital/seo-audit/',
      intent: 'transactional',
    });
    expect(dataOf(answer, TRACKED_KEYWORD)).toMatchObject({
      config_version: 2,
      intent: 'transactional',
      intent_source: 'manual',
      target_url: { host: 'fynix.digital', path: '/seo-audit/' },
    });
    const history = dataOf(await editor.call('GET', `${TK}/${id}/config-history`), HISTORY);
    // Oldest first; each version ends where the next begins
    expect(history.map((version) => version.config_version)).toEqual([1, 2]);
    expect(history[0]?.valid_to).toBe(history[1]?.valid_from);
    expect(history[1]?.valid_to).toBeNull();
    // The same values again change nothing and set no cookie
    const again = await editor.call('PATCH', `${TK}/${id}`, { intent: 'transactional' });
    expect(again.setCookie).toBeUndefined();
    expect(dataOf(again, TRACKED_KEYWORD).updated_at).toBe(dataOf(answer, TRACKED_KEYWORD).updated_at);
  });

  it('replaces the competitor overrides and answers the effective set by name', async () => {
    const editor = mockBrowser('editor');
    const id = trackedId('seo agency berlin');
    const before = dataOf(await editor.call('GET', `${TK}/${id}`), TRACKED_KEYWORD_DETAIL);
    // By entity name: Meridian Growth, then SEO Weekly
    expect(before.competitor_overrides.map((override) => override.mode)).toEqual(['exclude', 'include']);
    const answer = await editor.call('PUT', `${TK}/${id}/competitors`, {
      include: [],
      exclude: [MOCK_ENTITY_IDS.rankforge],
    });
    const set = dataOf(answer, COMPETITOR_SET);
    expect(set.overrides).toHaveLength(1);
    // Five competitors tracked in SEO, less Rankforge; the watched SEO Weekly is not one
    expect(set.effective_competitors.map((entity) => entity.canonical_name)).toEqual([
      'Brightwave Digital',
      'Clickvantage',
      'Meridian Growth',
      'Northlight SEO',
    ]);
    expect(
      fieldCodes(await editor.call('PUT', `${TK}/${id}/competitors`, { include: [MOCK_ENTITY_IDS.sparkle] })),
    ).toEqual(['include:entity_not_in_project']);
  });
});

describe('tracked keywords: in bulk', () => {
  it('bulk-creates, skipping duplicates and repeats, rejecting bad items, and merging terms on request', async () => {
    const editor = mockBrowser('editor');
    const answer = await editor.call('POST', `${TK}/bulk-create`, {
      on_duplicate: 'merge_terms',
      items: [
        { keyword: 'seo audit', term_ids: [MOCK_TERM_IDS.paidSearch] },
        { keyword: 'seo for lawyers' },
        { keyword: 'SEO for lawyers' },
        { keyword: 'allintitle: seo' },
      ],
    });
    const result = dataOf(answer, BULK_CREATE_RESULT);
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual([
      { index: 0, existing_id: trackedId('seo audit') },
      { index: 2, existing_id: result.created[0] },
    ]);
    expect(result.rejected).toEqual([
      { index: 3, code: 'search_operator_not_allowed', message: expect.any(String) as string },
    ]);
    expect(result.restored).toEqual([]);
    const detail = dataOf(await editor.call('GET', `${TK}/${trackedId('seo audit')}`), TRACKED_KEYWORD_DETAIL);
    expect(detail.terms.map((term) => term.name).sort()).toEqual(['Paid Search', 'Technical SEO']);
  });

  it('marks a deleted keyword that a bulk create brings back as restored', async () => {
    const editor = mockBrowser('editor');
    const id = trackedId('seo audit');
    expect((await editor.call('DELETE', `${TK}/${id}`)).status).toBe(204);
    const result = dataOf(
      await editor.call('POST', `${TK}/bulk-create`, {
        items: [{ keyword: 'seo audit' }, { keyword: 'seo for vets' }],
      }),
      BULK_CREATE_RESULT,
    );
    expect(result.created).toHaveLength(2);
    expect(result.created).toContain(id);
    expect(result.restored).toEqual([id]);
  });

  it('bulk-deletes by ids or filter, matching no row twice, and a later add restores one', async () => {
    const editor = mockBrowser('editor');
    const audit = trackedId('seo audit');
    const DELETED = z.object({ matched: z.number(), deleted: z.number() });
    const first = await editor.call('POST', `${TK}/bulk-delete`, { ids: [audit, trackedId('local seo')] });
    expect(dataOf(first, DELETED)).toEqual({ matched: 2, deleted: 2 });
    // Already deleted: no match
    expect(dataOf(await editor.call('POST', `${TK}/bulk-delete`, { ids: [audit] }), DELETED)).toEqual({
      matched: 0,
      deleted: 0,
    });
    expect(fieldCodes(await editor.call('POST', `${TK}/bulk-delete`, {}))).not.toEqual([]);
    const restored = dataOf(
      await editor.call('POST', `${TK}/bulk-create`, { items: [{ keyword: 'seo audit' }] }),
      BULK_CREATE_RESULT,
    );
    expect(restored.restored).toEqual([audit]);
  });

  it('brings a deleted keyword back without the schedule that was deleted meanwhile', async () => {
    const editor = mockBrowser('editor');
    const id = trackedId('seo audit');
    const scheduleId = MOCK_SCHEDULE_IDS.dailyRanks;
    expect((await editor.call('PATCH', `${TK}/${id}`, { schedule_id: scheduleId })).status).toBe(200);
    expect((await editor.call('DELETE', `${TK}/${id}`)).status).toBe(204);
    // No live keyword names the schedule now, so it may go
    expect((await editor.call('DELETE', `${P}/schedules/${scheduleId}`)).status).toBe(204);
    const result = dataOf(
      await editor.call('POST', `${TK}/bulk-create`, { items: [{ keyword: 'seo audit' }] }),
      BULK_CREATE_RESULT,
    );
    expect(result.restored).toEqual([id]);
    const detail = dataOf(await editor.call('GET', `${TK}/${id}`), TRACKED_KEYWORD_DETAIL);
    expect(detail).toMatchObject({ schedule_id: null, schedule: null });
  });

  it('bulk-updates a filter, versioning depth changes and replacing a single-valued term', async () => {
    const editor = mockBrowser('editor');
    const ids = [trackedId('seo audit'), trackedId('technical seo audit')];
    await editor.call('POST', `${TK}/bulk-update`, { ids, add_term_ids: [SERVICE_TERM('seo-audit')] });
    const answer = await editor.call('POST', `${TK}/bulk-update`, {
      filter: { q: 'seo audit', device: 'desktop', location_id: 2276 },
      set: { depth_profile: 'deep', priority: 2 },
      add_term_ids: [SERVICE_TERM('link-building')],
    });
    const audits = ACTIVE.filter(
      (row) => row.text.includes('seo audit') && row.device === 'desktop' && row.location === 2276,
    );
    expect(dataOf(answer, BULK_UPDATE_RESULT)).toEqual({
      matched: audits.length,
      updated: audits.length,
      config_versions_created: audits.length,
    });
    const detail = dataOf(await editor.call('GET', `${TK}/${ids[0] ?? ''}`), TRACKED_KEYWORD_DETAIL);
    expect(detail.terms.filter((term) => term.vocabulary_kind === 'service').map((term) => term.name)).toEqual([
      'Link Building',
    ]);
    expect(
      fieldCodes(
        await editor.call('POST', `${TK}/bulk-update`, {
          ids,
          add_term_ids: [SERVICE_TERM('seo-audit'), SERVICE_TERM('link-building')],
        }),
      ),
    ).toEqual(['add_term_ids:single_valued_vocabulary']);
    expect(
      fieldCodes(await editor.call('POST', `${TK}/bulk-update`, { remove_group_ids: [mockId('group', 99)], ids })),
    ).toEqual(['remove_group_ids:group_unknown']);
    expect(fieldCodes(await editor.call('POST', `${TK}/bulk-update`, { ids }))).toEqual([':nothing_to_change']);
    expect(
      fieldCodes(
        await editor.call('POST', `${TK}/bulk-update`, {
          ids,
          add_group_ids: [MOCK_GROUP_IDS.brand],
          remove_group_ids: [MOCK_GROUP_IDS.brand],
        }),
      ),
    ).toEqual(['add_group_ids:added_and_removed']);
  });

  it('counts a row whose links were swapped as updated, and clears a vocabulary by removing its terms', async () => {
    const editor = mockBrowser('editor');
    const id = trackedId('seo audit');
    // Same number of groups before and after: still a change
    const swapped = await editor.call('POST', `${TK}/bulk-update`, {
      ids: [id],
      add_group_ids: [MOCK_GROUP_IDS.brand],
      remove_group_ids: [MOCK_GROUP_IDS.audits],
    });
    expect(dataOf(swapped, BULK_UPDATE_RESULT)).toMatchObject({ matched: 1, updated: 1 });
    await editor.call('POST', `${TK}/bulk-update`, { ids: [id], add_term_ids: [SERVICE_TERM('seo-audit')] });
    const cleared = await editor.call('POST', `${TK}/bulk-update`, {
      ids: [id],
      remove_term_ids: [SERVICE_TERM('seo-audit'), SERVICE_TERM('link-building')],
    });
    expect(dataOf(cleared, BULK_UPDATE_RESULT)).toMatchObject({ updated: 1 });
    const detail = dataOf(await editor.call('GET', `${TK}/${id}`), TRACKED_KEYWORD_DETAIL);
    expect(detail.terms.map((term) => term.vocabulary_kind)).toEqual(['topic']);
  });

  it('archives and unarchives a selection of exactly one of ids and filter', async () => {
    const editor = mockBrowser('editor');
    const brand = { filter: { group: MOCK_GROUP_IDS.brand } };
    const archived = await editor.call('POST', `${TK}/bulk-archive`, { ...brand, archive: true });
    expect(dataOf(archived, BULK_ARCHIVE_RESULT)).toEqual({ matched: 4, updated: 4 });
    expect(await listOf(editor, `filter[group]=${MOCK_GROUP_IDS.brand}`)).toHaveLength(0);
    // A body filter without `is_active` takes archived and active rows alike, unlike the list
    const again = await editor.call('POST', `${TK}/bulk-archive`, { ...brand, archive: true });
    expect(dataOf(again, BULK_ARCHIVE_RESULT)).toEqual({ matched: 4, updated: 0 });
    const archivedBrand = { filter: { group: MOCK_GROUP_IDS.brand, is_active: false } };
    const back = await editor.call('POST', `${TK}/bulk-archive`, { ...archivedBrand, archive: false });
    expect(dataOf(back, BULK_ARCHIVE_RESULT)).toEqual({ matched: 4, updated: 4 });
    const all = await editor.call('POST', `${TK}/bulk-archive`, { filter: {}, archive: false });
    expect(dataOf(all, BULK_ARCHIVE_RESULT)).toEqual({ matched: KEYWORD_TABLE.length, updated: 3 });
    // A list in a body filter holds 1 to 100 values
    expect(
      fieldCodes(await editor.call('POST', `${TK}/bulk-archive`, { filter: { intent_in: [] }, archive: true })),
    ).toEqual(['filter.intent_in:too_short']);
    expect(
      fieldCodes(
        await editor.call('POST', `${TK}/bulk-archive`, { ...brand, ids: [trackedId('fynix')], archive: true }),
      ),
    ).toEqual([':value_error']);
  });
});

describe('tracked keywords: rank filters, sorts and includes', () => {
  /** A day on which the fixtures hold ranked, beyond-depth, new and numeric changes. */
  const NOW = Date.parse('2026-10-07T12:00:00Z');
  const HOST = fynix.host;

  // The handlers read the mock clock; pin it (the date alone, so that timers still run)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  interface Truth {
    id: string;
    text: string;
    active: boolean;
    state: TrackedKeywordState;
  }
  /** What the fixtures' rank state is at the pinned time, from the same function the handlers use. */
  const fixtures = (): Truth[] =>
    MOCK_TRACKED_KEYWORDS.map((row, index) => ({
      id: row.tracked_keyword_id,
      text: KEYWORD_TABLE[index]?.text ?? '',
      active: row.is_active,
      state: rankStateOf(row.tracked_keyword_id, row.created_at, NOW, HOST),
    }));
  const live = (): Truth[] => fixtures().filter((entry) => entry.active);
  const ids = (entries: readonly { id: string }[]): string[] => entries.map((entry) => entry.id).sort();
  const idsOfList = async (browser: MockBrowser, query: string): Promise<string[]> =>
    (await listOf(browser, query)).map((row) => row.tracked_keyword_id).sort();
  const rank = (entry: Truth): number | null => entry.state.current.rank;
  const neverChecked = (entry: Truth): boolean => entry.state.last_observed_at === null;

  it('keeps the ranked keywords in range with filter[rank_lte] and filter[rank_gte], never a keyword not checked', async () => {
    const viewer = mockBrowser('viewer');
    const top = live().filter((entry) => (rank(entry) ?? 1000) <= 3);
    const middle = live().filter((entry) => (rank(entry) ?? 0) >= 4 && (rank(entry) ?? 1000) <= 10);
    const deep = live().filter((entry) => (rank(entry) ?? 0) >= 4);
    expect(top.length).toBeGreaterThan(0);
    expect(middle.length).toBeGreaterThan(0);
    expect(await idsOfList(viewer, 'filter[rank_lte]=3')).toEqual(ids(top));
    expect(await idsOfList(viewer, 'filter[rank_gte]=4&filter[rank_lte]=10')).toEqual(ids(middle));
    expect(await idsOfList(viewer, 'filter[rank_gte]=4')).toEqual(ids(deep));
    // A keyword beyond the depth, one not checked yet and one whose check failed match neither bound
    const rows = await listOf(viewer, 'filter[rank_gte]=1');
    expect(rows.every((row) => row.state.current.state === 'ranked')).toBe(true);
    expect(rows.some((row) => PENDING_TRACKED_IDS.has(row.tracked_keyword_id))).toBe(false);
    expect(await idsOfList(viewer, 'filter[rank_lte]=700')).toEqual(
      ids(live().filter((entry) => rank(entry) !== null)),
    );
  });

  it('filters by being beyond the depth: filter[rank_is_null]=true is checked and not ranked, false is ranked', async () => {
    const viewer = mockBrowser('viewer');
    const beyond = live().filter((entry) => entry.state.current.state === 'beyond_depth');
    const ranked = live().filter((entry) => entry.state.current.state === 'ranked');
    expect(beyond.length).toBeGreaterThan(0);
    expect(await idsOfList(viewer, 'filter[rank_is_null]=true')).toEqual(ids(beyond));
    expect(await idsOfList(viewer, 'filter[rank_is_null]=false')).toEqual(ids(ranked));
    // A keyword never checked is neither beyond the depth nor ranked
    const both = new Set([
      ...(await idsOfList(viewer, 'filter[rank_is_null]=true')),
      ...(await idsOfList(viewer, 'filter[rank_is_null]=false')),
    ]);
    for (const entry of live().filter(neverChecked)) expect(both.has(entry.id)).toBe(false);
    expect(live().filter(neverChecked).length).toBe(PENDING_TRACKED_IDS.size + FAILED_IDS.size);
  });

  it('filters by the change: labels, improved and declined, where false means everything else', async () => {
    const viewer = mockBrowser('viewer');
    const value = (entry: Truth): number => entry.state.change.value ?? 0;
    const labelled = (...labels: string[]): Truth[] =>
      live().filter((entry) => labels.includes(entry.state.change.label));
    expect(labelled('new', 'lost').length).toBeGreaterThan(0);
    expect(await idsOfList(viewer, 'filter[rank_change_label_in]=new,lost')).toEqual(ids(labelled('new', 'lost')));
    expect(await idsOfList(viewer, 'filter[rank_change_label_in]=numeric&filter[rank_change_label_in]=lost')).toEqual(
      ids(labelled('numeric', 'lost')),
    );
    // A keyword not checked yet has the label first_check
    const first = await idsOfList(viewer, 'filter[rank_change_label_in]=first_check');
    expect(first).toEqual(ids(labelled('first_check')));
    for (const entry of live().filter(neverChecked)) expect(first).toContain(entry.id);
    expect(await idsOfList(viewer, 'filter[improved]=true')).toEqual(ids(live().filter((entry) => value(entry) > 0)));
    expect(await idsOfList(viewer, 'filter[declined]=true')).toEqual(ids(live().filter((entry) => value(entry) < 0)));
    // False is "not improved": no change, a worse one, no number at all, and a keyword not checked
    const notImproved = await idsOfList(viewer, 'filter[improved]=false');
    expect(notImproved).toEqual(ids(live().filter((entry) => value(entry) <= 0)));
    for (const entry of live().filter(neverChecked)) expect(notImproved).toContain(entry.id);
    const notDeclined = await idsOfList(viewer, 'filter[declined]=false');
    expect(notDeclined).toEqual(ids(live().filter((entry) => value(entry) >= 0)));
    for (const entry of live().filter(neverChecked)) expect(notDeclined).toContain(entry.id);
    // A move of zero places is neither improved nor declined
    const flat = live().filter((entry) => entry.state.change.label === 'numeric' && value(entry) === 0);
    for (const entry of flat) {
      expect(notImproved).toContain(entry.id);
      expect(notDeclined).toContain(entry.id);
    }
    expect(await idsOfList(viewer, 'filter[improved]=true&filter[declined]=true')).toEqual([]);
  });

  it('filters by stale: false takes keywords that were never checked as well', async () => {
    const viewer = mockBrowser('viewer');
    const stale = await idsOfList(viewer, 'filter[is_stale]=true');
    expect(stale).toEqual(ids(live().filter((entry) => entry.state.is_stale)));
    expect(stale.length).toBeGreaterThan(0);
    const fresh = await idsOfList(viewer, 'filter[is_stale]=false');
    expect(fresh).toEqual(ids(live().filter((entry) => !entry.state.is_stale)));
    for (const entry of live().filter(neverChecked)) {
      expect(fresh).toContain(entry.id);
      expect(stale).not.toContain(entry.id);
    }
  });

  it('filters by feature, owned feature, AI Overview, ranking URL and target URL match', async () => {
    const viewer = mockBrowser('viewer');
    const present = live().flatMap((entry) => entry.state.feature_types_present)[0];
    const owned = live().flatMap((entry) => entry.state.owned_feature_types)[0];
    if (present === undefined || owned === undefined) throw new Error('No fixture keyword has a feature');
    expect(await idsOfList(viewer, `filter[feature_present]=${present}`)).toEqual(
      ids(live().filter((entry) => entry.state.feature_types_present.includes(present))),
    );
    expect(await idsOfList(viewer, `filter[feature_owned]=${owned}`)).toEqual(
      ids(live().filter((entry) => entry.state.owned_feature_types.includes(owned))),
    );
    expect(await idsOfList(viewer, 'filter[feature_present]=no_such_feature')).toEqual([]);
    const aio = await idsOfList(viewer, 'filter[aio_state]=present_cited,absent');
    expect(aio).toEqual(ids(live().filter((entry) => ['present_cited', 'absent'].includes(entry.state.aio.state))));
    // A keyword never checked shows `unknown`
    const unknown = await idsOfList(viewer, 'filter[aio_state]=unknown');
    for (const entry of live().filter(neverChecked)) expect(unknown).toContain(entry.id);
    expect(unknown).toEqual(ids(live().filter((entry) => entry.state.aio.state === 'unknown')));
    const urlId = live().find((entry) => entry.state.current.url !== null)?.state.current.url?.url_id;
    if (urlId === undefined) throw new Error('No fixture keyword ranks');
    expect(await idsOfList(viewer, `filter[ranking_url_id]=${urlId}`)).toEqual(
      ids(live().filter((entry) => entry.state.current.url?.url_id === urlId)),
    );
    // Nothing has a target URL yet, so the match is unknown for every keyword and neither value takes one
    expect(await idsOfList(viewer, 'filter[target_url_match]=true')).toEqual([]);
    expect(await idsOfList(viewer, 'filter[target_url_match]=false')).toEqual([]);
  });

  it('matches a target URL to the ranking URL once a keyword has one', async () => {
    const editor = mockBrowser('editor');
    const [first, second] = live().filter((entry) => entry.state.current.url !== null);
    const same = first?.state.current.url;
    if (first === undefined || second === undefined || same === undefined || same === null) {
      throw new Error('Fewer than two fixture keywords rank');
    }
    await editor.call('PATCH', `${TK}/${first.id}`, { target_url: same.canonical_url });
    await editor.call('PATCH', `${TK}/${second.id}`, { target_url: `https://${HOST}/not-the-ranking-page` });
    expect(await idsOfList(editor, 'filter[target_url_match]=true')).toEqual([first.id]);
    expect(await idsOfList(editor, 'filter[target_url_match]=false')).toEqual([second.id]);
    const detail = dataOf(await editor.call('GET', `${TK}/${first.id}`), TRACKED_KEYWORD_DETAIL);
    expect(detail.state.target_url_match).toBe(true);
  });

  it('refuses out of range values with 422 as the contract declares', async () => {
    const viewer = mockBrowser('viewer');
    const codes = async (query: string): Promise<string[]> => fieldCodes(await viewer.call('GET', `${TK}?${query}`));
    expect(await codes('filter[rank_lte]=0')).toEqual(['filter[rank_lte]:greater_than_equal']);
    expect(await codes('filter[rank_lte]=701')).toEqual(['filter[rank_lte]:less_than_equal']);
    expect(await codes('filter[rank_gte]=0')).toEqual(['filter[rank_gte]:greater_than_equal']);
    expect(await codes('filter[rank_gte]=701')).toEqual(['filter[rank_gte]:less_than_equal']);
    expect(await codes('filter[rank_gte]=ten')).toEqual(['filter[rank_gte]:int_parsing']);
    expect((await viewer.call('GET', `${TK}?filter[rank_lte]=700&filter[rank_gte]=1`)).status).toBe(200);
    expect(await codes('filter[ranking_url_id]=0')).toEqual(['filter[ranking_url_id]:greater_than_equal']);
    expect(await codes('filter[feature_present]=')).toEqual(['filter[feature_present]:string_too_short']);
    expect(await codes(`filter[feature_owned]=${'x'.repeat(101)}`)).toEqual(['filter[feature_owned]:string_too_long']);
    expect((await viewer.call('GET', `${TK}?filter[feature_present]=${'x'.repeat(100)}`)).status).toBe(200);
    expect(await codes('filter[aio_state]=cited')).toEqual(['filter[aio_state]:enum']);
    expect(await codes('filter[rank_change_label_in]=new,sideways')).toEqual(['filter[rank_change_label_in]:enum']);
    expect(await codes('filter[improved]=maybe')).toEqual(['filter[improved]:bool_parsing']);
    expect(await codes('filter[is_stale]=1')).toEqual(['filter[is_stale]:bool_parsing']);
    // `not_loaded` is a state of the AI Overview too
    expect((await viewer.call('GET', `${TK}?filter[aio_state]=not_loaded`)).status).toBe(200);
  });

  /** The expected order of `entries` for `keys`: a missing value last whichever way, the row id ending ties. */
  const ordered = (
    entries: readonly Truth[],
    keys: readonly { value: (entry: Truth) => number | string | null; desc: boolean }[],
  ): string[] =>
    [...entries]
      .sort((a, b) => {
        for (const { value, desc } of keys) {
          const left = value(a);
          const right = value(b);
          if (left === right) continue;
          if (left === null || right === null) return left === null ? 1 : -1;
          const order = left < right ? -1 : 1;
          return desc ? -order : order;
        }
        return a.id.localeCompare(b.id);
      })
      .map((entry) => entry.id);
  const orderOfList = async (browser: MockBrowser, sort: string): Promise<string[]> =>
    (await listOf(browser, `sort=${sort}`)).map((row) => row.tracked_keyword_id);
  const time = (entry: Truth): number | null =>
    entry.state.last_observed_at === null ? null : Date.parse(entry.state.last_observed_at);

  it('sorts by current rank with a keyword beyond the depth or not checked last in both directions', async () => {
    const viewer = mockBrowser('viewer');
    expect(await orderOfList(viewer, 'current_rank')).toEqual(ordered(live(), [{ value: rank, desc: false }]));
    expect(await orderOfList(viewer, '-current_rank')).toEqual(ordered(live(), [{ value: rank, desc: true }]));
    const rows = await listOf(viewer, 'sort=-current_rank');
    const firstWithout = rows.findIndex((row) => row.state.current.rank === null);
    expect(firstWithout).toBeGreaterThan(0);
    expect(rows.slice(firstWithout).every((row) => row.state.current.rank === null)).toBe(true);
    // The keywords beyond the depth, not checked and failed all sort last, apart from each other by row id
    expect(rows.slice(firstWithout).map((row) => row.tracked_keyword_id)).toEqual(
      [...rows.slice(firstWithout).map((row) => row.tracked_keyword_id)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('sorts by the change, the best rank and the last check, with ties broken by the next key and then the row id', async () => {
    const viewer = mockBrowser('viewer');
    const change = (entry: Truth): number | null => entry.state.change.value;
    const best = (entry: Truth): number | null => entry.state.best_rank;
    // A change that is `new`, `lost`, beyond or a first check has no number and sorts last both ways
    expect(await orderOfList(viewer, 'rank_change')).toEqual(ordered(live(), [{ value: change, desc: false }]));
    expect(await orderOfList(viewer, '-rank_change')).toEqual(ordered(live(), [{ value: change, desc: true }]));
    const bigGain = await listOf(viewer, 'sort=-rank_change');
    const lastNumeric = bigGain.map((row) => row.state.change.value).findLastIndex((value) => value !== null);
    expect(bigGain.slice(lastNumeric + 1).every((row) => row.state.change.value === null)).toBe(true);
    expect(await orderOfList(viewer, 'best_rank')).toEqual(ordered(live(), [{ value: best, desc: false }]));
    expect(await orderOfList(viewer, '-best_rank')).toEqual(ordered(live(), [{ value: best, desc: true }]));
    expect(await orderOfList(viewer, '-last_observed_at')).toEqual(ordered(live(), [{ value: time, desc: true }]));
    expect(await orderOfList(viewer, 'last_observed_at')).toEqual(ordered(live(), [{ value: time, desc: false }]));
    // Ties on the first key fall to the second
    expect(await orderOfList(viewer, 'rank_change,-current_rank')).toEqual(
      ordered(live(), [
        { value: change, desc: false },
        { value: rank, desc: true },
      ]),
    );
    expect(await orderOfList(viewer, 'current_rank,keyword')).toEqual(
      ordered(live(), [
        { value: rank, desc: false },
        { value: (entry: Truth) => entry.text, desc: false },
      ]),
    );
  });

  it('reads the clock once for a request: the sort and the rows show the same moment', async () => {
    const viewer = mockBrowser('viewer');
    const rows = await listOf(viewer, 'sort=-last_observed_at');
    const times = rows.map((row) => row.state.last_observed_at);
    expect(times.every((value) => value === null || Date.parse(value) <= NOW)).toBe(true);
    // The pinned clock is the one the rows were made at
    expect(rows.map((row) => row.state)).toEqual(
      rows.map((row) => live().find((entry) => entry.id === row.tracked_keyword_id)?.state),
    );
  });

  it('still refuses a sort that is not one of the fields, or that names a field twice', async () => {
    const viewer = mockBrowser('viewer');
    expect(fieldCodes(await viewer.call('GET', `${TK}?sort=rank`))).toEqual(['sort:invalid_sort']);
    expect(fieldCodes(await viewer.call('GET', `${TK}?sort=current_rank,-current_rank`))).toEqual([
      'sort:invalid_sort',
    ]);
    expect(fieldCodes(await viewer.call('GET', `${TK}?sort=-state`))).toEqual(['sort:invalid_sort']);
  });

  it('accepts include=sparkline,competitor_ranks,features,aio and answers null for each block', async () => {
    const viewer = mockBrowser('viewer');
    for (const query of [
      'include=sparkline,competitor_ranks,features,aio',
      'include=sparkline&include=aio&include=metrics',
    ]) {
      const rows = await listOf(viewer, query);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.sparkline).toBeNull();
        expect(row.competitor_ranks).toBeNull();
        expect(row.features).toBeNull();
        expect(row.aio).toBeNull();
      }
    }
    expect(fieldCodes(await viewer.call('GET', `${TK}?include=sparkline,ranks`))).toEqual(['include:enum']);
  });

  it('gives a keyword added in the browser its first check three minutes later, by the mock clock', async () => {
    const editor = mockBrowser('editor');
    const added = dataOf(await editor.call('POST', TK, { keyword: 'seo for dentists' }), CREATED)[0];
    if (added === undefined) throw new Error('Nothing was created');
    const stateNow = async (): Promise<z.infer<typeof TRACKED_KEYWORD_ROW>['state'] | undefined> =>
      (await listOf(editor, 'filter[q]=seo for dentists'))[0]?.state;
    const created = Date.parse(added.created_at);
    expect((await stateNow())?.current.state).toBe('not_checked');
    expect(await idsOfList(editor, 'filter[rank_change_label_in]=first_check&filter[q]=seo for dentists')).toEqual([
      added.tracked_keyword_id,
    ]);
    vi.setSystemTime(created + 3 * 60_000 - 1000);
    expect((await stateNow())?.current.state).toBe('not_checked');
    vi.setSystemTime(created + 3 * 60_000);
    const checked = await stateNow();
    expect(['ranked', 'beyond_depth']).toContain(checked?.current.state);
    expect(checked?.last_observed_at).toBe(new Date(created + 3 * 60_000).toISOString());
    // The detail agrees with the list
    const detail = dataOf(await editor.call('GET', `${TK}/${added.tracked_keyword_id}`), TRACKED_KEYWORD_DETAIL);
    expect(detail.state).toEqual(checked);
    // The fixture keywords that wait for Labs wait for their first check too
    vi.setSystemTime(created + 9 * 60_000);
    const waiting = await listOf(editor, 'filter[rank_change_label_in]=first_check');
    for (const id of PENDING_TRACKED_IDS) {
      expect(waiting.find((row) => row.tracked_keyword_id === id)?.state.current.state).toBe('not_checked');
    }
  });

  it('takes the same rank members in the filter of a bulk change', async () => {
    const editor = mockBrowser('editor');
    // A body filter without `is_active` takes archived and active keywords alike
    const everyone = fixtures();
    const matched = async (filter: Record<string, unknown>): Promise<number> =>
      dataOf(await editor.call('POST', `${TK}/bulk-archive`, { filter, archive: false }), BULK_ARCHIVE_RESULT).matched;
    expect(await matched({ rank_lte: 3 })).toBe(everyone.filter((entry) => (rank(entry) ?? 1000) <= 3).length);
    expect(await matched({ rank_gte: 4, rank_lte: 10 })).toBe(
      everyone.filter((entry) => (rank(entry) ?? 0) >= 4 && (rank(entry) ?? 1000) <= 10).length,
    );
    expect(await matched({ rank_is_null: true })).toBe(
      everyone.filter((entry) => entry.state.current.state === 'beyond_depth').length,
    );
    expect(await matched({ rank_is_null: false })).toBe(
      everyone.filter((entry) => entry.state.current.state === 'ranked').length,
    );
    expect(await matched({ rank_change_label_in: ['new', 'lost'] })).toBe(
      everyone.filter((entry) => ['new', 'lost'].includes(entry.state.change.label)).length,
    );
    expect(await matched({ improved: true })).toBe(
      everyone.filter((entry) => (entry.state.change.value ?? 0) > 0).length,
    );
    expect(await matched({ declined: true })).toBe(
      everyone.filter((entry) => (entry.state.change.value ?? 0) < 0).length,
    );
    expect(await matched({ improved: false })).toBe(
      everyone.filter((entry) => (entry.state.change.value ?? 0) <= 0).length,
    );
    expect(await matched({ is_stale: true })).toBe(everyone.filter((entry) => entry.state.is_stale).length);
    expect(await matched({ is_stale: false })).toBe(everyone.filter((entry) => !entry.state.is_stale).length);
    expect(await matched({ aio_state: ['present_cited'] })).toBe(
      everyone.filter((entry) => entry.state.aio.state === 'present_cited').length,
    );
    expect(await matched({ feature_present: 'featured_snippet' })).toBe(
      everyone.filter((entry) => entry.state.feature_types_present.includes('featured_snippet')).length,
    );
    expect(await matched({ target_url_match: true })).toBe(0);
    // The body's own limits
    const refused = async (filter: Record<string, unknown>): Promise<string[]> =>
      fieldCodes(await editor.call('POST', `${TK}/bulk-archive`, { filter, archive: false }));
    expect(await refused({ rank_lte: 0 })).toEqual(['filter.rank_lte:greater_than_equal']);
    expect(await refused({ rank_gte: 701 })).toEqual(['filter.rank_gte:less_than_equal']);
    expect(await refused({ rank_change_label_in: [] })).toEqual(['filter.rank_change_label_in:too_short']);
    expect(await refused({ rank_change_label_in: ['sideways'] })).toEqual(['filter.rank_change_label_in:enum']);
    expect(await refused({ aio_state: ['cited'] })).toEqual(['filter.aio_state:enum']);
    expect(await refused({ improved: 'maybe' })).toEqual(['filter.improved:bool_parsing']);
    expect(await refused({ feature_owned: '' })).toEqual(['filter.feature_owned:string_too_short']);
    expect(await refused({ ranking_url_id: 0 })).toEqual(['filter.ranking_url_id:greater_than_equal']);
  });
});
