import { HttpResponse, type HttpHandler } from 'msw';

import { savedEntities, workspaceCaller, type WorkspaceCaller } from './access';
import {
  aliasInput,
  aliasMemberErrors,
  aliasShape,
  at,
  bodyError,
  booleanError,
  cursorPage,
  domainInput,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  MATCH_MODES,
  notAnObject,
  nullErrors,
  pageRequest,
  queryError,
  sameAlias,
  textError,
  uuidError,
  type AliasValues,
  type DomainValues,
} from './rules';
import { emptyChange } from './workspaces';
import { stateTime } from '../entities-codec';
import {
  entityWorld,
  idMinter,
  isActiveRole,
  projectsNaming,
  projectsUsing,
  withCreated,
  withDeleted,
  withEdited,
  withVersionsBumped,
  workspaceOfRow,
  type EntityChanges,
  type EntityWorld,
  type StoredAlias,
  type StoredDomain,
  type StoredEntity,
} from '../entities-state';
import { registrableDomain } from '../factories/domain';
import { aliasesOf, aliasView, entityDetailView, entityDomainView, entityView } from '../factories/entity';
import { MOCK_WORKSPACE } from '../fixtures';
import { invalid, invalidField, mock, noContent, problem } from '../respond';
import type { Problem, ValidationItem } from '@/lib/api/types';

/**
 * Entities, their aliases and their domains (19 section 3.4), with the backend's rules as built
 * (`api/entities/service.py` and `routes.py`, migration 0010):
 *
 * - reading needs `data:read`; a member limited to some projects sees only the entities those projects name
 *   (a removed role included) and gets `404` for the others; changing a workspace entity needs
 *   `entities:write` and a membership that is not limited to some projects (`403` otherwise);
 * - a name is unique per entity type in the workspace, ignoring case; no parent that makes a cycle
 *   (`cycle_detected`), and an unknown parent is the field code `parent_unknown`;
 * - an entity is deleted only when no project ever named it and no product names it as its brand;
 * - aliases are unique per text, match mode and negativity (case folded for word and substring aliases that
 *   ignore case), and a pattern must compile;
 * - a registrable rule is stored against the registrable domain; host and path rules keep the host as given;
 * - every change moves the `entity_config_version` of every project that ever named the entity.
 */

const ENTITY_TYPES = ['brand', 'product', 'organization', 'person', 'other'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];
const ROLES = ['own', 'competitor', 'watch'] as const;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const MAX_HINT = 100;
const MAX_HINTS = 50;
const MAX_ALIASES = 200;
const MAX_DOMAINS = 50;
const MAX_QUERY_TEXT = 200;
const ENTITY_FIELDS = [
  'entity_type',
  'canonical_name',
  'parent_entity_id',
  'description',
  'is_ambiguous',
  'disambiguation_hints',
] as const;
/** Writes change a workspace entity, which every project shares. */
const WRITE = { permission: 'entities:write', everyProject: true } as const;

/** Whether a member with this scope may see the entity: any, or one their projects name. */
function canSee(caller: WorkspaceCaller, entityId: string): boolean {
  const scope = caller.access.membership.project_ids;
  return (
    scope === null || caller.world.roles.some((role) => role.entity_id === entityId && scope.includes(role.project_id))
  );
}

/** The entity with `entityId` in the caller's workspace that they may see, or `undefined`. */
function entityIn(caller: WorkspaceCaller, entityId: string | readonly string[] | undefined): StoredEntity | undefined {
  return caller.world.entities.find(
    (entity) =>
      entity.entity_id === entityId &&
      workspaceOfRow(entity) === caller.access.workspace.workspace_id &&
      canSee(caller, entity.entity_id),
  );
}

/** Another entity of the workspace has this name and type, ignoring the case of the name. */
const nameTaken = (caller: WorkspaceCaller, name: string, type: EntityType, except?: string): boolean =>
  caller.world.entities.some(
    (entity) =>
      entity.entity_id !== except &&
      workspaceOfRow(entity) === caller.access.workspace.workspace_id &&
      entity.entity_type === type &&
      entity.canonical_name.toLowerCase() === name.toLowerCase(),
  );

