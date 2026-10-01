import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, savedEntities, type ProjectCaller } from './access';
import {
  bodyError,
  booleanError,
  booleanQuery,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  nullErrors,
  queryError,
  uuidError,
} from './rules';
import { emptyChange } from './workspaces';
import { matchAliases, TooManyMatchesError, type MatcherEntity } from '../alias-matcher';
import { stateTime } from '../entities-codec';
import {
  entityWorld,
  isActiveRole,
  withCreated,
  withEdited,
  withVersionsBumped,
  workspaceOfRow,
  type EntityWorld,
  type StoredRole,
} from '../entities-state';
import { entityDomainView, entityRefView, projectEntityView } from '../factories/entity';
import { invalid, mock, problem } from '../respond';
import type { AliasTestResult, Problem, ProjectDomain, ValidationItem } from '@/lib/api/types';

/**
 * A project's entities (19 section 3.4): roles given and changed, one primary own entity, at most 10
 * competitors tracked for SEO (doc 08 section 4), removal that keeps the row with `removed_at` for history;
 * the project's domains derived from its roles; and the alias test over the project's entities, which keeps
 * nothing. Every role change moves the project's `entity_config_version`.
 */

const ROLES = ['own', 'competitor', 'watch'] as const;
type Role = (typeof ROLES)[number];
/** Active SEO competitors a project may have (doc 08 section 4). */
export const MAX_SEO_COMPETITORS = 10;
/** The alias test's limit, as UTF-8 (`413 payload_too_large` beyond). */
const MAX_ALIAS_TEST_BYTES = 100 * 1024;
const ROLE_FIELDS = ['role', 'is_primary', 'track_seo', 'track_ai', 'color_index'] as const;
const ROLE_ORDER: Readonly<Record<Role, number>> = { own: 0, competitor: 1, watch: 2 };

/** The project's role rows, with the entity names to sort them by. */
const rolesOf = (world: EntityWorld, projectId: string): StoredRole[] =>
  world.roles.filter((role) => role.project_id === projectId);

const nameOf = (world: EntityWorld, entityId: string): string =>
  world.entities.find((entity) => entity.entity_id === entityId)?.canonical_name ?? '';

/** Own, competitors, watched; the primary first; then by name. */
const byRole =
  (world: EntityWorld) =>
  (a: StoredRole, b: StoredRole): number =>
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    Number(b.is_primary ?? false) - Number(a.is_primary ?? false) ||
    nameOf(world, a.entity_id).toLowerCase().localeCompare(nameOf(world, b.entity_id).toLowerCase());

const countsAsSeoCompetitor = (role: Pick<StoredRole, 'role' | 'track_seo'>): boolean =>
  role.role === 'competitor' && (role.track_seo ?? true);

/** The errors of a `color_index`: a whole number from 1 to 6, or null. */
function colorError(value: unknown): ValidationItem[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [bodyError('color_index', 'int_type', 'Input should be a valid integer')];
  }
  if (value < 1) return [bodyError('color_index', 'greater_than_equal', 'Input should be greater than or equal to 1')];
  if (value > 6) return [bodyError('color_index', 'less_than_equal', 'Input should be less than or equal to 6')];
  return [];
}

const roleFieldErrors = (body: Readonly<Record<string, unknown>>): ValidationItem[] => [
  ...enumError(body.role === null ? undefined : body.role, 'role', ROLES),
  ...booleanError(body.is_primary === null ? undefined : body.is_primary, 'is_primary'),
  ...booleanError(body.track_seo === null ? undefined : body.track_seo, 'track_seo'),
  ...booleanError(body.track_ai === null ? undefined : body.track_ai, 'track_ai'),
  ...colorError(body.color_index),
];

const primaryNeedsOwn = (): ValidationItem => bodyError('', 'value_error', '`is_primary` is only for the `own` role.');

/** `422 competitor_limit` when one more SEO competitor would pass the limit, or `null`. */
function competitorLimit(
  request: Request,
  world: EntityWorld,
  projectId: string,
  except: string,
): HttpResponse<Problem> | null {
  const used = rolesOf(world, projectId).filter(
    (role) => role.entity_id !== except && isActiveRole(role) && countsAsSeoCompetitor(role),
  ).length;
  return used >= MAX_SEO_COMPETITORS
    ? problem(request, 'competitor_limit', { limit: MAX_SEO_COMPETITORS, used })
    : null;
}

/** Another entity of the project is its primary own entity already. */
const primaryTaken = (world: EntityWorld, projectId: string, except: string): boolean =>
  rolesOf(world, projectId).some(
    (role) => role.entity_id !== except && isActiveRole(role) && role.role === 'own' && (role.is_primary ?? false),
  );

/** The project's role for an entity, removed ones included, or `undefined`. */
const roleIn = (caller: ProjectCaller, entityId: string | readonly string[] | undefined): StoredRole | undefined =>
  rolesOf(caller.world, caller.project.project_id).find((role) => role.entity_id === entityId);

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

