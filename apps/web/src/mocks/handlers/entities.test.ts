import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MAX_SEO_COMPETITORS } from './project-entities';
import { matchAliases } from '../alias-matcher';
import { ENTITIES_COOKIE, entitiesCookie, readEntityChanges } from '../entities-state';
import { MOCK_ALIAS_IDS, MOCK_ENTITIES, MOCK_ENTITY_IDS, MOCK_VOCABULARY_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { isUuid } from '@/lib/routes/paths';
import { TEST_API_ORIGIN } from '@/test/api-server';
import {
  ALIASES,
  ALIAS_TEST_RESULT,
  CURSOR_PAGE,
  ENTITY,
  ENTITY_DETAIL,
  ENTITY_DOMAIN,
  PROJECT,
  PROJECT_DOMAIN,
  PROJECT_ENTITY,
  TERM,
} from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart, eventus] = MOCK_PROJECTS;
if (!fynix || !cleanstart || !eventus) throw new Error('The fixture projects are missing');
const P = `${W}/projects/${fynix.project_id}`;
const ids = MOCK_ENTITY_IDS;
const OTHER_ID = '0192d1a8-0000-7000-8000-000000000000';
const ENTITIES = z.array(ENTITY);

/** The `entity_config_version` of the Fynix project, as `GET {P}` gives it. */
async function versionOf(browser: MockBrowser): Promise<number> {
  return dataOf(await browser.call('GET', P), PROJECT).entity_config_version;
}

const namesOf = async (browser: MockBrowser, query: string): Promise<string[]> =>
  dataOf(await browser.call('GET', `${W}/entities?${query}`), ENTITIES).map((entity) => entity.canonical_name);

