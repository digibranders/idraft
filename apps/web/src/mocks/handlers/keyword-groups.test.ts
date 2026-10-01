import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_TERMS, MOCK_TERM_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { MOCK_GROUP_IDS } from '../keyword-fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import {
  KEYWORD,
  KEYWORD_DETAIL,
  KEYWORD_GROUP,
  KEYWORD_GROUP_NODE,
  KEYWORD_METRICS_HISTORY,
  PROJECT_SETTINGS,
  TERM_ASSIGNMENT_RESULT,
  TRACKED_KEYWORD,
  TRACKED_KEYWORD_DETAIL,
} from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;
const G = `${P}/keyword-groups`;
const TREE = z.array(KEYWORD_GROUP_NODE);
const KEYWORDS = z.array(KEYWORD);
const PAGE = z.object({ limit: z.number(), next_cursor: z.string().nullable(), has_more: z.boolean() });

const ACTIVE = KEYWORD_TABLE.filter((row) => row.archived !== true);
const countOf = (...groups: string[]): number => ACTIVE.filter((row) => groups.includes(row.group ?? '')).length;
const trackedId = (text: string): string => {
  const index = KEYWORD_TABLE.findIndex(
    (row) => row.text === text && row.location === 2276 && row.device === 'desktop',
  );
  if (index < 0) throw new Error(`No fixture row for ${text}`);
  return mockId('tracked', index + 1);
};
const serviceTerm = (slug: string): string => {
  const term = MOCK_TERMS.find((candidate) => candidate.slug === slug);
  if (term === undefined) throw new Error(`No term ${slug}`);
  return term.term_id;
};

/** The id of the workspace keyword with this normalized text. */
async function keywordIdOf(browser: MockBrowser, normalized: string): Promise<string> {
  const found = dataOf(await browser.call('GET', `${W}/keywords?filter[q]=${normalized}&limit=50`), KEYWORDS).find(
    (keyword) => keyword.normalized_text === normalized,
  );
  if (found === undefined) throw new Error(`No keyword ${normalized}`);
  return found.keyword_id;
}

describe('keyword groups', () => {
  it('answers the tree with "/" paths and counts that take in the subgroups', async () => {
    const tree = dataOf(await mockBrowser('viewer').call('GET', G), TREE);
    expect(tree.map((node) => node.name)).toEqual(['Brand', 'Local', 'Services']);
    const services = tree.find((node) => node.group_id === MOCK_GROUP_IDS.services);
    expect(services?.keyword_count).toBe(countOf('audits', 'content'));
    expect(services?.children.map((child) => [child.path, child.keyword_count])).toEqual([
      ['Services/Content', countOf('content')],
      ['Services/SEO audits', countOf('audits')],
    ]);
    const flat = dataOf(await mockBrowser('viewer').call('GET', `${G}?format=flat`), TREE);
    expect(flat.map((group) => group.path)).toEqual([
      'Brand',
      'Local',
      'Services',
      'Services/Content',
      'Services/SEO audits',
    ]);
  });

  it('creates under a parent of the project, refusing a sibling name in any case and an unknown parent', async () => {
    const editor = mockBrowser('editor');
    const created = await editor.call('POST', G, { name: '  Pricing ', parent_id: MOCK_GROUP_IDS.services });
    expect(created.status).toBe(201);
    expect(dataOf(created, KEYWORD_GROUP)).toMatchObject({
      name: 'Pricing',
      path: 'Services/Pricing',
      keyword_count: 0,
    });
    expect(await editor.call('POST', G, { name: 'seo AUDITS', parent_id: MOCK_GROUP_IDS.services })).toMatchObject({
      status: 409,
      code: 'duplicate',
    });
    expect(fieldCodes(await editor.call('POST', G, { name: 'Other', parent_id: mockId('group', 99) }))).toEqual([
      'parent_id:group_unknown',
    ]);
    expect(fieldCodes(await editor.call('POST', G, { name: 'x'.repeat(101) }))).toEqual(['name:string_too_long']);
    // The name is trimmed before it is measured
    expect(fieldCodes(await editor.call('POST', G, { name: '   ' }))).toEqual(['name:string_too_short']);
    expect((await editor.call('POST', G, { name: ` ${'y'.repeat(100)} ` })).status).toBe(201);
  });

  it('moves a group but never under itself or a group below it', async () => {
    const editor = mockBrowser('editor');
    const moved = await editor.call('PATCH', `${G}/${MOCK_GROUP_IDS.local}`, { parent_id: MOCK_GROUP_IDS.services });
    expect(dataOf(moved, KEYWORD_GROUP).path).toBe('Services/Local');
    expect(
      await editor.call('PATCH', `${G}/${MOCK_GROUP_IDS.services}`, { parent_id: MOCK_GROUP_IDS.audits }),
    ).toMatchObject({ status: 422, code: 'cycle_detected' });
  });

  it('deletes a group with its subgroups and takes their keywords out, keeping the keywords', async () => {
    const editor = mockBrowser('editor');
    expect((await editor.call('DELETE', `${G}/${MOCK_GROUP_IDS.services}`)).status).toBe(204);
    const tree = dataOf(await editor.call('GET', G), TREE);
    expect(tree.map((node) => node.name)).toEqual(['Brand', 'Local']);
    const detail = await editor.call('GET', `${P}/tracked-keywords/${trackedId('seo audit')}`);
    expect(dataOf(detail, TRACKED_KEYWORD_DETAIL).groups).toEqual([]);
  });

  it('adds and removes members, counting only the keywords that changed', async () => {
    const editor = mockBrowser('editor');
    const ids = [trackedId('seo audit'), trackedId('ppc agency')];
    const added = await editor.call('POST', `${G}/${MOCK_GROUP_IDS.audits}/members`, { tracked_keyword_ids: ids });
    expect(added.body.data).toEqual({ added: 1 });
    const removed = await editor.call('POST', `${G}/${MOCK_GROUP_IDS.audits}/members/remove`, {
      tracked_keyword_ids: ids,
    });
    expect(removed.body.data).toEqual({ removed: 2 });
    expect(
      fieldCodes(await editor.call('POST', `${G}/${MOCK_GROUP_IDS.audits}/members`, { tracked_keyword_ids: [] })),
    ).toEqual(['tracked_keyword_ids:too_short']);
  });
});

