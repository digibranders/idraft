import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECT_LIMIT } from './projects';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { SESSION_COOKIE } from '../session';
import { MOCK_PENDING_INVITATIONS, WORKSPACE_COOKIE } from '../workspace-state';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { ENTITY_DETAIL, PROJECT, PROJECT_ENTITY } from '@/test/api-shapes';
import { dataOf, fieldCodes as codesOf, mockBrowser } from '@/test/mock-api';

interface Answer {
  status: number;
  body: Record<string, unknown>;
  code: string | undefined;
  /** The workspace cookie the answer set, as `name=value`, if it set one. */
  saved: string | undefined;
}

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
type Role = 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer' | 'billing';

/** The Cookie header of `role`'s session, fresh or not, with the workspace state `saved` when given. */
function cookieOf(role: Role, { fresh = true, saved }: { fresh?: boolean; saved?: string | undefined } = {}): string {
  const until = fresh ? Date.now() + 10 * 60 * 1000 : 0;
  const session = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(until)}`;
  return saved === undefined ? session : `${session}; ${saved}`;
}

async function call(method: string, path: string, cookie: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`${TEST_API_ORIGIN}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  const cookie_ = response.headers.get('set-cookie')?.split(';')[0];
  return {
    status: response.status,
    body: parsed,
    code: typeof parsed.code === 'string' ? parsed.code : undefined,
    saved: cookie_?.startsWith(`${WORKSPACE_COOKIE}=`) === true ? cookie_ : undefined,
  };
}

const fieldCodes = (answer: Answer): string[] =>
  ((answer.body.errors ?? []) as { path: string; code: string }[]).map((error) => `${error.path}:${error.code}`);

describe('projects', () => {
  it('creates a project that the list then shows, as the server would see it from the cookie', async () => {
    const created = await call('POST', `${W}/projects`, cookieOf('editor'), {
      name: 'New Client',
      slug: 'new-client',
      timezone: 'Europe/Paris',
    });
    expect(created).toMatchObject({ status: 201, body: { data: { slug: 'new-client', timezone: 'Europe/Paris' } } });
    const list = await call('GET', `${W}/projects`, cookieOf('editor', { saved: created.saved }));
    expect((list.body.data as { slug: string }[]).map((project) => project.slug)).toContain('new-client');
  });

  it('refuses what the API refuses when creating', async () => {
    expect((await call('POST', `${W}/projects`, cookieOf('viewer'), { name: 'X', slug: 'xyz' })).code).toBe(
      'forbidden',
    );
    // A member limited to some projects cannot create one
    expect((await call('POST', `${W}/projects`, cookieOf('analyst'), { name: 'X', slug: 'xyz' })).code).toBe(
      'forbidden',
    );
    expect((await call('POST', `${W}/projects`, cookieOf('editor'), { name: 'X', slug: 'fynix' })).code).toBe(
      'duplicate',
    );
    const invalid = await call('POST', `${W}/projects`, cookieOf('editor'), {
      name: '',
      slug: 'settings',
      timezone: 'Mars/Olympus',
      color: 'red',
    });
    expect(fieldCodes(invalid).sort()).toEqual(
      ['color:extra_forbidden', 'name:string_too_short', 'slug:slug_reserved', 'timezone:timezone_unknown'].sort(),
    );
  });

  it('says the limit, the use and the request when the plan is full', async () => {
    let saved: string | undefined;
    for (let index = MOCK_PROJECTS.length; index < MOCK_PROJECT_LIMIT; index += 1) {
      saved = (
        await call('POST', `${W}/projects`, cookieOf('editor', { saved }), {
          name: `P${String(index)}`,
          slug: `p-${String(index)}`,
        })
      ).saved;
    }
    const full = await call('POST', `${W}/projects`, cookieOf('editor', { saved }), {
      name: 'One more',
      slug: 'one-more',
    });
    expect(full).toMatchObject({ status: 422, body: { code: 'quota_exceeded', limit: 10, used: 10, requested: 1 } });
  });

  it('changes a project, and warns when the time zone changes', async () => {
    const [fynix] = MOCK_PROJECTS;
    if (!fynix) throw new Error('no fixture project');
    const path = `${W}/projects/${fynix.project_id}`;
    const renamed = await call('PATCH', path, cookieOf('editor'), { name: 'Fynix Digital' });
    expect(renamed.body).toMatchObject({ data: { name: 'Fynix Digital' }, meta: { warnings: [] } });
    const moved = await call('PATCH', path, cookieOf('editor', { saved: renamed.saved }), { timezone: 'UTC' });
    expect(moved.body).toMatchObject({
      data: { name: 'Fynix Digital', timezone: 'UTC' },
      meta: { warnings: ['timezone_change_applies_forward'] },
    });
    expect((await call('PATCH', path, cookieOf('editor'), { slug: 'cleanstart' })).code).toBe('duplicate');
    expect(fieldCodes(await call('PATCH', path, cookieOf('editor'), { name: null }))).toEqual([
      'name:null_not_allowed',
    ]);
    expect((await call('PATCH', path, cookieOf('viewer'), { name: 'X' })).code).toBe('forbidden');
  });

  it('leaves an archived project out of the default list', async () => {
    const [fynix] = MOCK_PROJECTS;
    if (!fynix) throw new Error('no fixture project');
    const archived = await call('PATCH', `${W}/projects/${fynix.project_id}`, cookieOf('editor'), {
      status: 'archived',
    });
    const list = await call('GET', `${W}/projects`, cookieOf('editor', { saved: archived.saved }));
    expect((list.body.data as { slug: string }[]).map((project) => project.slug)).not.toContain('fynix');
  });
});