describe('entities', () => {
  it('lists the workspace by name in cursor pages, and refuses a cursor made for other filters', async () => {
    const editor = mockBrowser('editor');
    const first = await editor.call('GET', `${W}/entities?limit=4`);
    expect(dataOf(first, ENTITIES).map((entity) => entity.canonical_name)).toEqual([
      'Brightwave Digital',
      'Cleanstart',
      'Clickvantage',
      'Fynix',
    ]);
    const page = pageOf(first, CURSOR_PAGE);
    expect(page.has_more).toBe(true);
    const second = await editor.call('GET', `${W}/entities?limit=4&cursor=${page.next_cursor ?? ''}`);
    expect(dataOf(second, ENTITIES)[0]?.canonical_name).toBe('Fynix Audit');
    const reused = await editor.call(
      'GET',
      `${W}/entities?limit=4&filter[entity_type]=brand&cursor=${page.next_cursor ?? ''}`,
    );
    expect(reused).toMatchObject({ status: 400, code: 'invalid_cursor' });
  });

  it('filters by type, by text in names and aliases, and by a live role in a project or any', async () => {
    const editor = mockBrowser('editor');
    expect(await namesOf(editor, 'filter[entity_type]=product')).toEqual(['Fynix Audit']);
    expect(await namesOf(editor, 'filter[q]=FORGE')).toEqual(['Rankforge']);
    // Only an alias holds "capital"
    expect(await namesOf(editor, 'filter[q]=capital')).toEqual(['Rankforge']);
    expect(await namesOf(editor, `filter[project_id]=${fynix.project_id}&filter[role]=competitor`)).toHaveLength(5);
    expect(await namesOf(editor, `filter[project_id]=${cleanstart.project_id}`)).toEqual([
      'Cleanstart',
      'Sparkle & Co',
    ]);
    expect(await namesOf(editor, 'filter[role]=own')).toEqual(['Cleanstart', 'Fynix']);
    expect(fieldCodes(await editor.call('GET', `${W}/entities?filter[q]=`))).toEqual(['filter[q]:string_too_short']);
    expect(fieldCodes(await editor.call('GET', `${W}/entities?sort=name`))).toEqual(['sort:extra_forbidden']);
  });

  it('carries alias counts and domains on list rows', async () => {
    const [row] = dataOf(await mockBrowser('viewer').call('GET', `${W}/entities?filter[q]=rankforge`), ENTITIES);
    expect(row).toMatchObject({
      alias_count: 3,
      domains: [{ domain: { host: 'rankforge.com' }, match_scope: 'registrable' }],
    });
  });

  it('creates an entity with aliases and domains; a registrable rule keeps the registrable domain only', async () => {
    const editor = mockBrowser('editor');
    const created = await editor.call('POST', `${W}/entities`, {
      entity_type: 'brand',
      canonical_name: '  Acme SEO ',
      aliases: [{ alias: ' Acme ' }, { alias: 'Acme\\s?SEO', match_mode: 'regex' }],
      domains: [
        { domain: 'https://www.Acme-SEO.com/pricing' },
        { domain: 'blog.acme-seo.com', match_scope: 'host' },
        { domain: 'www.acme-seo.com', match_scope: 'host' },
      ],
    });
    expect(created.status).toBe(201);
    const entity = dataOf(created, ENTITY);
    expect(isUuid(entity.entity_id)).toBe(true);
    expect(entity).toMatchObject({ canonical_name: 'Acme SEO', alias_count: 2 });
    expect(entity.domains.map((domain) => [domain.domain.host, domain.match_scope])).toEqual([
      ['acme-seo.com', 'registrable'],
      ['blog.acme-seo.com', 'host'],
      ['www.acme-seo.com', 'host'],
    ]);
    const detail = dataOf(await editor.call('GET', `${W}/entities/${entity.entity_id}`), ENTITY_DETAIL);
    expect(detail.aliases.map((alias) => [alias.alias, alias.match_mode, alias.created_by])).toEqual([
      ['Acme', 'word_boundary', null],
      ['Acme\\s?SEO', 'regex', null],
    ]);
    expect(detail).toMatchObject({ projects: [], created_at: entity.created_at });
  });

  it('refuses a name another entity of the same type has, ignoring case', async () => {
    const editor = mockBrowser('editor');
    const brand = await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: 'RANKFORGE' });
    expect(brand.code).toBe('duplicate');
    // A product may share a brand's name
    const product = await editor.call('POST', `${W}/entities`, { entity_type: 'product', canonical_name: 'Rankforge' });
    expect(product.status).toBe(201);
    expect((await editor.call('PATCH', `${W}/entities/${ids.meridian}`, { canonical_name: 'fynix' })).code).toBe(
      'duplicate',
    );
    // Changing the type is checked against the names of the new type
    expect((await editor.call('PATCH', `${W}/entities/${ids.fynixAudit}`, { canonical_name: 'Fynix' })).status).toBe(
      200,
    );
    expect((await editor.call('PATCH', `${W}/entities/${ids.fynixAudit}`, { entity_type: 'brand' })).code).toBe(
      'duplicate',
    );
  });

  it('refuses a body the API refuses', async () => {
    const invalid = await mockBrowser('editor').call('POST', `${W}/entities`, {
      entity_type: 'company',
      color: 'red',
      aliases: [{ alias: '' }],
      domains: [{ domain: 'not a host' }],
    });
    expect(fieldCodes(invalid).sort()).toEqual(
      [
        'aliases.0.alias:string_too_short',
        'canonical_name:missing',
        'color:extra_forbidden',
        'domains.0.domain:invalid_domain',
        'entity_type:enum',
      ].sort(),
    );
  });

  it('gives the detail with aliases, domains and the roles of the projects the caller may open', async () => {
    const detail = dataOf(await mockBrowser('viewer').call('GET', `${W}/entities/${ids.seoWeekly}`), ENTITY_DETAIL);
    expect(detail.aliases.map((alias) => alias.alias)).toEqual(['SEO Weekly']);
    expect(detail.domains.map((domain) => [domain.domain.host, domain.match_scope, domain.path_prefix])).toEqual([
      ['medium.com', 'path_prefix', '/seo-weekly'],
      ['seoweekly.news', 'registrable', null],
    ]);
    expect(detail.projects).toEqual([
      { project_id: fynix.project_id, role: 'watch', is_primary: false, removed_at: null },
    ]);
  });

  it('changes an entity, refuses an empty change, and moves the version of every project that named it', async () => {
    const editor = mockBrowser('editor');
    expect(fieldCodes(await editor.call('PATCH', `${W}/entities/${ids.rankforge}`, {}))).toEqual([':value_error']);
    expect(fieldCodes(await editor.call('PATCH', `${W}/entities/${ids.rankforge}`, { canonical_name: null }))).toEqual([
      'canonical_name:null_not_allowed',
    ]);
    expect(await versionOf(editor)).toBe(1);
    const changed = await editor.call('PATCH', `${W}/entities/${ids.rankforge}`, {
      canonical_name: 'Rankforge Agency',
      description: null,
      is_ambiguous: true,
    });
    expect(dataOf(changed, ENTITY)).toMatchObject({
      canonical_name: 'Rankforge Agency',
      description: null,
      is_ambiguous: true,
    });
    expect(await versionOf(editor)).toBe(2);
    // A removed role still names the entity, so its project moves too
    await editor.call('DELETE', `${P}/entities/${ids.meridian}`);
    expect(await versionOf(editor)).toBe(3);
    await editor.call('PATCH', `${W}/entities/${ids.meridian}`, { description: 'Gone from Fynix.' });
    expect(await versionOf(editor)).toBe(4);
    // Cleanstart never named Rankforge or Meridian
    const other = dataOf(await editor.call('GET', `${W}/projects/${cleanstart.project_id}`), PROJECT);
    expect(other.entity_config_version).toBe(1);
  });

  it('refuses a parent that would make a cycle, and one that is not an entity of the workspace', async () => {
    const editor = mockBrowser('editor');
    const path = `${W}/entities/${ids.fynix}`;
    const cycle = await editor.call('PATCH', path, { parent_entity_id: ids.fynixAudit });
    expect(cycle).toMatchObject({ status: 422, code: 'cycle_detected' });
    expect(cycle.body).not.toHaveProperty('errors');
    expect((await editor.call('PATCH', path, { parent_entity_id: ids.fynix })).code).toBe('cycle_detected');
    const unknown = await editor.call('PATCH', path, { parent_entity_id: OTHER_ID });
    expect(unknown).toMatchObject({ status: 422, code: 'validation_failed' });
    expect(fieldCodes(unknown)).toEqual(['parent_entity_id:parent_unknown']);
    expect((await editor.call('PATCH', `${W}/entities/${ids.fynixAudit}`, { parent_entity_id: null })).status).toBe(
      200,
    );
  });

  it('deletes an entity only when no project ever gave it a role, a removed one included', async () => {
    const editor = mockBrowser('editor');
    expect((await editor.call('DELETE', `${W}/entities/${ids.rankforge}`)).code).toBe('entity_in_use');
    expect((await editor.call('DELETE', `${P}/entities/${ids.meridian}`)).status).toBe(200);
    expect((await editor.call('DELETE', `${W}/entities/${ids.meridian}`)).code).toBe('entity_in_use');
  });

  it('keeps a brand while products name it, then deletes both', async () => {
    const editor = mockBrowser('editor');
    const brand = dataOf(
      await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: 'Orbit' }),
      ENTITY,
    );
    const product = dataOf(
      await editor.call('POST', `${W}/entities`, {
        entity_type: 'product',
        canonical_name: 'Orbit Crawl',
        parent_entity_id: brand.entity_id,
        aliases: [{ alias: 'Orbit Crawl' }],
      }),
      ENTITY,
    );
    expect((await editor.call('DELETE', `${W}/entities/${brand.entity_id}`)).code).toBe('entity_in_use');
    expect((await editor.call('DELETE', `${W}/entities/${product.entity_id}`)).status).toBe(204);
    expect((await editor.call('DELETE', `${W}/entities/${brand.entity_id}`)).status).toBe(204);
    expect((await editor.call('GET', `${W}/entities/${product.entity_id}/aliases`)).code).toBe('not_found');
  });

  it('answers 404 for another workspace and an unknown entity, and 401 without a session', async () => {
    const owner = mockBrowser('owner');
    expect((await owner.call('GET', `/api/v1/workspaces/${OTHER_ID}/entities`)).code).toBe('not_found');
    expect((await owner.call('GET', `${W}/entities/${OTHER_ID}`)).code).toBe('not_found');
    // An entity of a workspace the operator created is not one of Digibranders
    const second = await owner.call('POST', '/api/v1/workspaces', { name: 'Second', slug: 'second-ws' });
    const secondId = dataOf(second, z.object({ workspace_id: z.string() })).workspace_id;
    const theirs = dataOf(
      await owner.call('POST', `/api/v1/workspaces/${secondId}/entities`, {
        entity_type: 'brand',
        canonical_name: 'Fynix',
      }),
      ENTITY,
    );
    expect((await owner.call('GET', `${W}/entities/${theirs.entity_id}`)).code).toBe('not_found');
    expect((await owner.call('GET', `/api/v1/workspaces/${secondId}/entities/${ids.fynix}`)).code).toBe('not_found');
    const anonymous = await fetch(`${TEST_API_ORIGIN}${W}/entities`);
    expect(anonymous.status).toBe(401);
  });

  it('lets every member with data:read read, and only writers write', async () => {
    expect((await mockBrowser('viewer').call('GET', `${W}/entities`)).status).toBe(200);
    expect((await mockBrowser('billing').call('GET', `${W}/entities`)).code).toBe('forbidden');
    const body = { entity_type: 'brand', canonical_name: 'New Rival' };
    expect((await mockBrowser('viewer').call('POST', `${W}/entities`, body)).code).toBe('forbidden');
    expect(
      (await mockBrowser('analyst').call('PATCH', `${W}/entities/${ids.rankforge}`, { is_ambiguous: true })).code,
    ).toBe('forbidden');
    expect((await mockBrowser('analyst').call('DELETE', `${W}/entities/${ids.fynixAudit}`)).code).toBe('forbidden');
  });

  it('shows a member limited to some projects only what those projects name, and lets them change nothing', async () => {
    const owner = mockBrowser('owner');
    const limited = await owner.call('PATCH', `${W}/members/${mockUser('editor').user_id}`, {
      project_ids: [fynix.project_id],
    });
    expect(limited.status).toBe(200);
    const editor = owner.as('editor');
    const names = await namesOf(editor, 'limit=200');
    expect(names).toContain('Rankforge');
    expect(names).not.toContain('Sparkle & Co');
    // Fynix Audit is named by no project
    expect(names).not.toContain('Fynix Audit');
    expect((await editor.call('GET', `${W}/entities/${ids.sparkle}`)).code).toBe('not_found');
    expect((await editor.call('GET', `${W}/entities/${ids.sparkle}/aliases`)).code).toBe('not_found');
    // A project outside the scope filters to nothing, as the backend answers
    expect(await namesOf(editor, `filter[project_id]=${cleanstart.project_id}`)).toEqual([]);
    const write = await editor.call('PATCH', `${W}/entities/${ids.rankforge}`, { is_ambiguous: true });
    expect(write.code).toBe('forbidden');
    expect((await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: 'X' })).code).toBe(
      'forbidden',
    );
  });
});