const NAME_TAKEN = 'The workspace has an entity of this type with this name.';

/** `changes` with the `entity_config_version` of every project that named the entity moved (backend D7). */
const bumpedFor = (changes: EntityChanges, world: EntityWorld, entityId: string): EntityChanges =>
  withVersionsBumped(changes, projectsNaming(world, entityId));

const duplicate = (request: Request, detail: string): HttpResponse<Problem> =>
  problem(request, 'duplicate', { detail });

/** The errors of `disambiguation_hints`, at `path`. */
function hintErrors(value: unknown, path: string): ValidationItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [bodyError(path, 'list_type', 'Input should be a valid list')];
  if (value.length > MAX_HINTS) return [bodyError(path, 'too_long', `At most ${String(MAX_HINTS)} hints.`)];
  return value.flatMap((hint: unknown, index) =>
    textError(typeof hint === 'string' ? hint.trim() : hint, at(path, index), { max: MAX_HINT }),
  );
}

/** The errors of the entity members present in `body`; nulls on members that refuse them are reported apart. */
function entityFieldErrors(body: Readonly<Record<string, unknown>>): ValidationItem[] {
  const name = body.canonical_name;
  return [
    ...(body.entity_type === null ? [] : enumError(body.entity_type, 'entity_type', ENTITY_TYPES)),
    ...(name === null
      ? []
      : textError(typeof name === 'string' ? name.trim() : name, 'canonical_name', { max: MAX_NAME })),
    ...uuidError(body.parent_entity_id, 'parent_entity_id', { nullable: true }),
    ...(body.description === null ? [] : textError(body.description, 'description', { min: 0, max: MAX_DESCRIPTION })),
    ...(body.is_ambiguous === null ? [] : booleanError(body.is_ambiguous, 'is_ambiguous')),
    ...(body.disambiguation_hints === null ? [] : hintErrors(body.disambiguation_hints, 'disambiguation_hints')),
  ];
}

/** The parent's errors: an entity of the workspace (`parent_unknown`), and not the entity or below it. */
function parentProblem(
  request: Request,
  caller: WorkspaceCaller,
  parentId: string,
  entityId: string | null,
): HttpResponse<Problem> | null {
  const exists = caller.world.entities.some(
    (entity) => entity.entity_id === parentId && workspaceOfRow(entity) === caller.access.workspace.workspace_id,
  );
  if (!exists) return invalidField(request, 'parent_entity_id', 'parent_unknown', 'No such entity.');
  if (entityId === null) return null;
  // Walking up from the new parent must not reach the entity
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current !== null && !seen.has(current)) {
    if (current === entityId) {
      return problem(request, 'cycle_detected', { detail: 'The parent is this entity or one of its products.' });
    }
    seen.add(current);
    const id: string = current;
    current = caller.world.entities.find((entity) => entity.entity_id === id)?.parent_entity_id ?? null;
  }
  return null;
}

/** The aliases of a list, or their errors; each at `prefix.N`. */
function aliasList(value: unknown, path: string, max: number): AliasValues[] | ValidationItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [bodyError(path, 'list_type', 'Input should be a valid list')];
  if (value.length > max) return [bodyError(path, 'too_long', `At most ${String(max)} items.`)];
  const parsed = value.map((item: unknown, index) => aliasInput(item, at(path, index)));
  const errors = parsed.flatMap((item) => (Array.isArray(item) ? item : []));
  return errors.length > 0 ? errors : parsed.filter((item): item is AliasValues => !Array.isArray(item));
}

/** The domains of a list, or their errors. */
function domainList(value: unknown, path: string): DomainValues[] | ValidationItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [bodyError(path, 'list_type', 'Input should be a valid list')];
  if (value.length > MAX_DOMAINS) return [bodyError(path, 'too_long', `At most ${String(MAX_DOMAINS)} items.`)];
  const parsed = value.map((item: unknown, index) => domainInput(item, at(path, index)));
  const errors = parsed.flatMap((item) => (Array.isArray(item) ? item : []));
  return errors.length > 0 ? errors : parsed.filter((item): item is DomainValues => !Array.isArray(item));
}