describe('projects, with a domain, a location and an own brand', () => {
  it('shows the fixture project with its primary domain and default location', async () => {
    const [fynix] = MOCK_PROJECTS;
    if (!fynix) throw new Error('no fixture project');
    const project = dataOf(await mockBrowser('viewer').call('GET', `${W}/projects/${fynix.project_id}`), PROJECT);
    expect(project).toMatchObject({
      primary_domain: { host: 'fynix.digital', registrable_domain: 'fynix.digital' },
      default_location_id: 2276,
      default_location: { location_id: 2276, name: 'Germany', country_iso: 'DE', location_type: 'Country' },
    });
  });

  it('creates a project with its own entity, attached as the primary own entity in the same request', async () => {
    const editor = mockBrowser('editor');
    const created = await editor.call('POST', `${W}/projects`, {
      name: 'Acme',
      slug: 'acme',
      primary_domain: 'https://www.Acme.io/pricing',
      default_location_id: 1006886,
      own_entity: {
        canonical_name: 'Acme',
        // Registrable rules: `www.acme.io` is `acme.io`, given twice
        domains: ['acme.io', 'https://acme.co.uk/', 'www.acme.io'],
        aliases: ['Acme', 'acme', ' Acme HQ '],
      },
    });
    expect(created.status).toBe(201);
    const project = dataOf(created, PROJECT);
    expect(project).toMatchObject({
      primary_domain: { host: 'acme.io' },
      default_location_id: 1006886,
      default_location: { name: 'London,England,United Kingdom', location_type: 'City' },
      entity_config_version: 1,
    });
    const roles = dataOf(
      await editor.call('GET', `${W}/projects/${project.project_id}/entities`),
      z.array(PROJECT_ENTITY),
    );
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      role: 'own',
      is_primary: true,
      color_index: 1,
      alias_count: 2,
      entity: { canonical_name: 'Acme', role: 'own' },
    });
    expect(roles[0]?.domains.map((domain) => [domain.domain.host, domain.match_scope])).toEqual([
      ['acme.co.uk', 'registrable'],
      ['acme.io', 'registrable'],
    ]);
    const detail = dataOf(await editor.call('GET', `${W}/entities/${roles[0]?.entity.entity_id ?? ''}`), ENTITY_DETAIL);
    expect(
      detail.aliases.map((alias) => [alias.alias, alias.match_mode, alias.case_sensitive, alias.language_code]),
    ).toEqual([
      ['Acme', 'word_boundary', false, null],
      ['Acme HQ', 'word_boundary', false, null],
    ]);
  });

  it('refuses a domain, a location and an own entity the API would refuse', async () => {
    const editor = mockBrowser('editor');
    const invalid = await editor.call('POST', `${W}/projects`, {
      name: 'Acme',
      slug: 'acme',
      primary_domain: 'not a domain',
      default_location_id: 999,
      own_entity: { canonical_name: 'Acme', domains: ['co.uk', 'ftp://acme.io'], color: 'red' },
    });
    expect(codesOf(invalid).sort()).toEqual(
      [
        'default_location_id:location_unknown',
        'own_entity.color:extra_forbidden',
        'own_entity.domains.0:domain_is_public_suffix',
        'own_entity.domains.1:invalid_domain',
        'primary_domain:invalid_domain',
      ].sort(),
    );
    const taken = await editor.call('POST', `${W}/projects`, {
      name: 'Acme',
      slug: 'acme',
      own_entity: { canonical_name: 'RANKFORGE' },
    });
    // A brand name the workspace has is a field error, and no project is created (backend 0c833e1)
    expect(codesOf(taken)).toEqual(['own_entity.canonical_name:entity_exists']);
    const listed = await editor.call('GET', `${W}/projects`);
    expect(JSON.stringify(listed.body)).not.toContain('"slug":"acme"');
    // The own entity is a brand: a product's name is free for it
    const product = await editor.call('POST', `${W}/projects`, {
      name: 'Audit',
      slug: 'audit',
      own_entity: { canonical_name: 'Fynix Audit' },
    });
    expect(product.status).toBe(201);
  });

  it('changes and clears the primary domain and the default location', async () => {
    const [fynix] = MOCK_PROJECTS;
    if (!fynix) throw new Error('no fixture project');
    const editor = mockBrowser('editor');
    const path = `${W}/projects/${fynix.project_id}`;
    const moved = await editor.call('PATCH', path, { primary_domain: 'Fynix.io', default_location_id: 2840 });
    expect(dataOf(moved, PROJECT)).toMatchObject({
      primary_domain: { host: 'fynix.io' },
      default_location_id: 2840,
      default_location: { name: 'United States' },
    });
    expect(dataOf(await editor.call('GET', path), PROJECT)).toMatchObject({ primary_domain: { host: 'fynix.io' } });
    const cleared = await editor.call('PATCH', path, { primary_domain: null, default_location_id: null });
    expect(dataOf(cleared, PROJECT)).toMatchObject({
      primary_domain: null,
      default_location_id: null,
      default_location: null,
    });
    expect(codesOf(await editor.call('PATCH', path, { default_location_id: 'Germany' }))).toEqual([
      'default_location_id:int_type',
    ]);
  });
});