describe('aliases', () => {
  const aliases = `${W}/entities/${ids.rankforge}/aliases`;

  it('adds one alias or a batch, and refuses one the entity has, as the backend keys them', async () => {
    const editor = mockBrowser('editor');
    const one = await editor.call('POST', aliases, { alias: 'Rankforge SEO', language_code: 'en' });
    expect(one).toMatchObject({ status: 201, body: { data: [{ alias: 'Rankforge SEO', language_code: 'en' }] } });
    const batch = await editor.call('POST', aliases, {
      items: [{ alias: 'RF Agency' }, { alias: 'rankforge.io', match_mode: 'substring' }],
    });
    expect(dataOf(batch, ALIASES)).toHaveLength(2);
    // A word alias that ignores case is the same in any case
    expect((await editor.call('POST', aliases, { alias: 'RANK FORGE' })).code).toBe('duplicate');
    expect((await editor.call('POST', aliases, { items: [{ alias: 'Forge' }, { alias: 'forge' }] })).code).toBe(
      'duplicate',
    );
    // The same text may come back as a negative, a pattern or with case
    expect((await editor.call('POST', aliases, { alias: 'Rankforge', is_negative: true })).status).toBe(201);
    expect((await editor.call('POST', aliases, { alias: 'Rankforge', match_mode: 'regex' })).status).toBe(201);
    expect((await editor.call('POST', aliases, { alias: 'RANKFORGE', match_mode: 'exact_case' })).status).toBe(201);
    expect((await editor.call('POST', aliases, { alias: 'rankforge', match_mode: 'exact_case' })).status).toBe(201);
    expect((await editor.call('POST', aliases, { alias: 'rankforge', match_mode: 'exact_case' })).code).toBe(
      'duplicate',
    );
    expect(dataOf(await editor.call('GET', aliases), ALIASES)).toHaveLength(10);
  });

  it('refuses more than 200 at once, and a pattern that does not compile', async () => {
    const editor = mockBrowser('editor');
    const many = Array.from({ length: 201 }, (_, index) => ({ alias: `Alias ${String(index)}` }));
    expect(fieldCodes(await editor.call('POST', aliases, { items: many }))).toEqual(['items:too_long']);
    expect(fieldCodes(await editor.call('POST', aliases, { alias: 'Rank(forge', match_mode: 'regex' }))).toEqual([
      ':invalid_regex',
    ]);
    expect(
      fieldCodes(await editor.call('POST', aliases, { items: [{ alias: 'ok' }, { alias: '[', match_mode: 'regex' }] })),
    ).toEqual(['items.1:invalid_regex']);
  });

  it('changes and deletes an alias, and moves the version each time', async () => {
    const editor = mockBrowser('editor');
    const path = `${aliases}/${MOCK_ALIAS_IDS.rankforgeCapital}`;
    const changed = await editor.call('PATCH', path, { alias: 'Rankforge Capital Partners', language_code: null });
    expect(dataOf(changed, ALIASES.element)).toMatchObject({ alias: 'Rankforge Capital Partners', is_negative: true });
    // A positive alias with the text of the negative one is another alias
    expect((await editor.call('PATCH', path, { alias: 'rankforge' })).status).toBe(200);
    expect((await editor.call('PATCH', path, { alias: 'rankforge', is_negative: false })).code).toBe('duplicate');
    expect(fieldCodes(await editor.call('PATCH', path, { match_mode: 'regex', alias: '(' }))).toEqual([
      'alias:invalid_regex',
    ]);
    expect((await editor.call('DELETE', path)).status).toBe(204);
    expect((await editor.call('DELETE', path)).code).toBe('not_found');
    expect(await versionOf(editor)).toBe(4);
    // The alias belongs to Clickvantage, not to Fynix
    expect(
      (await editor.call('DELETE', `${W}/entities/${ids.fynix}/aliases/${MOCK_ALIAS_IDS.clickvantagePattern}`)).code,
    ).toBe('not_found');
  });
});