const isAliasList = (value: AliasValues[] | ValidationItem[]): value is AliasValues[] =>
  value.every((item) => 'match_mode' in item);
const isDomainList = (value: DomainValues[] | ValidationItem[]): value is DomainValues[] =>
  value.every((item) => 'match_scope' in item);

/** `{ items }` of 1 to 200 aliases, or its errors. */
function aliasBatch(body: Readonly<Record<string, unknown>>): AliasValues[] | ValidationItem[] {
  const errors = extraMembers(body, ['items']);
  const items = body.items;
  if (!Array.isArray(items)) return [...errors, bodyError('items', 'list_type', 'Input should be a valid list')];
  if (items.length === 0) return [...errors, bodyError('items', 'too_short', 'At least 1 item.')];
  const parsed = aliasList(items, 'items', MAX_ALIASES);
  return errors.length > 0 ? [...errors, ...(isAliasList(parsed) ? [] : parsed)] : parsed;
}

/** Whether any alias of `incoming` repeats an existing one or one before it. */
function repeatsAlias(existing: readonly AliasValues[], incoming: readonly AliasValues[]): boolean {
  const seen = [...existing];
  for (const alias of incoming) {
    if (seen.some((other) => sameAlias(other, alias))) return true;
    seen.push(alias);
  }
  return false;
}

const sameRule = (a: DomainValues, b: DomainValues): boolean =>
  a.host === b.host && a.match_scope === b.match_scope && a.path_prefix === b.path_prefix;

const valuesOfAlias = (row: StoredAlias): AliasValues => ({
  alias: row.alias,
  match_mode: row.match_mode ?? 'word_boundary',
  case_sensitive: row.case_sensitive ?? false,
  language_code: row.language_code ?? null,
  is_negative: row.is_negative ?? false,
  requires_context: row.requires_context ?? false,
});

const valuesOfDomain = (row: StoredDomain): DomainValues => ({
  host: row.host,
  match_scope: row.match_scope ?? 'registrable',
  path_prefix: row.path_prefix ?? null,
});

/** An alias row, without the members that hold their default. It takes its entity's time (../entities-codec.ts). */
const aliasRow = (aliasId: string, values: AliasValues, entity: StoredEntity): StoredAlias => ({
  alias_id: aliasId,
  entity_id: entity.entity_id,
  alias: values.alias,
  ...(values.match_mode === 'word_boundary' ? {} : { match_mode: values.match_mode }),
  ...(values.case_sensitive ? { case_sensitive: true } : {}),
  ...(values.language_code === null ? {} : { language_code: values.language_code }),
  ...(values.is_negative ? { is_negative: true } : {}),
  ...(values.requires_context ? { requires_context: true } : {}),
  created_at: entity.created_at,
});

/** An entity domain row, without the members that hold their default. */
const domainRow = (domainId: string, values: DomainValues, entityId: string): StoredDomain => ({
  entity_domain_id: domainId,
  entity_id: entityId,
  host: values.host,
  ...(values.match_scope === 'registrable' ? {} : { match_scope: values.match_scope }),
  ...(values.path_prefix === null ? {} : { path_prefix: values.path_prefix }),
});

/** What a domain rule claims: the registrable domain, the host, or the host and a path. */
const claimOf = (rule: DomainValues): string =>
  rule.match_scope === 'registrable'
    ? `registrable:${registrableDomain(rule.host)}`
    : rule.match_scope === 'host'
      ? `host:${rule.host}`
      : `path:${rule.host}${rule.path_prefix ?? ''}`;

/**
 * Whether another entity with a live role in a project where this one has a live role claims the same domain
 * at the same specificity (doc 13 stage 2). Own wins at derivation; the API only warns.
 */
