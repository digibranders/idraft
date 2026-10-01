import { describe, expect, it } from 'vitest';

import { MAX_SEO_COMPETITORS } from './project-entities';
import { matchAliases } from '../alias-matcher';
import { ENTITIES_COOKIE, entitiesCookie, readEntityChanges } from '../entities-state';
import { MOCK_ALIAS_IDS, MOCK_ENTITIES, MOCK_ENTITY_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import type {
  AliasTestResult,
  Entity,
  EntityDetail,
  EntityDomain,
  Project,
  ProjectDomain,
  ProjectEntity,
} from '@/lib/api/types';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { dataOf, fieldCodes, mockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart, eventus] = MOCK_PROJECTS;
if (!fynix || !cleanstart || !eventus) throw new Error('The fixture projects are missing');
const P = `${W}/projects/${fynix.project_id}`;
const ids = MOCK_ENTITY_IDS;
const OTHER_ID = '0192d1a8-0000-7000-8000-000000000000';

/** The `entity_config_version` of the Fynix project, as `GET {P}` gives it. */
async function versionOf(browser: ReturnType<typeof mockBrowser>): Promise<number> {
  return dataOf<Project>(await browser.call('GET', P)).entity_config_version;
}

describe('entities', () => {
  it('lists the workspace by name in cursor pages, and refuses a cursor made for other filters', async () => {
    const editor = mockBrowser('editor');
    const first = await editor.call('GET', `${W}/entities?limit=4`);
    const names = dataOf<Entity[]>(first).map((entity) => entity.canonical_name);
    expect(names).toEqual(['Brightwave Digital', 'Cleanstart', 'Clickvantage', 'Fynix']);
    const page = first.body.page as { next_cursor: string; has_more: boolean };
    expect(page.has_more).toBe(true);
    const second = await editor.call('GET', `${W}/entities?limit=4&cursor=${page.next_cursor}`);
    expect(dataOf<Entity[]>(second).map((entity) => entity.canonical_name)[0]).toBe('Fynix Audit');
    const reused = await editor.call(
      'GET',
      `${W}/entities?limit=4&filter[entity_type]=brand&cursor=${page.next_cursor}`,
    );
    expect(reused).toMatchObject({ status: 400, code: 'invalid_cursor' });
  });

  it('filters by type, text, project and role, and asks for a project with a role', async () => {
    const editor = mockBrowser('editor');
    const names = async (query: string): Promise<string[]> =>
      dataOf<Entity[]>(await editor.call('GET', `${W}/entities?${query}`)).map((entity) => entity.canonical_name);
    expect(await names('filter[entity_type]=product')).toEqual(['Fynix Audit']);
    expect(await names('filter[q]=FORGE')).toEqual(['Rankforge']);
    expect(await names(`filter[project_id]=${fynix.project_id}&filter[role]=competitor`)).toHaveLength(5);
    expect(await names(`filter[project_id]=${cleanstart.project_id}`)).toEqual(['Cleanstart', 'Sparkle & Co']);
    expect(fieldCodes(await editor.call('GET', `${W}/entities?filter[role]=own`))).toEqual([
      'filter[role]:value_error',
    ]);
    expect(fieldCodes(await editor.call('GET', `${W}/entities?sort=name`))).toEqual(['sort:extra_forbidden']);
  });

  it('carries alias counts and domains on list rows', async () => {
    const rows = dataOf<Entity[]>(await mockBrowser('viewer').call('GET', `${W}/entities?filter[q]=rankforge`));
    expect(rows[0]).toMatchObject({
      alias_count: 3,
      domains: [{ domain: { host: 'rankforge.com' }, match_scope: 'registrable' }],
    });
  });

  it('creates an entity with its aliases and domains in one request', async () => {
    const editor = mockBrowser('editor');
    const created = await editor.call('POST', `${W}/entities`, {
      entity_type: 'brand',
      canonical_name: '  Acme SEO ',
      aliases: [{ alias: ' Acme ' }, { alias: 'Acme\\s?SEO', match_mode: 'regex' }],
      domains: [{ domain: 'https://www.Acme-SEO.com/pricing' }, { domain: 'blog.acme-seo.com', match_scope: 'host' }],
    });
    expect(created.status).toBe(201);
    const entity = dataOf<Entity>(created);
    expect(entity).toMatchObject({ canonical_name: 'Acme SEO', alias_count: 2 });
    expect(entity.domains.map((domain) => [domain.domain.host, domain.match_scope])).toEqual([
      ['acme-seo.com', 'registrable'],
      ['blog.acme-seo.com', 'host'],
    ]);
    const detail = dataOf<EntityDetail>(await editor.call('GET', `${W}/entities/${entity.entity_id}`));
    expect(detail.aliases.map((alias) => [alias.alias, alias.match_mode, alias.created_by?.email])).toEqual([
      ['Acme', 'word_boundary', 'priya@digibranders.test'],
      ['Acme\\s?SEO', 'regex', 'priya@digibranders.test'],
    ]);
    expect(detail.projects).toEqual([]);
  });

  it('refuses a name another entity has, ignoring case', async () => {
    const editor = mockBrowser('editor');
    expect(
      (await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: 'RANKFORGE' })).code,
    ).toBe('duplicate');
    expect((await editor.call('PATCH', `${W}/entities/${ids.meridian}`, { canonical_name: 'fynix' })).code).toBe(
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
    const detail = dataOf<EntityDetail>(await mockBrowser('viewer').call('GET', `${W}/entities/${ids.seoWeekly}`));
    expect(detail.aliases.map((alias) => alias.alias)).toEqual(['SEO Weekly']);
    expect(detail.domains.map((domain) => [domain.domain.host, domain.match_scope, domain.path_prefix])).toEqual([
      ['medium.com', 'path_prefix', '/seo-weekly'],
      ['seoweekly.news', 'registrable', null],
    ]);
    expect(detail.projects).toEqual([
      { project_id: fynix.project_id, role: 'watch', is_primary: false, removed_at: null },
    ]);
  });

  it('changes an entity, refuses an empty change, and moves the version of the projects using it', async () => {
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
    expect(dataOf<Entity>(changed)).toMatchObject({
      canonical_name: 'Rankforge Agency',
      description: null,
      is_ambiguous: true,
    });
    expect(await versionOf(editor)).toBe(2);
    // Cleanstart does not use Rankforge
    const other = dataOf<Project>(await editor.call('GET', `${W}/projects/${cleanstart.project_id}`));
    expect(other.entity_config_version).toBe(1);
  });

  it('refuses a parent that would make a cycle, and one that is not an entity of the workspace', async () => {
    const editor = mockBrowser('editor');
    const path = `${W}/entities/${ids.fynix}`;
    expect((await editor.call('PATCH', path, { parent_entity_id: ids.fynixAudit })).code).toBe('cycle_detected');
    expect((await editor.call('PATCH', path, { parent_entity_id: ids.fynix })).code).toBe('cycle_detected');
    expect(fieldCodes(await editor.call('PATCH', path, { parent_entity_id: OTHER_ID }))).toEqual([
      'parent_entity_id:entity_unknown',
    ]);
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
    const brand = dataOf<Entity>(
      await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: 'Orbit' }),
    );
    const product = dataOf<Entity>(
      await editor.call('POST', `${W}/entities`, {
        entity_type: 'product',
        canonical_name: 'Orbit Crawl',
        parent_entity_id: brand.entity_id,
        aliases: [{ alias: 'Orbit Crawl' }],
      }),
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
    const secondId = dataOf<{ workspace_id: string }>(second).workspace_id;
    const theirs = dataOf<Entity>(
      await owner.call('POST', `/api/v1/workspaces/${secondId}/entities`, {
        entity_type: 'brand',
        canonical_name: 'Fynix',
      }),
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
});

describe('aliases', () => {
  const aliases = `${W}/entities/${ids.rankforge}/aliases`;

  it('adds one alias or a batch, and refuses one the entity has ignoring case', async () => {
    const editor = mockBrowser('editor');
    const one = await editor.call('POST', aliases, { alias: 'Rankforge SEO', language_code: 'en' });
    expect(one).toMatchObject({ status: 201, body: { data: [{ alias: 'Rankforge SEO', language_code: 'en' }] } });
    const batch = await editor.call('POST', aliases, {
      items: [{ alias: 'RF Agency' }, { alias: 'rankforge.io', match_mode: 'substring' }],
    });
    expect(dataOf<unknown[]>(batch)).toHaveLength(2);
    expect((await editor.call('POST', aliases, { alias: 'RANK FORGE' })).code).toBe('duplicate');
    expect((await editor.call('POST', aliases, { items: [{ alias: 'Forge' }, { alias: 'forge' }] })).code).toBe(
      'duplicate',
    );
    const list = dataOf<unknown[]>(await editor.call('GET', aliases));
    expect(list).toHaveLength(6);
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
    expect(dataOf<{ alias: string; is_negative: boolean }>(changed)).toMatchObject({
      alias: 'Rankforge Capital Partners',
      is_negative: true,
    });
    expect((await editor.call('PATCH', path, { alias: 'rankforge' })).code).toBe('duplicate');
    expect(fieldCodes(await editor.call('PATCH', path, { match_mode: 'regex', alias: '(' }))).toEqual([
      ':invalid_regex',
    ]);
    expect((await editor.call('DELETE', path)).status).toBe(204);
    expect((await editor.call('DELETE', path)).code).toBe('not_found');
    expect(await versionOf(editor)).toBe(3);
    // The alias belongs to Rankforge, not to another entity
    expect(
      (await editor.call('DELETE', `${W}/entities/${ids.fynix}/aliases/${MOCK_ALIAS_IDS.clickvantagePattern}`)).code,
    ).toBe('not_found');
  });
});

describe('entity domains', () => {
  const domains = (entityId: string): string => `${W}/entities/${entityId}/domains`;

  it('canonicalizes the host, and refuses the same host at the same scope', async () => {
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
    expect((await editor.call('POST', domains(ids.meridian), { domain: 'meridian-growth.co.uk' })).code).toBe(
      'duplicate',
    );
    const host = await editor.call('POST', domains(ids.meridian), {
      domain: 'meridian-growth.co.uk',
      match_scope: 'host',
    });
    expect(host.status).toBe(201);
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
      domain: 'medium.com',
      match_scope: 'path_prefix',
      path_prefix: '/@meridian/',
    });
    expect(dataOf<EntityDomain>(prefixed).path_prefix).toBe('/@meridian');
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
    const [domain] = dataOf<EntityDomain[]>(await editor.call('GET', domains(ids.meridian)));
    if (!domain) throw new Error('Meridian has no domain');
    const path = `${domains(ids.meridian)}/${domain.entity_domain_id}`;
    expect((await editor.call('DELETE', path)).status).toBe(204);
    expect((await editor.call('DELETE', path)).code).toBe('not_found');
    expect(dataOf<EntityDomain[]>(await editor.call('GET', domains(ids.meridian)))).toEqual([]);
  });
});