describe('entity domains', () => {
  const domains = (entityId: string): string => `${W}/entities/${entityId}/domains`;

  it('stores a registrable rule against its registrable domain, and a host rule as given', async () => {
    const editor = mockBrowser('editor');
    const added = await editor.call('POST', domains(ids.meridian), {
      domain: 'HTTPS://WWW.Meridian-Growth.co.uk/about',
    });
    expect(added).toMatchObject({
      status: 201,
      body: {
        data: { domain: { host: 'meridian-growth.co.uk', registrable_domain: 'meridian-growth.co.uk' } },
        meta: { warnings: [] },
      },
    });
    // The same registrable domain by another host is the same rule
    expect((await editor.call('POST', domains(ids.meridian), { domain: 'blog.meridian-growth.co.uk' })).code).toBe(
      'duplicate',
    );
    const host = await editor.call('POST', domains(ids.meridian), {
      domain: 'https://www.meridian-growth.co.uk',
      match_scope: 'host',
    });
    expect(dataOf(host, ENTITY_DOMAIN).domain).toMatchObject({
      host: 'www.meridian-growth.co.uk',
      registrable_domain: 'meridian-growth.co.uk',
    });
    expect(
      (await editor.call('POST', domains(ids.meridian), { domain: 'www.meridian-growth.co.uk', match_scope: 'host' }))
        .code,
    ).toBe('duplicate');
  });

  it('refuses what is not a domain, a public suffix as a registrable rule, and a path prefix that does not fit', async () => {
    const editor = mockBrowser('editor');
    const post = async (body: unknown): Promise<string[]> =>
      fieldCodes(await editor.call('POST', domains(ids.meridian), body));
    expect(await post({ domain: 'mailto:hello@acme.com' })).toEqual(['domain:invalid_domain']);
    expect(await post({ domain: 'localhost' })).toEqual(['domain:invalid_domain']);
    expect(await post({ domain: 'co.uk' })).toEqual([':domain_is_public_suffix']);
    expect(await post({ domain: 'https://github.io' })).toEqual([':domain_is_public_suffix']);
    expect(await post({ domain: 'acme.com', path_prefix: '/blog' })).toEqual([':path_prefix_mismatch']);
    expect(await post({ domain: 'acme.com', match_scope: 'path_prefix' })).toEqual([':path_prefix_mismatch']);
    expect(await post({ domain: 'acme.com', match_scope: 'path_prefix', path_prefix: '/blog?x=1' })).toEqual([
      'path_prefix:invalid_path_prefix',
    ]);
    const prefixed = await editor.call('POST', domains(ids.meridian), {
      domain: 'www.medium.com',
      match_scope: 'path_prefix',
      path_prefix: '/@meridian/',
    });
    expect(dataOf(prefixed, ENTITY_DOMAIN)).toMatchObject({
      domain: { host: 'www.medium.com' },
      path_prefix: '/@meridian',
    });
  });

  it('warns when another entity of a shared project claims the same domain at the same scope', async () => {
    const editor = mockBrowser('editor');
    const conflict = await editor.call('POST', domains(ids.clickvantage), { domain: 'www.rankforge.com' });
    expect(conflict.body).toMatchObject({ meta: { warnings: ['domain_role_conflict'] } });
    // At another scope it claims something else
    const host = await editor.call('POST', domains(ids.clickvantage), { domain: 'rankforge.com', match_scope: 'host' });
    expect(host.body).toMatchObject({ meta: { warnings: [] } });
    // Sparkle and Rankforge share no project
    const apart = await editor.call('POST', domains(ids.sparkle), { domain: 'rankforge.com' });
    expect(apart.body).toMatchObject({ meta: { warnings: [] } });
  });

  it('deletes a domain by its entity domain id', async () => {
    const editor = mockBrowser('editor');
    const [domain] = dataOf(await editor.call('GET', domains(ids.meridian)), z.array(ENTITY_DOMAIN));
    if (!domain) throw new Error('Meridian has no domain');
    const path = `${domains(ids.meridian)}/${domain.entity_domain_id}`;
    expect((await editor.call('DELETE', path)).status).toBe(204);
    expect((await editor.call('DELETE', path)).code).toBe('not_found');
    expect(dataOf(await editor.call('GET', domains(ids.meridian)), z.array(ENTITY_DOMAIN))).toEqual([]);
  });
});