describe('the workspace', () => {
  it('is renamed and moved by an admin, and /me follows', async () => {
    const changed = await call('PATCH', W, cookieOf('admin'), { name: 'Digibranders Agency', slug: 'dgb' });
    expect(changed.body).toMatchObject({ data: { name: 'Digibranders Agency', slug: 'dgb' } });
    const me = await call('GET', '/api/v1/me', cookieOf('admin', { saved: changed.saved }));
    expect(me.body).toMatchObject({ data: { memberships: [{ workspace: { slug: 'dgb' } }] } });
    expect((await call('PATCH', W, cookieOf('editor'), { name: 'X' })).code).toBe('forbidden');
    expect(fieldCodes(await call('PATCH', W, cookieOf('admin'), { slug: 'login' }))).toEqual(['slug:slug_reserved']);
  });

  it('is created by an operator only, who becomes its owner', async () => {
    expect((await call('POST', '/api/v1/workspaces', cookieOf('admin'), { name: 'X', slug: 'xyz' })).code).toBe(
      'forbidden',
    );
    const created = await call('POST', '/api/v1/workspaces', cookieOf('owner'), { name: 'Second', slug: 'second' });
    expect(created).toMatchObject({ status: 201, body: { data: { slug: 'second', timezone: 'UTC' } } });
    const me = await call('GET', '/api/v1/me', cookieOf('owner', { saved: created.saved }));
    const memberships = (me.body.data as { memberships: { role: string; workspace: { slug: string } }[] }).memberships;
    expect(memberships.map((membership) => [membership.workspace.slug, membership.role])).toEqual([
      ['digibranders', 'owner'],
      ['second', 'owner'],
    ]);
    expect(
      (await call('POST', '/api/v1/workspaces', cookieOf('owner'), { name: 'X', slug: 'digibranders' })).code,
    ).toBe('duplicate');
  });
});