describe('project entities', () => {
  it('lists own first, then competitors, then watched, with filters for the role and removed ones', async () => {
    const viewer = mockBrowser('viewer');
    const rows = dataOf<ProjectEntity[]>(await viewer.call('GET', `${P}/entities`));
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
    expect(dataOf<unknown[]>(await viewer.call('GET', `${P}/entities?filter[role]=watch`))).toHaveLength(1);
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
    const removed = dataOf<ProjectEntity>(await editor.call('DELETE', `${P}/entities/${ids.fynixAudit}`));
    expect(removed.removed_at).not.toBeNull();
    expect(
      dataOf<ProjectEntity[]>(await editor.call('GET', `${P}/entities`)).map((row) => row.entity.entity_id),
    ).not.toContain(ids.fynixAudit);
    const withRemoved = dataOf<ProjectEntity[]>(await editor.call('GET', `${P}/entities?filter[include_removed]=true`));
    expect(withRemoved.find((row) => row.entity.entity_id === ids.fynixAudit)?.removed_at).not.toBeNull();
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
      const entity = dataOf<Entity>(
        await editor.call('POST', `${W}/entities`, { entity_type: 'brand', canonical_name: `Rival ${String(index)}` }),
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
    expect(dataOf<ProjectEntity>(changed)).toMatchObject({ color_index: null, track_ai: false, track_seo: true });
    expect(fieldCodes(await editor.call('PATCH', `${P}/entities/${ids.northlight}`, {}))).toEqual([':value_error']);
    expect(fieldCodes(await editor.call('PATCH', `${P}/entities/${ids.northlight}`, { color_index: 7 }))).toEqual([
      'color_index:less_than_equal',
    ]);
    expect((await editor.call('PATCH', `${P}/entities/${ids.sparkle}`, { track_ai: false })).code).toBe('not_found');
  });

  it('lists the project domains from its roles, by role', async () => {
    const viewer = mockBrowser('viewer');
    const own = dataOf<ProjectDomain[]>(await viewer.call('GET', `${P}/domains?filter[role]=own`));
    expect(own).toEqual([
      expect.objectContaining({
        domain: expect.objectContaining({ host: 'fynix.digital' }),
        entity: expect.objectContaining({ role: 'own', color_index: 1 }),
      }),
    ]);
    const watched = dataOf<ProjectDomain[]>(await viewer.call('GET', `${P}/domains?filter[role]=watch`));
    expect(watched.map((row) => [row.domain.host, row.match_scope, row.path_prefix])).toEqual([
      ['medium.com', 'path_prefix', '/seo-weekly'],
      ['seoweekly.news', 'registrable', null],
    ]);
    expect(dataOf<unknown[]>(await viewer.call('GET', `${P}/domains`))).toHaveLength(8);
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
  const test = async (body: unknown): Promise<AliasTestResult> =>
    dataOf<AliasTestResult>(await mockBrowser('viewer').call('POST', `${P}/alias-test`, body));

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
    expect(text.slice(rival?.spans[0]?.start, rival?.spans[0]?.end)).toBe('rankforge');
    expect(own).toMatchObject({ confidence: 0.95, status: 'accepted', entity: { role: 'own', color_index: 1 } });
    expect(result.skipped_alias_ids).toEqual([]);
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

describe('the entity state', () => {
  it('keeps changes in its cookie, which another process reads back', async () => {
    const editor = mockBrowser('editor');
    const created = dataOf<Entity>(
      await editor.call('POST', `${W}/entities`, { entity_type: 'person', canonical_name: 'Ada' }),
    );
    const saved = editor.cookie(ENTITIES_COOKIE);
    if (saved === undefined) throw new Error('No entity cookie was set');
    const changes = readEntityChanges({ [ENTITIES_COOKIE]: saved });
    expect(changes.entities?.created?.map((entity) => entity.canonical_name)).toEqual(['Ada']);
    // Defaults are left out of the stored row
    expect(changes.entities?.created?.[0]).not.toHaveProperty('is_ambiguous');
    const fresh = mockBrowser('viewer', new Map([[ENTITIES_COOKIE, saved]]));
    expect((await fresh.call('GET', `${W}/entities/${created.entity_id}`)).status).toBe(200);
  });

  it('ignores a cookie it cannot read, and refuses to grow past what a cookie holds', async () => {
    const browser = mockBrowser('viewer', new Map([[ENTITIES_COOKIE, 'not-base64!']]));
    expect(dataOf<unknown[]>(await browser.call('GET', `${W}/entities?limit=200`))).toHaveLength(MOCK_ENTITIES.length);
    const huge = Array.from({ length: 80 }, (_, index) => ({
      entity_id: `0192d1a8-ffff-7000-8000-${String(index).padStart(12, '0')}`,
      entity_type: 'brand' as const,
      canonical_name: `Entity ${String(index)}`,
      created_at: '2026-10-01T00:00:00Z',
    }));
    expect(() => entitiesCookie({ entities: { created: huge } })).toThrow(/no longer fits/);
  });
});