describe('project entities', () => {
  const PROJECT_ENTITIES = z.array(PROJECT_ENTITY);

  it('lists own first, then competitors, then watched, with filters for the role and removed ones', async () => {
    const viewer = mockBrowser('viewer');
    const rows = dataOf(await viewer.call('GET', `${P}/entities`), PROJECT_ENTITIES);
    expect(rows.map((row) => [row.entity.canonical_name, row.role, row.color_index])).toEqual([
      ['Fynix', 'own', 1],
      ['Brightwave Digital', 'competitor', 2],
      ['Clickvantage', 'competitor', 5],
      ['Meridian Growth', 'competitor', 6],
      ['Northlight SEO', 'competitor', 4],
      ['Rankforge', 'competitor', 3],
      ['SEO Weekly', 'watch', null],
    ]);
    expect(rows[0]).toMatchObject({ is_primary: true, alias_count: 2, entity: { role: 'own', color_index: 1 } });
    expect(dataOf(await viewer.call('GET', `${P}/entities?filter[role]=watch`), PROJECT_ENTITIES)).toHaveLength(1);
    expect(fieldCodes(await viewer.call('GET', `${P}/entities?filter[include_removed]=maybe`))).toEqual([
      'filter[include_removed]:bool_parsing',
    ]);
  });

  it('attaches, refuses a second role, removes keeping the row, and restores it on a new attach', async () => {
    const editor = mockBrowser('editor');
    const attached = await editor.call('POST', `${P}/entities`, {
      entity_id: ids.fynixAudit,
      role: 'watch',
      color_index: 6,
    });
    expect(attached).toMatchObject({
      status: 201,
      body: { data: { role: 'watch', removed_at: null, color_index: 6 } },
    });
    expect((await editor.call('POST', `${P}/entities`, { entity_id: ids.fynixAudit, role: 'watch' })).code).toBe(
      'duplicate',
    );
    const removed = dataOf(await editor.call('DELETE', `${P}/entities/${ids.fynixAudit}`), PROJECT_ENTITY);
    expect(removed.removed_at).not.toBeNull();
    expect(
      dataOf(await editor.call('GET', `${P}/entities`), PROJECT_ENTITIES).map((row) => row.entity.entity_id),
    ).not.toContain(ids.fynixAudit);
    const withRemoved = dataOf(
      await editor.call('GET', `${P}/entities?filter[include_removed]=true`),
      PROJECT_ENTITIES,
    );
    expect(withRemoved.find((row) => row.entity.entity_id === ids.fynixAudit)?.removed_at).toBe(removed.removed_at);
    const back = await editor.call('POST', `${P}/entities`, {
      entity_id: ids.fynixAudit,
      role: 'competitor',
      track_seo: false,
    });
    expect(back).toMatchObject({
      status: 201,
      body: { data: { role: 'competitor', removed_at: null, track_seo: false } },
    });
    // Attach, remove and attach again: three changes
    expect(await versionOf(editor)).toBe(4);
  });

  it(`refuses more than ${String(MAX_SEO_COMPETITORS)} competitors tracked for SEO`, async () => {
    const editor = mockBrowser('editor');
    for (let index = 5; index < MAX_SEO_COMPETITORS; index += 1) {
      const entity = dataOf(
        await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: `Rival ${String(index)}` }),
        ENTITY,
      );
      expect(
        (await editor.call('POST', `${P}/entities`, { entity_id: entity.entity_id, role: 'competitor' })).status,
      ).toBe(201);
    }
    const full = await editor.call('POST', `${P}/entities`, { entity_id: ids.fynixAudit, role: 'competitor' });
    expect(full).toMatchObject({ status: 422, body: { code: 'competitor_limit', limit: 10, used: 10 } });
    // Without SEO tracking it does not count
    const aiOnly = await editor.call('POST', `${P}/entities`, {
      entity_id: ids.fynixAudit,
      role: 'competitor',
      track_seo: false,
    });
    expect(aiOnly.status).toBe(201);
    expect((await editor.call('PATCH', `${P}/entities/${ids.fynixAudit}`, { track_seo: true })).code).toBe(
      'competitor_limit',
    );
  });

  it('keeps one primary own entity, which cannot be removed', async () => {
    const editor = mockBrowser('editor');
    const second = await editor.call('POST', `${P}/entities`, {
      entity_id: ids.fynixAudit,
      role: 'own',
      is_primary: true,
    });
    expect(second.code).toBe('primary_own_exists');
    expect(
      fieldCodes(
        await editor.call('POST', `${P}/entities`, { entity_id: ids.fynixAudit, role: 'watch', is_primary: true }),
      ),
    ).toEqual([':value_error']);
    expect((await editor.call('DELETE', `${P}/entities/${ids.fynix}`)).code).toBe('cannot_remove_primary_own');
    expect(fieldCodes(await editor.call('POST', `${P}/entities`, { entity_id: OTHER_ID, role: 'watch' }))).toEqual([
      'entity_id:entity_unknown',
    ]);
  });

  it('changes a role, refuses an empty change, and answers 404 for an entity the project has not', async () => {
    const editor = mockBrowser('editor');
    const changed = await editor.call('PATCH', `${P}/entities/${ids.northlight}`, {
      color_index: null,
      track_ai: false,
    });
    expect(dataOf(changed, PROJECT_ENTITY)).toMatchObject({ color_index: null, track_ai: false, track_seo: true });
    expect(fieldCodes(await editor.call('PATCH', `${P}/entities/${ids.northlight}`, {}))).toEqual([':value_error']);
    expect(fieldCodes(await editor.call('PATCH', `${P}/entities/${ids.northlight}`, { color_index: 7 }))).toEqual([
      'color_index:less_than_equal',
    ]);
    expect((await editor.call('PATCH', `${P}/entities/${ids.sparkle}`, { track_ai: false })).code).toBe('not_found');
  });

  it('lists the project domains from its roles, by role', async () => {
    const viewer = mockBrowser('viewer');
    const PROJECT_DOMAINS = z.array(PROJECT_DOMAIN);
    const own = dataOf(await viewer.call('GET', `${P}/domains?filter[role]=own`), PROJECT_DOMAINS);
    expect(own).toEqual([
      expect.objectContaining({
        domain: expect.objectContaining({ host: 'fynix.digital' }),
        entity: expect.objectContaining({ role: 'own', color_index: 1 }),
      }),
    ]);
    const watched = dataOf(await viewer.call('GET', `${P}/domains?filter[role]=watch`), PROJECT_DOMAINS);
    expect(watched.map((row) => [row.domain.host, row.match_scope, row.path_prefix])).toEqual([
      ['medium.com', 'path_prefix', '/seo-weekly'],
      ['seoweekly.news', 'registrable', null],
    ]);
    expect(dataOf(await viewer.call('GET', `${P}/domains`), PROJECT_DOMAINS)).toHaveLength(8);
  });

  it('answers 404 for a project outside the member scope, and 403 to readers who write', async () => {
    const analyst = mockBrowser('analyst');
    expect((await analyst.call('GET', `${W}/projects/${eventus.project_id}/entities`)).code).toBe('not_found');
    expect((await analyst.call('GET', `${P}/entities`)).status).toBe(200);
    expect((await analyst.call('POST', `${P}/entities`, { entity_id: ids.fynixAudit, role: 'watch' })).code).toBe(
      'forbidden',
    );
    expect((await mockBrowser('viewer').call('DELETE', `${P}/entities/${ids.rankforge}`)).code).toBe('forbidden');
    // A project of another workspace is not found, whatever the body says
    expect(
      (await analyst.call('POST', `/api/v1/workspaces/${OTHER_ID}/projects/${fynix.project_id}/entities`, {})).code,
    ).toBe('not_found');
  });
});