describe('term assignments', () => {
  it('replaces terms only in the vocabularies of the terms given', async () => {
    const editor = mockBrowser('editor');
    const id = trackedId('seo audit');
    await editor.call('POST', `${P}/term-assignments`, {
      subject_type: 'tracked_keyword',
      subject_ids: [id],
      term_ids: [serviceTerm('seo-audit')],
      op: 'add',
    });
    const answer = await editor.call('POST', `${P}/term-assignments`, {
      subject_type: 'tracked_keyword',
      subject_ids: [id],
      term_ids: [MOCK_TERM_IDS.paidSearch],
      op: 'replace',
    });
    expect(dataOf(answer, TERM_ASSIGNMENT_RESULT)).toEqual({
      assignments_added: 1,
      assignments_removed: 1,
      subjects_matched: 1,
    });
    const detail = dataOf(await editor.call('GET', `${P}/tracked-keywords/${id}`), TRACKED_KEYWORD_DETAIL);
    // Technical SEO gave way to Paid Search; the Services term stayed
    expect(detail.terms.map((term) => term.name).sort()).toEqual(['Paid Search', 'SEO Audit']);
  });

  it('refuses to add a second term of a single-valued vocabulary, and removes several at once', async () => {
    const editor = mockBrowser('editor');
    const assign = (op: string, termIds: string[]): Promise<Awaited<ReturnType<MockBrowser['call']>>> =>
      editor.call('POST', `${P}/term-assignments`, {
        subject_type: 'tracked_keyword',
        subject_ids: [trackedId('seo audit')],
        term_ids: termIds,
        op,
      });
    expect((await assign('add', [serviceTerm('seo-audit')])).status).toBe(200);
    expect(fieldCodes(await assign('add', [serviceTerm('link-building')]))).toEqual([
      'term_ids:single_valued_vocabulary',
    ]);
    const removed = await assign('remove', [serviceTerm('seo-audit'), serviceTerm('link-building')]);
    expect(dataOf(removed, TERM_ASSIGNMENT_RESULT)).toMatchObject({ assignments_removed: 1 });
  });

  it('selects by filter and refuses prompts until the AI step', async () => {
    const editor = mockBrowser('editor');
    const answer = await editor.call('POST', `${P}/term-assignments`, {
      subject_type: 'tracked_keyword',
      subject_filter: { group: MOCK_GROUP_IDS.brand },
      term_ids: [MOCK_TERM_IDS.seo],
      op: 'add',
    });
    expect(dataOf(answer, TERM_ASSIGNMENT_RESULT)).toMatchObject({ assignments_added: 4, subjects_matched: 4 });
    expect(
      fieldCodes(
        await editor.call('POST', `${P}/term-assignments`, {
          subject_type: 'prompt',
          subject_ids: [trackedId('seo audit')],
          term_ids: [MOCK_TERM_IDS.seo],
          op: 'add',
        }),
      ),
    ).toEqual(['subject_type:subject_type_not_supported']);
  });
});

describe('project keyword settings', () => {
  it('answers the defaults, and a change by an admin becomes the default of new keywords', async () => {
    const admin = mockBrowser('admin');
    expect(dataOf(await admin.call('GET', `${P}/settings`), PROJECT_SETTINGS).seo).toEqual({
      default_device: 'desktop',
      default_depth_profile: 'standard',
      default_frequency: 'daily',
      visibility_weight_scheme: 'uniform',
      visibility_volume_mode: 'annual_average',
    });
    expect(await admin.as('viewer').call('PATCH', `${P}/settings`, { seo: { default_device: 'both' } })).toMatchObject({
      status: 403,
    });
    const patched = await admin.call('PATCH', `${P}/settings`, {
      seo: { default_device: 'both', default_depth_profile: 'deep' },
    });
    expect(dataOf(patched, PROJECT_SETTINGS).seo).toMatchObject({ default_device: 'both', default_frequency: 'daily' });
    const created = await admin.call('POST', `${P}/tracked-keywords`, { keyword: 'seo for startups' });
    expect(dataOf(created, z.array(TRACKED_KEYWORD)).map((row) => [row.device, row.depth_profile])).toEqual([
      ['desktop', 'deep'],
      ['mobile', 'deep'],
    ]);
    expect(fieldCodes(await admin.call('PATCH', `${P}/settings`, { seo: { default_frequency: null } }))).toEqual([
      'seo.default_frequency:null_not_allowed',
    ]);
  });
});

