import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_TERM_IDS, MOCK_VOCABULARY_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import type { Term, TermNode, Vocabulary } from '@/lib/api/types';
import { OFFSET_PAGE, TERM, TERM_NODE, VOCABULARY } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf, type Answer } from '@/test/mock-api';

const vocabularies = (answer: Answer): Vocabulary[] => dataOf(answer, z.array(VOCABULARY));
const vocabulary = (answer: Answer): Vocabulary => dataOf(answer, VOCABULARY);
const termNodes = (answer: Answer): TermNode[] => dataOf(answer, z.array(TERM_NODE));
const termList = (answer: Answer): Term[] => dataOf(answer, z.array(TERM));
const oneTerm = (answer: Answer): Term => dataOf(answer, TERM);

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart, eventus] = MOCK_PROJECTS;
if (!fynix || !cleanstart || !eventus) throw new Error('The fixture projects are missing');
const OTHER_ID = '0192d1a8-0000-7000-8000-000000000000';
const TOPICS = `${W}/vocabularies/${MOCK_VOCABULARY_IDS.topics}`;
const terms = MOCK_TERM_IDS;

/** Each node as `path` with its children under it. */
const shape = (nodes: readonly TermNode[]): unknown[] =>
  nodes.map((node) => (node.children.length === 0 ? node.path : { [node.path]: shape(node.children) }));

describe('vocabularies', () => {
  it('lists the workspace-wide ones first, then those of the projects the member may open, in offset pages', async () => {
    const viewer = mockBrowser('viewer');
    const all = await viewer.call('GET', `${W}/vocabularies`);
    expect(vocabularies(all).map((row) => [row.name, row.project_id, row.term_count])).toEqual([
      ['Topics', null, 6],
      ['Services', fynix.project_id, 3],
    ]);
    expect(pageOf(all, OFFSET_PAGE)).toEqual({ offset: 0, limit: 50, total: 2 });
    const ofCleanstart = vocabularies(
      await viewer.call('GET', `${W}/vocabularies?filter[project_id]=${cleanstart.project_id}`),
    );
    expect(ofCleanstart.map((row) => row.name)).toEqual(['Topics']);
    expect(
      vocabularies(await viewer.call('GET', `${W}/vocabularies?filter[kind]=service`)).map((row) => row.name),
    ).toEqual(['Services']);
    expect(fieldCodes(await viewer.call('GET', `${W}/vocabularies?filter[kind]=colour`))).toEqual([
      'filter[kind]:enum',
    ]);
  });

  it('creates one, refuses a name its scope has, and a project the member cannot open', async () => {
    const editor = mockBrowser('editor');
    const created = await editor.call('POST', `${W}/vocabularies`, {
      kind: 'market',
      name: ' Markets ',
      project_id: eventus.project_id,
      is_hierarchical: true,
    });
    expect(created).toMatchObject({
      status: 201,
      body: { data: { name: 'Markets', project_id: eventus.project_id, is_hierarchical: true, term_count: 0 } },
    });
    expect((await editor.call('POST', `${W}/vocabularies`, { kind: 'topic', name: 'TOPICS' })).code).toBe('duplicate');
    // A name is unique per scope and kind
    expect((await editor.call('POST', `${W}/vocabularies`, { kind: 'tag', name: 'Topics' })).status).toBe(201);
    // The same name in a project is another scope
    expect(
      (await editor.call('POST', `${W}/vocabularies`, { kind: 'topic', name: 'Topics', project_id: fynix.project_id }))
        .status,
    ).toBe(201);
    expect(
      fieldCodes(await editor.call('POST', `${W}/vocabularies`, { kind: 'topic', name: 'X', project_id: OTHER_ID })),
    ).toEqual(['project_id:project_unknown']);
    expect(fieldCodes(await editor.call('POST', `${W}/vocabularies`, { name: '' })).sort()).toEqual(
      ['kind:missing', 'name:string_too_short'].sort(),
    );
  });

  it('hides a vocabulary of a project outside the member scope', async () => {
    const owner = mockBrowser('owner');
    const markets = vocabulary(
      await owner.call('POST', `${W}/vocabularies`, {
        kind: 'market',
        name: 'Markets',
        project_id: eventus.project_id,
      }),
    );
    const analyst = owner.as('analyst');
    expect(vocabularies(await analyst.call('GET', `${W}/vocabularies`)).map((row) => row.name)).not.toContain(
      'Markets',
    );
    expect((await analyst.call('GET', `${W}/vocabularies/${markets.vocabulary_id}/terms`)).code).toBe('not_found');
    expect((await analyst.call('GET', `${W}/vocabularies?filter[project_id]=${eventus.project_id}`)).code).toBe(
      'not_found',
    );
  });

  it('renames one, refuses an empty change, and deletes one with its terms', async () => {
    const editor = mockBrowser('editor');
    const renamed = await editor.call('PATCH', TOPICS, { name: 'Themes', is_single_valued: true });
    expect(vocabulary(renamed)).toMatchObject({ name: 'Themes', is_single_valued: true, kind: 'topic' });
    expect(fieldCodes(await editor.call('PATCH', TOPICS, {}))).toEqual([':value_error']);
    expect(fieldCodes(await editor.call('PATCH', TOPICS, { name: null }))).toEqual(['name:null_not_allowed']);
    expect(fieldCodes(await editor.call('PATCH', TOPICS, { kind: 'tag' }))).toEqual(['kind:extra_forbidden']);
    expect((await editor.call('DELETE', TOPICS)).status).toBe(204);
    expect((await editor.call('GET', `${TOPICS}/terms`)).code).toBe('not_found');
    expect((await editor.call('PATCH', `${W}/terms/${terms.seo}`, { name: 'Search' })).code).toBe('not_found');
  });

  it('answers 404 for another workspace and 403 to members without taxonomy:write', async () => {
    expect((await mockBrowser('owner').call('GET', `/api/v1/workspaces/${OTHER_ID}/vocabularies`)).code).toBe(
      'not_found',
    );
    expect((await mockBrowser('owner').call('GET', `${W}/vocabularies/${OTHER_ID}/terms`)).code).toBe('not_found');
    expect((await mockBrowser('analyst').call('POST', `${W}/vocabularies`, { kind: 'tag', name: 'Tags' })).code).toBe(
      'forbidden',
    );
    expect((await mockBrowser('viewer').call('DELETE', TOPICS)).code).toBe('forbidden');
    expect((await mockBrowser('billing').call('GET', `${W}/vocabularies`)).code).toBe('forbidden');
  });
});