describe('the alias test', () => {
  const test = async (body: unknown, browser: MockBrowser = mockBrowser('viewer')): Promise<AliasTest> =>
    dataOf(await browser.call('POST', `${P}/alias-test`, body), ALIAS_TEST_RESULT);
  type AliasTest = z.infer<typeof ALIAS_TEST_RESULT>;

  it('matches word aliases ignoring case, at UTF-16 offsets, longest first', async () => {
    const text = 'Ünïcödé 😀 Fynix Digital beats rankforge and BRIGHTWAVEs.';
    const result = await test({ text });
    expect(result.mentions.map((mention) => mention.entity.canonical_name)).toEqual([
      'Fynix',
      'Rankforge',
      'Brightwave Digital',
    ]);
    const [own, rival] = result.mentions;
    expect(own?.spans).toEqual([
      expect.objectContaining({
        start: text.indexOf('Fynix'),
        end: text.indexOf(' beats'),
        match_method: 'alias_word',
        status: 'accepted',
        score: 0.95,
      }),
    ]);
    // The name matches too, and the stored alias of the same text takes the span
    expect(rival?.spans).toEqual([
      expect.objectContaining({ match_method: 'alias_word', alias_id: expect.any(String) }),
    ]);
    expect(text.slice(rival?.spans[0]?.start, rival?.spans[0]?.end)).toBe('rankforge');
    expect(own).toMatchObject({ confidence: 0.95, status: 'accepted', entity: { role: 'own', color_index: 1 } });
    expect(result.skipped_alias_ids).toEqual([]);
  });

  it('matches an entity by its name alone, and an ambiguous name only with context', async () => {
    const editor = mockBrowser('editor');
    for (const [name, ambiguous] of [
      ['Orbitly', false],
      ['Notion', true],
    ] as const) {
      const entity = dataOf(
        await editor.call('POST', `${W}/entities`, {
          entity_type: 'brand',
          canonical_name: name,
          is_ambiguous: ambiguous,
        }),
        ENTITY,
      );
      await editor.call('POST', `${P}/entities`, { entity_id: entity.entity_id, role: 'watch' });
    }
    const result = await test({ text: 'We compared ORBITLY with notion last week.' }, editor);
    expect(
      result.mentions.map((mention) => [
        mention.entity.canonical_name,
        mention.spans[0]?.match_method,
        mention.spans[0]?.alias_id,
        mention.status,
      ]),
    ).toEqual([
      ['Orbitly', 'alias_name', null, 'accepted'],
      ['Notion', 'alias_name', null, 'discarded'],
    ]);
  });

  it('drops a mention inside a negative alias and says which one', async () => {
    const text = 'Rankforge Capital invested in Rankforge.';
    const result = await test({ text });
    expect(result.negatives_applied).toEqual([
      { start: 0, end: 'Rankforge Capital'.length, alias_id: MOCK_ALIAS_IDS.rankforgeCapital },
    ]);
    expect(result.mentions[0]?.spans.map((span) => span.start)).toEqual([text.lastIndexOf('Rankforge')]);
  });

  it('scores an ambiguous name low, and higher near one of its hints', async () => {
    const alone = await test({ text: 'The northlight over the lake.' });
    expect(alone.mentions[0]).toMatchObject({ confidence: 0.3, status: 'discarded' });
    const hinted = await test({ markdown: 'Northlight is an **agency** we know.' });
    expect(hinted.mentions[0]).toMatchObject({ confidence: 0.65, status: 'uncertain' });
  });

  it('runs patterns and domain-shaped aliases, and orders mentions by their first span that counts', async () => {
    const text = 'Read meridiangrowth.com/blog, then try Click Vantage. Northlight sits apart.';
    const result = await test({ text });
    expect(
      result.mentions.map((mention) => [mention.entity.canonical_name, mention.spans[0]?.match_method, mention.status]),
    ).toEqual([
      ['Meridian Growth', 'alias_domain', 'accepted'],
      ['Clickvantage', 'alias_regex', 'accepted'],
      ['Northlight SEO', 'alias_word', 'discarded'],
    ]);
    expect(result.mentions[0]?.spans[0]?.alias_id).toBeNull();
  });

  it('takes exactly one of text and markdown, up to 100 KB', async () => {
    const viewer = mockBrowser('viewer');
    expect(fieldCodes(await viewer.call('POST', `${P}/alias-test`, { text: 'a', markdown: 'b' }))).toEqual([':one_of']);
    expect(fieldCodes(await viewer.call('POST', `${P}/alias-test`, {}))).toEqual([':one_of']);
    expect(fieldCodes(await viewer.call('POST', `${P}/alias-test`, { observation_id: '1', text: 'a' }))).toEqual([
      'observation_id:extra_forbidden',
    ]);
    const large = await viewer.call('POST', `${P}/alias-test`, { text: 'é'.repeat(51_201) });
    expect(large).toMatchObject({ status: 413, code: 'payload_too_large' });
  });

  it('refuses a text that matches too often', async () => {
    const editor = mockBrowser('editor');
    await editor.call('POST', `${W}/entities/${ids.fynix}/aliases`, {
      items: [
        { alias: 'a', match_mode: 'substring' },
        { alias: '[a]', match_mode: 'regex' },
        { alias: '(?:a)', match_mode: 'regex' },
      ],
    });
    const answer = await editor.call('POST', `${P}/alias-test`, { text: 'a'.repeat(100 * 1024) });
    expect(answer).toMatchObject({ status: 422, code: 'too_many_matches' });
  });

  it('leaves out a stored pattern it cannot run, and names it', () => {
    const [entity] = MOCK_ENTITIES;
    if (!entity) throw new Error('No fixture entity');
    const result = matchAliases('Fynix', [
      {
        entity,
        aliases: [
          { alias_id: 'broken', entity_id: entity.entity_id, alias: '(', match_mode: 'regex', created_at: '' },
          { alias_id: 'word', entity_id: entity.entity_id, alias: 'Fynix', created_at: '' },
        ],
        domains: [],
      },
    ]);
    expect(result.skipped_alias_ids).toEqual(['broken']);
    expect(result.mentions).toHaveLength(1);
  });
});