function roleConflict(world: EntityWorld, entityId: string, rule: DomainValues): boolean {
  const projects = new Set(projectsUsing(world, entityId));
  const neighbours = new Set(
    world.roles
      .filter((role) => projects.has(role.project_id) && isActiveRole(role) && role.entity_id !== entityId)
      .map((role) => role.entity_id),
  );
  const claim = claimOf(rule);
  return world.domains.some((domain) => neighbours.has(domain.entity_id) && claimOf(valuesOfDomain(domain)) === claim);
}

/** Entities by name, ignoring case, then id. */
const byName = (a: StoredEntity, b: StoredEntity): number =>
  a.canonical_name.toLowerCase().localeCompare(b.canonical_name.toLowerCase()) ||
  a.entity_id.localeCompare(b.entity_id);

/** Whether the entity's name or one of its aliases holds `text`, ignoring case. */
const holds = (world: EntityWorld, entity: StoredEntity, text: string): boolean => {
  const needle = text.toLowerCase();
  return (
    entity.canonical_name.toLowerCase().includes(needle) ||
    world.aliases.some((alias) => alias.entity_id === entity.entity_id && alias.alias.toLowerCase().includes(needle))
  );
};

const W = '/api/v1/workspaces/{workspace_id}';
const LIST_QUERY = ['cursor', 'limit', 'filter[entity_type]', 'filter[q]', 'filter[project_id]', 'filter[role]'];