describe('members', () => {
  const member = (role: Role): string => `${W}/members/${mockUser(role).user_id}`;

  it('lists everyone by name, with two-factor and activity for managers only', async () => {
    const asAdmin = (await call('GET', `${W}/members`, cookieOf('admin'))).body.data as {
      user: { name: string };
      two_factor_enabled: boolean | null;
    }[];
    expect(asAdmin.map((row) => row.user.name)).toEqual([...asAdmin.map((row) => row.user.name)].sort());
    expect(asAdmin.every((row) => row.two_factor_enabled !== null)).toBe(true);
    const asViewer = (await call('GET', `${W}/members`, cookieOf('viewer'))).body.data as {
      user: { user_id: string };
      two_factor_enabled: boolean | null;
    }[];
    expect(asViewer.filter((row) => row.two_factor_enabled !== null).map((row) => row.user.user_id)).toEqual([
      mockUser('viewer').user_id,
    ]);
  });

  it('pages by offset like the API, and refuses a limit it would refuse', async () => {
    const all = (await call('GET', `${W}/members`, cookieOf('admin'))).body;
    const total = (all.data as unknown[]).length;
    const page = (await call('GET', `${W}/members?offset=2&limit=3`, cookieOf('admin'))).body;
    expect(page.page).toEqual({ offset: 2, limit: 3, total });
    expect(page.data).toEqual((all.data as unknown[]).slice(2, 5));
    expect((await call('GET', `${W}/members?limit=500`, cookieOf('admin'))).code).toBe('validation_failed');
    expect((await call('GET', `${W}/invitations?offset=-1`, cookieOf('admin'))).code).toBe('validation_failed');
  });

  it('changes a role and a project list from a fresh session', async () => {
    const [fynix] = MOCK_PROJECTS;
    if (!fynix) throw new Error('no fixture project');
    expect((await call('PATCH', member('viewer'), cookieOf('admin', { fresh: false }), { role: 'editor' })).code).toBe(
      'fresh_session_required',
    );
    const changed = await call('PATCH', member('viewer'), cookieOf('admin'), {
      role: 'analyst',
      project_ids: [fynix.project_id],
    });
    expect(changed.body).toMatchObject({ data: { role: 'analyst', project_ids: [fynix.project_id] } });
    const me = await call('GET', '/api/v1/me', cookieOf('viewer', { saved: changed.saved }));
    expect(me.body).toMatchObject({ data: { memberships: [{ role: 'analyst', project_ids: [fynix.project_id] }] } });
  });

  it('keeps the owner rules: only an owner touches an owner, and the last one stays', async () => {
    expect((await call('PATCH', member('editor'), cookieOf('admin'), { role: 'owner' })).code).toBe('forbidden');
    expect((await call('PATCH', member('owner'), cookieOf('admin'), { role: 'admin' })).code).toBe('forbidden');
    expect((await call('PATCH', member('owner'), cookieOf('owner'), { role: 'admin' })).code).toBe('last_owner');
    expect((await call('DELETE', member('owner'), cookieOf('owner'))).code).toBe('last_owner');
    expect(
      fieldCodes(
        await call('PATCH', member('admin'), cookieOf('owner'), { project_ids: [MOCK_PROJECTS[0]?.project_id] }),
      ),
    ).toEqual(['project_ids:scope_not_allowed']);
    expect(
      fieldCodes(
        await call('PATCH', member('viewer'), cookieOf('owner'), {
          project_ids: ['0192d1a8-0000-7000-8000-000000000000'],
        }),
      ),
    ).toEqual(['project_ids:project_unknown']);
  });

  it('removes a member, who then has no workspace', async () => {
    expect((await call('DELETE', member('viewer'), cookieOf('editor'))).code).toBe('forbidden');
    const removed = await call('DELETE', member('viewer'), cookieOf('admin'));
    expect(removed.status).toBe(204);
    const me = await call('GET', '/api/v1/me', cookieOf('viewer', { saved: removed.saved }));
    expect(me.body).toMatchObject({ data: { memberships: [] } });
  });
});