/** Ten competitor agencies, each with a domain and two aliases, as a person would add them. */
const COMPETITORS = [
  'Brightline Media',
  'Searchwise Partners',
  'Northstar Digital',
  'Pixelcraft Agency',
  'Growthloop Marketing',
  'Rankwell Studio',
  'Bluepeak SEO',
  'Clearpath Digital',
  'Velocity Search',
  'Summit Growth Co',
];

/** Six topics of five terms each, by path. */
const TERM_PATHS = ['Technical SEO', 'Content', 'Local Search', 'Link Building', 'Analytics', 'Paid Media'].flatMap(
  (topic) => [topic, ...['Strategy', 'Audits', 'Reporting', 'Tooling'].map((leaf) => `${topic}/${topic} ${leaf}`)],
);

describe('the entity state', () => {
  it('keeps changes in its cookie, with ids the app accepts, which another process reads back', async () => {
    const editor = mockBrowser('editor');
    const created = dataOf(
      await editor.call('POST', `${W}/entities`, { entity_type: 'person', canonical_name: 'Ada' }),
      ENTITY,
    );
    expect(isUuid(created.entity_id)).toBe(true);
    const saved = editor.cookie(ENTITIES_COOKIE);
    if (saved === undefined) throw new Error('No entity cookie was set');
    const changes = readEntityChanges({ [ENTITIES_COOKIE]: saved });
    expect(changes.entities?.created?.map((entity) => entity.canonical_name)).toEqual(['Ada']);
    // Defaults are left out of the stored row
    expect(changes.entities?.created?.[0]).not.toHaveProperty('is_ambiguous');
    const fresh = mockBrowser('viewer', new Map([[ENTITIES_COOKIE, saved]]));
    expect(dataOf(await fresh.call('GET', `${W}/entities/${created.entity_id}`), ENTITY_DETAIL)).toMatchObject({
      canonical_name: 'Ada',
      created_at: created.created_at,
    });
  });

  it('holds ten competitors with a domain and two aliases each, and thirty terms, in one cookie', async () => {
    const editor = mockBrowser('editor');
    const project = `${W}/projects/${eventus.project_id}`;
    for (const [index, name] of COMPETITORS.entries()) {
      const host = `${name.toLowerCase().replaceAll(' ', '')}.com`;
      const entity = await editor.call('POST', `${W}/entities`, {
        entity_type: 'brand',
        canonical_name: name,
        domains: [{ domain: `https://www.${host}/` }],
        aliases: [{ alias: name }, { alias: name.split(' ')[0] ?? name }],
      });
      expect(entity.status).toBe(201);
      const role = await editor.call('POST', `${project}/entities`, {
        entity_id: dataOf(entity, ENTITY).entity_id,
        role: 'competitor',
        color_index: (index % 5) + 2,
      });
      expect(role.status).toBe(201);
    }
    const terms = await editor.call('POST', `${W}/vocabularies/${MOCK_VOCABULARY_IDS.topics}/terms`, {
      items: TERM_PATHS.map((path) => ({ path })),
    });
    expect(dataOf(terms, z.array(TERM))).toHaveLength(30);
    const saved = editor.cookie(ENTITIES_COOKIE) ?? '';
    // About 2.5 KB of the 3.8 KB a cookie may take
    expect(saved.length).toBeLessThan(2800);
    // Everything reads back from the cookie alone
    const fresh = mockBrowser('viewer', new Map([[ENTITIES_COOKIE, saved]]));
    const rows = dataOf(await fresh.call('GET', `${project}/entities`), z.array(PROJECT_ENTITY));
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.alias_count === 2 && row.domains.length === 1)).toBe(true);
    expect(rows[0]?.domains[0]?.domain.host).toBe('bluepeakseo.com');
  });

  it('answers a 422 that says which cookie to expire when the state no longer fits', async () => {
    const editor = mockBrowser('editor');
    let answer = await editor.call('GET', `${W}/entities`);
    for (let index = 0; index < 40 && answer.status !== 422; index += 1) {
      answer = await editor.call('POST', `${W}/entities`, {
        entity_type: 'organization',
        canonical_name: `${'Long organization name '.repeat(8)}${String(index)}`,
      });
    }
    expect(answer).toMatchObject({ status: 422, code: 'mock_state_full' });
    expect(answer.body.detail).toEqual(expect.stringContaining(ENTITIES_COOKIE));
  });

  it('ignores a cookie it cannot read, and gives no cookie for state too large to keep', async () => {
    const browser = mockBrowser('viewer', new Map([[ENTITIES_COOKIE, 'not-json!']]));
    expect(dataOf(await browser.call('GET', `${W}/entities?limit=200`), ENTITIES)).toHaveLength(MOCK_ENTITIES.length);
    const huge = Array.from({ length: 80 }, (_, index) => ({
      entity_id: `0192d1a8-ffff-7000-8000-${String(index).padStart(12, '0')}`,
      entity_type: 'brand' as const,
      canonical_name: `Entity ${String(index)}`,
      created_at: '2026-10-01T00:00:00Z',
    }));
    expect(entitiesCookie({ entities: { created: huge } })).toBeNull();
  });
});