export const entityHandlers: HttpHandler[] = [
  mock('get', `${W}/entities`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'data:read',
      query: LIST_QUERY,
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const paging = pageRequest(url);
    const type = url.searchParams.get('filter[entity_type]');
    const text = url.searchParams.get('filter[q]');
    const projectId = url.searchParams.get('filter[project_id]');
    const role = url.searchParams.get('filter[role]');
    const errors = [
      ...(Array.isArray(paging) ? paging : []),
      ...(type === null || isOneOf(type, ENTITY_TYPES)
        ? []
        : [queryError('filter[entity_type]', 'enum', `Allowed: ${ENTITY_TYPES.join(', ')}.`)]),
      ...(text === null ? [] : textErrorOfQuery(text)),
      ...(role === null || isOneOf(role, ROLES)
        ? []
        : [queryError('filter[role]', 'enum', `Allowed: ${ROLES.join(', ')}.`)]),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const scope = caller.access.membership.project_ids;
    // A live role, in the project given or any project the member may open
    const roles =
      projectId === null && role === null
        ? null
        : caller.world.roles.filter(
            (candidate) =>
              isActiveRole(candidate) &&
              (projectId === null || candidate.project_id === projectId) &&
              (role === null || candidate.role === role) &&
              (scope === null || scope.includes(candidate.project_id)),
          );
    const rows = caller.world.entities
      .filter((entity) => workspaceOfRow(entity) === caller.access.workspace.workspace_id)
      .filter((entity) => canSee(caller, entity.entity_id))
      .filter((entity) => type === null || entity.entity_type === type)
      .filter((entity) => text === null || holds(caller.world, entity, text))
      .filter((entity) => roles === null || roles.some((candidate) => candidate.entity_id === entity.entity_id))
      .sort(byName);
    const page = cursorPage(rows, paging, JSON.stringify([type, text, projectId, role]));
    if (page === null) return problem(request, 'invalid_cursor');
    return HttpResponse.json({ data: page.data.map((entity) => entityView(caller.world, entity)), page: page.page });
  }),

  mock('post', `${W}/entities`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const aliases = aliasList(body.aliases, 'aliases', MAX_ALIASES);
    const domains = domainList(body.domains, 'domains');
    const errors = [
      ...extraMembers(body, [...ENTITY_FIELDS, 'aliases', 'domains']),
      ...['entity_type', 'canonical_name']
        .filter((name) => body[name] === undefined)
        .map((name) => bodyError(name, 'missing', 'Field required')),
      ...nullErrors(body, [
        'entity_type',
        'canonical_name',
        'is_ambiguous',
        'disambiguation_hints',
        'aliases',
        'domains',
      ]),
      ...entityFieldErrors(body),
      ...(isAliasList(aliases) ? [] : aliases),
      ...(isDomainList(domains) ? [] : domains),
    ];
    if (errors.length > 0 || !isAliasList(aliases) || !isDomainList(domains)) return invalid(request, errors);
    if (!isOneOf(body.entity_type, ENTITY_TYPES) || typeof body.canonical_name !== 'string') {
      throw new Error('The entity type and name were checked above');
    }
    const parentId = typeof body.parent_entity_id === 'string' ? body.parent_entity_id : null;
    if (parentId !== null) {
      const refused = parentProblem(request, caller, parentId, null);
      if (refused) return refused;
    }
    const name = body.canonical_name.trim();
    if (nameTaken(caller, name, body.entity_type)) return duplicate(request, NAME_TAKEN);
    if (repeatsAlias([], aliases)) return duplicate(request, 'An alias is given twice.');
    if (domains.some((rule, index) => domains.findIndex((other) => sameRule(other, rule)) !== index)) {
      return duplicate(request, 'A domain is given twice at the same scope.');
    }
    const workspaceId = caller.access.workspace.workspace_id;
    const hints = Array.isArray(body.disambiguation_hints)
      ? body.disambiguation_hints.filter((hint): hint is string => typeof hint === 'string').map((hint) => hint.trim())
      : [];
    const ids = idMinter(caller.entityChanges);
    const entity: StoredEntity = {
      entity_id: ids.next('entity'),
      ...(workspaceId === MOCK_WORKSPACE.workspace_id ? {} : { workspace_id: workspaceId }),
      entity_type: body.entity_type,
      canonical_name: name,
      ...(parentId === null ? {} : { parent_entity_id: parentId }),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(body.is_ambiguous === true ? { is_ambiguous: true } : {}),
      ...(hints.length > 0 ? { disambiguation_hints: hints } : {}),
      created_at: stateTime(),
    };
    let next = withCreated(caller.entityChanges, 'entities', entity);
    for (const alias of aliases) next = withCreated(next, 'aliases', aliasRow(ids.next('alias'), alias, entity));
    for (const rule of domains) {
      next = withCreated(next, 'domains', domainRow(ids.next('domain'), rule, entity.entity_id));
    }
    next = ids.commit(next);
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    return HttpResponse.json({ data: entityView(world, entity) }, { status: 201, headers: { 'set-cookie': cookie } });
  }),

  mock('get', `${W}/entities/{entity_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    if (!entity) return problem(request, 'not_found');
    const visible = caller.projects.map((project) => project.project_id);
    return HttpResponse.json({ data: entityDetailView(caller.world, entity, visible) });
  }),

  mock('patch', `${W}/entities/{entity_id}`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    if (!entity) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const errors = [
      ...extraMembers(body, ENTITY_FIELDS),
      ...nullErrors(body, ['canonical_name', 'entity_type', 'is_ambiguous', 'disambiguation_hints']),
      ...entityFieldErrors(body),
    ];
    if (errors.length > 0) return invalid(request, errors);
    if (typeof body.parent_entity_id === 'string') {
      const refused = parentProblem(request, caller, body.parent_entity_id, entity.entity_id);
      if (refused) return refused;
    }
    const name = typeof body.canonical_name === 'string' ? body.canonical_name.trim() : undefined;
    const type: EntityType | undefined = isOneOf(body.entity_type, ENTITY_TYPES) ? body.entity_type : undefined;
    if (nameTaken(caller, name ?? entity.canonical_name, type ?? entity.entity_type, entity.entity_id)) {
      return duplicate(request, NAME_TAKEN);
    }
    let next = withEdited(caller.entityChanges, 'entities', entity, {
      canonical_name: name,
      entity_type: type,
      parent_entity_id:
        'parent_entity_id' in body
          ? typeof body.parent_entity_id === 'string'
            ? body.parent_entity_id
            : null
          : undefined,
      description: 'description' in body ? (typeof body.description === 'string' ? body.description : null) : undefined,
      is_ambiguous: typeof body.is_ambiguous === 'boolean' ? body.is_ambiguous : undefined,
      disambiguation_hints: Array.isArray(body.disambiguation_hints)
        ? body.disambiguation_hints
            .filter((hint): hint is string => typeof hint === 'string')
            .map((hint) => hint.trim())
        : undefined,
      updated_at: stateTime(),
    });
    next = bumpedFor(next, caller.world, entity.entity_id);
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    const changed = world.entities.find((candidate) => candidate.entity_id === entity.entity_id);
    if (!changed) throw new Error('The changed entity is missing');
    return HttpResponse.json({ data: entityView(world, changed) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('delete', `${W}/entities/{entity_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    if (!entity) return problem(request, 'not_found');
    // A role keeps history even once removed, so an entity any project ever named stays
    if (
      caller.world.roles.some((role) => role.entity_id === entity.entity_id) ||
      caller.world.entities.some((other) => other.parent_entity_id === entity.entity_id)
    ) {
      return problem(request, 'entity_in_use', {
        detail: 'A project has named this entity, or it has products. Remove those first.',
      });
    }
    let next = withDeleted(caller.entityChanges, 'entities', entity.entity_id);
    for (const alias of caller.world.aliases.filter((row) => row.entity_id === entity.entity_id)) {
      next = withDeleted(next, 'aliases', alias.alias_id);
    }
    for (const domain of caller.world.domains.filter((row) => row.entity_id === entity.entity_id)) {
      next = withDeleted(next, 'domains', domain.entity_domain_id);
    }
    const cookie = savedEntities(request, next);
    return typeof cookie === 'string' ? noContent({ 'set-cookie': cookie }) : cookie;
  }),

  mock('get', `${W}/entities/{entity_id}/aliases`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    if (!entity) return problem(request, 'not_found');
    return HttpResponse.json({ data: aliasesOf(caller.world, entity.entity_id).map(aliasView) });
  }),

  mock('post', `${W}/entities/{entity_id}/aliases`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    if (!entity) return problem(request, 'not_found');
    const body: unknown = await request.json();
    // One alias, or `{ items }` of up to 200
    const single = (parsed: AliasValues | ValidationItem[]): AliasValues[] | ValidationItem[] =>
      Array.isArray(parsed) ? parsed : [parsed];
    const incoming = isRecord(body) && 'items' in body ? aliasBatch(body) : single(aliasInput(body, ''));
    if (!isAliasList(incoming)) return invalid(request, incoming);
    const existing = aliasesOf(caller.world, entity.entity_id).map(valuesOfAlias);
    if (repeatsAlias(existing, incoming)) return duplicate(request, 'The entity has this alias already.');
    const ids = idMinter(caller.entityChanges);
    const rows = incoming.map((alias) => aliasRow(ids.next('alias'), alias, entity));
    let next = caller.entityChanges;
    for (const row of rows) next = withCreated(next, 'aliases', row);
    next = ids.commit(bumpedFor(next, caller.world, entity.entity_id));
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json({ data: rows.map(aliasView) }, { status: 201, headers: { 'set-cookie': cookie } });
  }),

  mock('patch', `${W}/entities/{entity_id}/aliases/{alias_id}`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    const alias = entity
      ? caller.world.aliases.find((row) => row.alias_id === params.alias_id && row.entity_id === entity.entity_id)
      : undefined;
    if (!entity || !alias) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const errors = [
      ...extraMembers(body, [
        'alias',
        'match_mode',
        'case_sensitive',
        'language_code',
        'is_negative',
        'requires_context',
      ]),
      ...nullErrors(body, ['alias', 'match_mode', 'case_sensitive', 'is_negative', 'requires_context']),
      ...aliasMemberErrors(
        Object.fromEntries(Object.entries(body).filter(([name, value]) => name === 'language_code' || value !== null)),
        '',
      ),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const current = valuesOfAlias(alias);
    const mode = isOneOf(body.match_mode, MATCH_MODES) ? body.match_mode : current.match_mode;
    const caseSensitive = typeof body.case_sensitive === 'boolean' ? body.case_sensitive : current.case_sensitive;
    // The merged alias is shaped again and reported on `alias`, as the backend's service does
    const shaped = aliasShape(
      typeof body.alias === 'string' ? body.alias : current.alias,
      mode,
      caseSensitive,
      'alias',
    );
    if (typeof shaped !== 'string') return invalid(request, [shaped]);
    const changed: AliasValues = {
      alias: shaped,
      match_mode: mode,
      case_sensitive: caseSensitive,
      language_code:
        'language_code' in body
          ? typeof body.language_code === 'string'
            ? body.language_code
            : null
          : current.language_code,
      is_negative: typeof body.is_negative === 'boolean' ? body.is_negative : current.is_negative,
      requires_context: typeof body.requires_context === 'boolean' ? body.requires_context : current.requires_context,
    };
    const others = aliasesOf(caller.world, entity.entity_id)
      .filter((row) => row.alias_id !== alias.alias_id)
      .map(valuesOfAlias);
    if (repeatsAlias(others, [changed])) return duplicate(request, 'The entity has this alias already.');
    const next = bumpedFor(withEdited(caller.entityChanges, 'aliases', alias, changed), caller.world, entity.entity_id);
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const saved = entityWorld(next, caller.changes).aliases.find((row) => row.alias_id === alias.alias_id);
    if (!saved) throw new Error('The changed alias is missing');
    return HttpResponse.json({ data: aliasView(saved) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('delete', `${W}/entities/{entity_id}/aliases/{alias_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    const alias = entity
      ? caller.world.aliases.find((row) => row.alias_id === params.alias_id && row.entity_id === entity.entity_id)
      : undefined;
    if (!entity || !alias) return problem(request, 'not_found');
    const next = bumpedFor(
      withDeleted(caller.entityChanges, 'aliases', alias.alias_id),
      caller.world,
      entity.entity_id,
    );
    const cookie = savedEntities(request, next);
    return typeof cookie === 'string' ? noContent({ 'set-cookie': cookie }) : cookie;
  }),

  mock('get', `${W}/entities/{entity_id}/domains`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    if (!entity) return problem(request, 'not_found');
    return HttpResponse.json({ data: entityView(caller.world, entity).domains });
  }),

  mock('post', `${W}/entities/{entity_id}/domains`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    if (!entity) return problem(request, 'not_found');
    const body: unknown = await request.json();
    const rule = domainInput(body, '');
    if (Array.isArray(rule)) return invalid(request, rule);
    const existing = caller.world.domains.filter((row) => row.entity_id === entity.entity_id).map(valuesOfDomain);
    if (existing.some((other) => sameRule(other, rule))) {
      return duplicate(request, 'The entity claims this domain at this scope already.');
    }
    const ids = idMinter(caller.entityChanges);
    const row = domainRow(ids.next('domain'), rule, entity.entity_id);
    const warnings: 'domain_role_conflict'[] = roleConflict(caller.world, entity.entity_id, rule)
      ? ['domain_role_conflict']
      : [];
    const next = ids.commit(
      bumpedFor(withCreated(caller.entityChanges, 'domains', row), caller.world, entity.entity_id),
    );
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: entityDomainView(row), meta: { warnings } },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('delete', `${W}/entities/{entity_id}/domains/{entity_domain_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, WRITE);
    if (caller instanceof Response) return caller;
    const entity = entityIn(caller, params.entity_id);
    const domain = entity
      ? caller.world.domains.find(
          (row) => row.entity_domain_id === params.entity_domain_id && row.entity_id === entity.entity_id,
        )
      : undefined;
    if (!entity || !domain) return problem(request, 'not_found');
    const next = bumpedFor(
      withDeleted(caller.entityChanges, 'domains', domain.entity_domain_id),
      caller.world,
      entity.entity_id,
    );
    const cookie = savedEntities(request, next);
    return typeof cookie === 'string' ? noContent({ 'set-cookie': cookie }) : cookie;
  }),
];

/** The errors of `filter[q]`: 1 to 200 characters. */
function textErrorOfQuery(text: string): ValidationItem[] {
  if (text.length === 0) return [queryError('filter[q]', 'string_too_short', 'At least 1 character.')];
  if (text.length > MAX_QUERY_TEXT) return [queryError('filter[q]', 'string_too_long', 'At most 200 characters.')];
  return [];
}