export const projectEntityHandlers: HttpHandler[] = [
  mock('get', `${P}/entities`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['filter[role]', 'filter[include_removed]'],
    });
    if (caller instanceof Response) return caller;
    const role = caller.url.searchParams.get('filter[role]');
    const includeRemoved = booleanQuery(caller.url, 'filter[include_removed]', false);
    const errors = [
      ...(role === null || isOneOf(role, ROLES)
        ? []
        : [queryError('filter[role]', 'enum', `Allowed: ${ROLES.join(', ')}.`)]),
      ...(typeof includeRemoved === 'boolean' ? [] : [includeRemoved]),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const rows = rolesOf(caller.world, caller.project.project_id)
      .filter((row) => (role === null || row.role === role) && (includeRemoved === true || isActiveRole(row)))
      .sort(byRole(caller.world));
    return HttpResponse.json({ data: rows.map((row) => projectEntityView(caller.world, row)) });
  }),

  mock('post', `${P}/entities`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'entities:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...extraMembers(body, ['entity_id', ...ROLE_FIELDS]),
      ...['entity_id', 'role']
        .filter((name) => body[name] === undefined)
        .map((name) => bodyError(name, 'missing', 'Field required')),
      ...nullErrors(body, ['entity_id', 'role', 'is_primary', 'track_seo', 'track_ai']),
      ...uuidError(body.entity_id === null ? undefined : body.entity_id, 'entity_id'),
      ...roleFieldErrors(body),
    ];
    if (errors.length > 0) return invalid(request, errors);
    if (typeof body.entity_id !== 'string' || !isOneOf(body.role, ROLES)) {
      throw new Error('The entity id and role were checked above');
    }
    const isPrimary = body.is_primary === true;
    if (isPrimary && body.role !== 'own') return invalid(request, [primaryNeedsOwn()]);
    const entityId = body.entity_id;
    const entity = caller.world.entities.find(
      (candidate) =>
        candidate.entity_id === entityId && workspaceOfRow(candidate) === caller.access.workspace.workspace_id,
    );
    if (!entity)
      return invalid(request, [bodyError('entity_id', 'entity_unknown', 'No entity of this workspace has this id.')]);
    const existing = roleIn(caller, entityId);
    if (existing && isActiveRole(existing)) {
      return problem(request, 'duplicate', { detail: 'The project already gives this entity a role.' });
    }
    const projectId = caller.project.project_id;
    if (isPrimary && primaryTaken(caller.world, projectId, entityId)) return problem(request, 'primary_own_exists');
    const trackSeo = body.track_seo !== false;
    if (countsAsSeoCompetitor({ role: body.role, track_seo: trackSeo })) {
      const full = competitorLimit(request, caller.world, projectId, entityId);
      if (full) return full;
    }
    const values = {
      role: body.role,
      is_primary: isPrimary,
      track_seo: trackSeo,
      track_ai: body.track_ai !== false,
      color_index: typeof body.color_index === 'number' ? body.color_index : null,
    };
    // Giving a removed entity a role again brings back its one row per project and entity
    const next = withVersionsBumped(
      existing
        ? withEdited(caller.entityChanges, 'roles', existing, { ...values, removed_at: null })
        : withCreated(caller.entityChanges, 'roles', {
            project_id: projectId,
            entity_id: entityId,
            role: values.role,
            ...(values.is_primary ? { is_primary: true } : {}),
            ...(values.track_seo ? {} : { track_seo: false }),
            ...(values.track_ai ? {} : { track_ai: false }),
            ...(values.color_index === null ? {} : { color_index: values.color_index }),
            added_at: stateTime(),
          }),
      [projectId],
    );
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    const saved = world.roles.find((role) => role.project_id === projectId && role.entity_id === entityId);
    if (!saved) throw new Error('The new role is missing');
    return HttpResponse.json(
      { data: projectEntityView(world, saved) },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('patch', `${P}/entities/{entity_id}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'entities:write',
    });
    if (caller instanceof Response) return caller;
    const current = roleIn(caller, params.entity_id);
    if (!current || !isActiveRole(current)) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const errors = [
      ...extraMembers(body, ROLE_FIELDS),
      ...nullErrors(body, ['role', 'is_primary', 'track_seo', 'track_ai']),
      ...roleFieldErrors(body),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const role: Role = isOneOf(body.role, ROLES) ? body.role : current.role;
    const isPrimary = typeof body.is_primary === 'boolean' ? body.is_primary : (current.is_primary ?? false);
    const trackSeo = typeof body.track_seo === 'boolean' ? body.track_seo : (current.track_seo ?? true);
    if (body.is_primary === true && role !== 'own') return invalid(request, [primaryNeedsOwn()]);
    // A primary own entity that changes role stops being primary
    const primary = isPrimary && role === 'own';
    const projectId = caller.project.project_id;
    const entityId = current.entity_id;
    if (primary && !(current.is_primary ?? false) && primaryTaken(caller.world, projectId, entityId)) {
      return problem(request, 'primary_own_exists');
    }
    if (countsAsSeoCompetitor({ role, track_seo: trackSeo }) && !countsAsSeoCompetitor(current)) {
      const full = competitorLimit(request, caller.world, projectId, entityId);
      if (full) return full;
    }
    const next = withVersionsBumped(
      withEdited(caller.entityChanges, 'roles', current, {
        role,
        is_primary: primary,
        track_seo: trackSeo,
        track_ai: typeof body.track_ai === 'boolean' ? body.track_ai : undefined,
        color_index:
          'color_index' in body ? (typeof body.color_index === 'number' ? body.color_index : null) : undefined,
      }),
      [projectId],
    );
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    const saved = world.roles.find((row) => row.project_id === projectId && row.entity_id === entityId);
    if (!saved) throw new Error('The changed role is missing');
    return HttpResponse.json({ data: projectEntityView(world, saved) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('delete', `${P}/entities/{entity_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'entities:write',
    });
    if (caller instanceof Response) return caller;
    const current = roleIn(caller, params.entity_id);
    if (!current) return problem(request, 'not_found');
    // Removing twice answers the removed row again
    if (!isActiveRole(current)) return HttpResponse.json({ data: projectEntityView(caller.world, current) });
    if (current.role === 'own' && (current.is_primary ?? false)) return problem(request, 'cannot_remove_primary_own');
    const projectId = caller.project.project_id;
    const next = withVersionsBumped(withEdited(caller.entityChanges, 'roles', current, { removed_at: stateTime() }), [
      projectId,
    ]);
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    const saved = world.roles.find((row) => row.project_id === projectId && row.entity_id === current.entity_id);
    if (!saved) throw new Error('The removed role is missing');
    return HttpResponse.json({ data: projectEntityView(world, saved) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('get', `${P}/domains`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['filter[role]'],
    });
    if (caller instanceof Response) return caller;
    const role = caller.url.searchParams.get('filter[role]');
    if (role !== null && !isOneOf(role, ROLES)) {
      return invalid(request, [queryError('filter[role]', 'enum', `Allowed: ${ROLES.join(', ')}.`)]);
    }
    const { world } = caller;
    const data = rolesOf(world, caller.project.project_id)
      .filter((row) => isActiveRole(row) && (role === null || row.role === role))
      .sort(byRole(world))
      .flatMap((row): ProjectDomain[] => {
        const entity = world.entities.find((candidate) => candidate.entity_id === row.entity_id);
        if (!entity) return [];
        return world.domains
          .filter((domain) => domain.entity_id === row.entity_id)
          .map(entityDomainView)
          .sort((a, b) => a.domain.host.localeCompare(b.domain.host))
          .map((domain) => ({
            entity: entityRefView(entity, row),
            domain: domain.domain,
            match_scope: domain.match_scope,
            path_prefix: domain.path_prefix,
          }));
      });
    return HttpResponse.json({ data });
  }),

  mock('post', `${P}/alias-test`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const typeErrors = (['text', 'markdown'] as const).flatMap((name) =>
      body[name] === undefined || body[name] === null || typeof body[name] === 'string'
        ? []
        : [bodyError(name, 'string_type', 'Input should be a valid string')],
    );
    const errors = [...extraMembers(body, ['text', 'markdown']), ...typeErrors];
    if (errors.length > 0) return invalid(request, errors);
    const given = [body.text, body.markdown].filter((value): value is string => typeof value === 'string');
    const [text] = given;
    if (given.length !== 1 || text === undefined) {
      return invalid(request, [bodyError('', 'one_of', 'Give exactly one of `text` and `markdown`.')]);
    }
    if (new TextEncoder().encode(text).length > MAX_ALIAS_TEST_BYTES) {
      return problem(request, 'payload_too_large', { detail: 'The alias test takes at most 100 KB.' });
    }
    const { world } = caller;
    const roles = rolesOf(world, caller.project.project_id).filter(isActiveRole);
    // Markdown is matched as its source text until stage 3 parsing arrives
    const matcherEntities = roles.flatMap((role): MatcherEntity[] => {
      const entity = world.entities.find((candidate) => candidate.entity_id === role.entity_id);
      if (!entity) return [];
      return [
        {
          entity,
          aliases: world.aliases.filter((alias) => alias.entity_id === entity.entity_id),
          domains: world.domains.filter((domain) => domain.entity_id === entity.entity_id),
        },
      ];
    });
    let result: ReturnType<typeof matchAliases>;
    try {
      result = matchAliases(text, matcherEntities);
    } catch (error) {
      if (error instanceof TooManyMatchesError) return problem(request, 'too_many_matches', { detail: error.message });
      throw error;
    }
    const data: AliasTestResult = {
      mentions: result.mentions.flatMap((mention) => {
        const entity = world.entities.find((candidate) => candidate.entity_id === mention.entity_id);
        if (!entity) return [];
        const role = roles.find((candidate) => candidate.entity_id === mention.entity_id);
        return [
          {
            entity: entityRefView(entity, role),
            spans: mention.spans,
            confidence: mention.confidence,
            status: mention.status,
          },
        ];
      }),
      negatives_applied: result.negatives_applied,
      skipped_alias_ids: result.skipped_alias_ids,
    };
    return HttpResponse.json({ data });
  }),
];