describe('terms', () => {
  it('gives the tree with paths, or the flat list by path', async () => {
    const viewer = mockBrowser('viewer');
    const tree = termNodes(await viewer.call('GET', `${TOPICS}/terms`));
    expect(shape(tree)).toEqual([
      { 'content-marketing': ['content-marketing/blog-strategy'] },
      'paid-search',
      { seo: ['seo/local-seo', 'seo/technical-seo'] },
    ]);
    const flat = termNodes(await viewer.call('GET', `${TOPICS}/terms?format=flat`));
    expect(flat.map((term) => term.path)).toEqual([
      'content-marketing',
      'content-marketing/blog-strategy',
      'paid-search',
      'seo',
      'seo/local-seo',
      'seo/technical-seo',
    ]);
    expect(flat.every((term) => term.children.length === 0)).toBe(true);
    expect(fieldCodes(await viewer.call('GET', `${TOPICS}/terms?format=list`))).toEqual(['format:enum']);
  });

  it('finds terms by name, with their ancestors in the tree', async () => {
    const viewer = mockBrowser('viewer');
    expect(shape(termNodes(await viewer.call('GET', `${TOPICS}/terms?filter[q]=BLOG`)))).toEqual([
      { 'content-marketing': ['content-marketing/blog-strategy'] },
    ]);
    expect(
      termNodes(await viewer.call('GET', `${TOPICS}/terms?format=flat&filter[q]=seo`)).map((term) => term.name),
    ).toEqual(['SEO', 'Local SEO', 'Technical SEO']);
  });

  it('adds a term under a parent with a slug unique among its siblings, and refuses a name it has', async () => {
    const editor = mockBrowser('editor');
    const added = await editor.call('POST', `${TOPICS}/terms`, { name: 'Technical-SEO!', parent_id: terms.seo });
    expect(termList(added)).toEqual([
      expect.objectContaining({
        name: 'Technical-SEO!',
        slug: 'technical-seo-2',
        path: 'seo/technical-seo-2',
        source: 'manual',
      }),
    ]);
    expect((await editor.call('POST', `${TOPICS}/terms`, { name: 'local seo', parent_id: terms.seo })).code).toBe(
      'duplicate',
    );
    expect(
      (await editor.call('POST', `${TOPICS}/terms`, { name: 'Local', slug: 'local-seo', parent_id: terms.seo })).code,
    ).toBe('duplicate');
    expect(fieldCodes(await editor.call('POST', `${TOPICS}/terms`, { name: 'Ads', parent_id: OTHER_ID }))).toEqual([
      'parent_id:term_unknown',
    ]);
  });

  it('adds a batch of paths, creating the parents they lack once', async () => {
    const editor = mockBrowser('editor');
    const added = await editor.call('POST', `${TOPICS}/terms`, {
      items: [
        { path: 'CRM / CRM for Startups' },
        { path: 'CRM/CRM for Agencies', slug: 'agencies' },
        { path: 'SEO/Audits' },
      ],
    });
    expect(termList(added).map((term) => term.path)).toEqual([
      'crm',
      'crm/crm-for-startups',
      'crm/agencies',
      'seo/audits',
    ]);
    expect((await editor.call('POST', `${TOPICS}/terms`, { path: 'SEO/Local SEO' })).code).toBe('duplicate');
  });

  it('refuses inputs the API refuses', async () => {
    const editor = mockBrowser('editor');
    expect(fieldCodes(await editor.call('POST', `${TOPICS}/terms`, { name: 'A', path: 'B' }))).toEqual([':one_of']);
    expect(fieldCodes(await editor.call('POST', `${TOPICS}/terms`, { path: 'A/B', parent_id: terms.seo }))).toEqual([
      ':one_of',
    ]);
    expect(fieldCodes(await editor.call('POST', `${TOPICS}/terms`, { path: 'A//B' }))).toEqual([
      'path:invalid_term_path',
    ]);
    expect(fieldCodes(await editor.call('POST', `${TOPICS}/terms`, { name: 'A', slug: 'Not A Slug' }))).toEqual([
      'slug:string_pattern_mismatch',
    ]);
    const many = Array.from({ length: 501 }, (_, index) => ({ name: `Term ${String(index)}` }));
    expect(fieldCodes(await editor.call('POST', `${TOPICS}/terms`, { items: many }))).toEqual(['items:too_long']);
    expect(fieldCodes(await editor.call('POST', `${TOPICS}/terms`, { items: [{ name: 'A' }, { name: '' }] }))).toEqual([
      'items.1.name:string_too_short',
    ]);
  });

  it('moves a term with its subtree, and refuses a move under itself', async () => {
    const editor = mockBrowser('editor');
    const moved = await editor.call('PATCH', `${W}/terms/${terms.contentMarketing}`, { parent_id: terms.seo });
    expect(oneTerm(moved).path).toBe('seo/content-marketing');
    const flat = termNodes(await editor.call('GET', `${TOPICS}/terms?format=flat&filter[q]=blog`));
    expect(flat.map((term) => term.path)).toEqual(['seo/content-marketing/blog-strategy']);
    expect((await editor.call('PATCH', `${W}/terms/${terms.seo}`, { parent_id: terms.blogStrategy })).code).toBe(
      'cycle_detected',
    );
    expect((await editor.call('PATCH', `${W}/terms/${terms.seo}`, { parent_id: terms.seo })).code).toBe(
      'cycle_detected',
    );
    const root = await editor.call('PATCH', `${W}/terms/${terms.contentMarketing}`, {
      parent_id: null,
      name: 'Content',
    });
    expect(oneTerm(root)).toMatchObject({ path: 'content-marketing', name: 'Content', parent_id: null });
    expect((await editor.call('PATCH', `${W}/terms/${terms.localSeo}`, { name: 'technical seo' })).code).toBe(
      'duplicate',
    );
    expect(fieldCodes(await editor.call('PATCH', `${W}/terms/${terms.localSeo}`, {}))).toEqual([':value_error']);
  });

  it('deletes a term with children only with cascade', async () => {
    const editor = mockBrowser('editor');
    expect((await editor.call('DELETE', `${W}/terms/${terms.seo}`)).code).toBe('has_children');
    expect(fieldCodes(await editor.call('DELETE', `${W}/terms/${terms.seo}?cascade=yes`))).toEqual([
      'cascade:bool_parsing',
    ]);
    expect((await editor.call('DELETE', `${W}/terms/${terms.paidSearch}`)).status).toBe(204);
    expect((await editor.call('DELETE', `${W}/terms/${terms.seo}?cascade=true`)).status).toBe(204);
    expect(shape(termNodes(await editor.call('GET', `${TOPICS}/terms`)))).toEqual([
      { 'content-marketing': ['content-marketing/blog-strategy'] },
    ]);
    expect((await editor.call('PATCH', `${W}/terms/${terms.technicalSeo}`, { name: 'Tech' })).code).toBe('not_found');
  });
});