describe('workspace keywords', () => {
  it('lists by normalized text in cursor pages without a total, filtered by text and language', async () => {
    const viewer = mockBrowser('viewer');
    const first = await viewer.call('GET', `${W}/keywords?limit=3`);
    expect(dataOf(first, KEYWORDS).map((keyword) => keyword.text)).toEqual([
      'ai overviews seo',
      'backlink checker',
      'blog content strategy',
    ]);
    expect(pageOf(first, PAGE)).toMatchObject({ limit: 3, has_more: true });
    expect(first.body.page).not.toHaveProperty('total');
    const german = dataOf(await viewer.call('GET', `${W}/keywords?filter[language_code]=de`), KEYWORDS);
    expect(german.map((keyword) => keyword.text)).toEqual(['seo agentur', 'seo agentur berlin']);
    // "seo audit" is one keyword, tracked at two locations
    const audit = dataOf(await viewer.call('GET', `${W}/keywords?filter[q]=SEO  Audit&limit=50`), KEYWORDS);
    expect(audit.map((keyword) => keyword.normalized_text)).toEqual([
      'free seo audit',
      'seo audit',
      'seo audit checklist',
      'seo audit tool',
      'technical seo audit',
      'website seo audit',
    ]);
  });

  it('gives a keyword its metrics at each location and the variants that track it', async () => {
    const viewer = mockBrowser('viewer');
    const auditId = await keywordIdOf(viewer, 'seo audit');
    const detail = dataOf(await viewer.call('GET', `${W}/keywords/${auditId}`), KEYWORD_DETAIL);
    expect(detail.metrics.map((metrics) => [metrics.location_id, metrics.search_volume.value])).toEqual([
      [2276, 6600],
      [2840, 14800],
    ]);
    expect(detail.tracked.map((variant) => [variant.location_id, variant.device])).toEqual([
      [2276, 'desktop'],
      [2840, 'mobile'],
    ]);
  });

  it('shows a member limited to some projects only the keywords those projects track', async () => {
    const editor = mockBrowser('editor');
    const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
    if (eventus === undefined) throw new Error('The Eventus project fixture is missing');
    await editor.call('POST', `${W}/projects/${eventus.project_id}/tracked-keywords`, {
      keyword: 'soc as a service',
      language_code: 'en',
    });
    const socId = await keywordIdOf(editor, 'soc as a service');
    const analyst = editor.as('analyst');
    const seen = dataOf(await analyst.call('GET', `${W}/keywords?filter[q]=soc&limit=50`), KEYWORDS);
    expect(seen.map((keyword) => keyword.text)).toEqual([]);
    expect(await analyst.call('GET', `${W}/keywords/${socId}`)).toMatchObject({ status: 404 });
    expect(
      await analyst.call('GET', `${W}/keywords/${socId}/metrics-history?location_id=2356&language_code=en`),
    ).toMatchObject({ status: 404 });
    expect((await editor.call('GET', `${W}/keywords/${socId}`)).status).toBe(200);
  });

  it('answers the metrics history of one location and language: a year of months, trend as a ratio', async () => {
    const viewer = mockBrowser('viewer');
    const path = `${W}/keywords/${await keywordIdOf(viewer, 'seo audit')}/metrics-history`;
    const history = dataOf(
      await viewer.call('GET', `${path}?location_id=2276&language_code=en`),
      KEYWORD_METRICS_HISTORY,
    );
    expect(history.snapshots).toHaveLength(1);
    expect(history.snapshots[0]?.monthly_searches).toHaveLength(12);
    expect(history.trend).toMatchObject({ metric: 'seo.search_volume_trend', unit: 'ratio' });
    expect(history.seasonality.index_by_month).toHaveLength(12);
    const outside = dataOf(
      await viewer.call('GET', `${path}?location_id=2276&language_code=en&from=2026-10-01`),
      KEYWORD_METRICS_HISTORY,
    );
    expect(outside.snapshots).toEqual([]);
    expect(fieldCodes(await viewer.call('GET', path))).toEqual(['location_id:missing', 'language_code:missing']);
    expect(fieldCodes(await viewer.call('GET', `${path}?location_id=2276&language_code=EN&from=yesterday`))).toEqual([
      'language_code:string_pattern_mismatch',
      'from:date_from_datetime_parsing',
    ]);
    const ads = dataOf(
      await viewer.call('GET', `${path}?location_id=2276&language_code=en&source=dataforseo_google_ads`),
      KEYWORD_METRICS_HISTORY,
    );
    expect(ads.trend.source).toBe('dataforseo_google_ads');
  });
});