describe('invitations', () => {
  it('lists the pending invitations for managers only', async () => {
    const list = await call('GET', `${W}/invitations`, cookieOf('admin'));
    expect((list.body.data as unknown[]).length).toBe(MOCK_PENDING_INVITATIONS.length);
    expect((await call('GET', `${W}/invitations`, cookieOf('editor'))).code).toBe('forbidden');
  });

  it('invites, refuses a second invitation or a member, and asks for a fresh session for an admin', async () => {
    const sent = await call('POST', `${W}/invitations`, cookieOf('admin'), {
      email: 'New@Client.test',
      role: 'viewer',
    });
    expect(sent).toMatchObject({ status: 201, body: { data: { email: 'New@Client.test', status: 'pending' } } });
    const again = await call('POST', `${W}/invitations`, cookieOf('admin', { saved: sent.saved }), {
      email: 'new@client.test',
      role: 'viewer',
    });
    expect(again.code).toBe('duplicate');
    expect(
      (await call('POST', `${W}/invitations`, cookieOf('admin'), { email: mockUser('editor').email, role: 'viewer' }))
        .code,
    ).toBe('duplicate');
    expect(
      (
        await call('POST', `${W}/invitations`, cookieOf('admin', { fresh: false }), {
          email: 'a@b.test',
          role: 'admin',
        })
      ).code,
    ).toBe('fresh_session_required');
    expect((await call('POST', `${W}/invitations`, cookieOf('admin'), { email: 'a@b.test', role: 'owner' })).code).toBe(
      'forbidden',
    );
  });

  it('withdraws what a member sent when they stop managing members', async () => {
    const [, second] = MOCK_PENDING_INVITATIONS;
    if (!second) throw new Error('no fixture invitation');
    // The admin sent the second fixture invitation; as an editor they no longer can
    const demoted = await call('PATCH', `${W}/members/${mockUser('admin').user_id}`, cookieOf('owner'), {
      role: 'editor',
    });
    const list = await call('GET', `${W}/invitations`, cookieOf('owner', { saved: demoted.saved }));
    expect(
      (list.body.data as { invitation_id: string; status: string }[]).find(
        (row) => row.invitation_id === second.invitation_id,
      ),
    ).toMatchObject({ status: 'cancelled' });
  });

  it('withdraws a pending invitation once; again is not an error', async () => {
    const [first] = MOCK_PENDING_INVITATIONS;
    if (!first) throw new Error('no fixture invitation');
    const path = `${W}/invitations/${first.invitation_id}`;
    const withdrawn = await call('DELETE', path, cookieOf('admin'));
    expect(withdrawn.status).toBe(204);
    expect((await call('DELETE', path, cookieOf('admin', { saved: withdrawn.saved }))).status).toBe(204);
    const list = await call('GET', `${W}/invitations`, cookieOf('admin', { saved: withdrawn.saved }));
    expect(
      (list.body.data as { invitation_id: string; status: string }[]).find(
        (row) => row.invitation_id === first.invitation_id,
      ),
    ).toMatchObject({
      status: 'cancelled',
    });
  });
});
