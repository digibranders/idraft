import { jsonCookie, readJsonCookie } from './cookie-json';
import { COMPACT_CHANGES, decodeChanges, encodeChanges } from './entities-codec';
import {
  MOCK_ALIASES,
  MOCK_ENTITIES,
  MOCK_ENTITY_DOMAINS,
  MOCK_ROLES,
  MOCK_TERMS,
  MOCK_VOCABULARIES,
} from './entity-fixtures';
import { MOCK_WORKSPACE } from './fixtures';
import { FIRST_MINTED, mockId, type IdKind } from './mock-ids';
import { ENTITIES_COOKIE } from './session';
import type { WorkspaceChanges } from './workspace-state';
import { z } from 'zod';

/**
 * What one browser changed in the entities and the taxonomy through the mocks (19 sections 3.4 and 3.5):
 * entities, aliases, entity domains, project roles, vocabularies and terms that were created, edited or
 * deleted, and how often each project's `entity_config_version` moved. Only the changes are kept, in their
 * own cookie, against a base of the fixtures (./entity-fixtures.ts) and the own entities of projects created
 * here (./workspace-state.ts). In memory the rows are whole; ./entities-codec.ts writes them compactly.
 */
export { ENTITIES_COOKIE };

const ENTITY_TYPE = z.enum(['brand', 'product', 'organization', 'person', 'other']);
const MATCH_MODE = z.enum(['word_boundary', 'exact_case', 'substring', 'regex']);
const MATCH_SCOPE = z.enum(['path_prefix', 'host', 'registrable']);
const ROLE = z.enum(['own', 'competitor', 'watch']);
const VOCABULARY_KIND = z.enum([
  'topic',
  'cluster',
  'product',
  'service',
  'market',
  'campaign',
  'persona',
  'tag',
  'custom',
]);
const TERM_SOURCE = z.enum(['manual', 'import', 'auto_cluster', 'ai_suggestion']);

/** An entity. `workspace_id` is left out for the fixture workspace. */
const STORED_ENTITY = z.object({
  entity_id: z.string(),
  workspace_id: z.string().optional(),
  entity_type: ENTITY_TYPE,
  canonical_name: z.string(),
  parent_entity_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  is_ambiguous: z.boolean().optional(),
  disambiguation_hints: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

/** An alias; `created_by` is a user id, kept for the fixtures only. */
const STORED_ALIAS = z.object({
  alias_id: z.string(),
  entity_id: z.string(),
  alias: z.string(),
  match_mode: MATCH_MODE.optional(),
  case_sensitive: z.boolean().optional(),
  language_code: z.string().nullable().optional(),
  is_negative: z.boolean().optional(),
  requires_context: z.boolean().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string(),
});

/** An entity domain: a canonical host, matched by registrable domain unless said otherwise. */
const STORED_DOMAIN = z.object({
  entity_domain_id: z.string(),
  entity_id: z.string(),
  host: z.string(),
  match_scope: MATCH_SCOPE.optional(),
  path_prefix: z.string().nullable().optional(),
});

/** A project's role for an entity: one row per project and entity, kept with `removed_at` once removed. */
const STORED_ROLE = z.object({
  project_id: z.string(),
  entity_id: z.string(),
  role: ROLE,
  is_primary: z.boolean().optional(),
  track_seo: z.boolean().optional(),
  track_ai: z.boolean().optional(),
  color_index: z.number().nullable().optional(),
  added_at: z.string(),
  removed_at: z.string().nullable().optional(),
});

/** A vocabulary. `workspace_id` is left out for the fixture workspace; no `project_id` is workspace-wide. */
const STORED_VOCABULARY = z.object({
  vocabulary_id: z.string(),
  workspace_id: z.string().optional(),
  project_id: z.string().nullable().optional(),
  kind: VOCABULARY_KIND,
  name: z.string(),
  is_hierarchical: z.boolean().optional(),
  is_single_valued: z.boolean().optional(),
});

/** A term. Its path is derived from its ancestors' slugs, so a move changes no other row. */
const STORED_TERM = z.object({
  term_id: z.string(),
  vocabulary_id: z.string(),
  parent_id: z.string().nullable().optional(),
  name: z.string(),
  slug: z.string(),
  source: TERM_SOURCE.optional(),
  description: z.string().nullable().optional(),
  created_at: z.string(),
});

export type StoredEntity = z.infer<typeof STORED_ENTITY>;
export type StoredAlias = z.infer<typeof STORED_ALIAS>;
export type StoredDomain = z.infer<typeof STORED_DOMAIN>;
export type StoredRole = z.infer<typeof STORED_ROLE>;
export type StoredVocabulary = z.infer<typeof STORED_VOCABULARY>;
export type StoredTerm = z.infer<typeof STORED_TERM>;

/** The members of a row to change; a member left out keeps its value. */
type RowPatch<R> = { [K in keyof R]?: R[K] | undefined };

/** Rows created here, rows of the base as changed here (whole), and rows of the base deleted. */
export interface Collection<R> {
  created?: R[] | undefined;
  edited?: R[] | undefined;
  deleted?: string[] | undefined;
}

export interface Kinds {
  entities: StoredEntity;
  aliases: StoredAlias;
  domains: StoredDomain;
  roles: StoredRole;
  vocabularies: StoredVocabulary;
  terms: StoredTerm;
}
export type Kind = keyof Kinds;

type Collections = { [K in Kind]?: Collection<Kinds[K]> | undefined };

export type EntityChanges = Collections & {
  /** Per project, how many times its `entity_config_version` moved past 1. */
  versions?: Record<string, number> | undefined;
  /** The last id number given to a row created here. */
  minted?: number | undefined;
};

const SCHEMAS: { readonly [K in Kind]: z.ZodType<Kinds[K]> } = {
  entities: STORED_ENTITY,
  aliases: STORED_ALIAS,
  domains: STORED_DOMAIN,
  roles: STORED_ROLE,
  vocabularies: STORED_VOCABULARY,
  terms: STORED_TERM,
};

/** What the cookie holds, checked against its shape; a cookie that does not decode is ignored. */
export function readEntityChanges(cookies: Readonly<Record<string, string>>): EntityChanges {
  const compact = readJsonCookie(cookies, ENTITIES_COOKIE, COMPACT_CHANGES, null);
  return compact === null ? {} : (decodeChanges(compact) ?? {});
}

/** The `Set-Cookie` that keeps `changes`, or `null` when they no longer fit in a cookie. */
export const entitiesCookie = (changes: EntityChanges): string | null =>
  jsonCookie(ENTITIES_COOKIE, encodeChanges(changes));

const roleKey = (projectId: string, entityId: string): string => `${projectId}:${entityId}`;

/** The key of a row in its collection. A role has none of its own: a project has one row per entity. */
const keyOf: { readonly [K in Kind]: (row: Kinds[K]) => string } = {
  entities: (row) => row.entity_id,
  aliases: (row) => row.alias_id,
  domains: (row) => row.entity_domain_id,
  roles: (row) => roleKey(row.project_id, row.entity_id),
  vocabularies: (row) => row.vocabulary_id,
  terms: (row) => row.term_id,
};

/** Every row of every kind, as this browser changed them. */
export interface EntityWorld {
  entities: StoredEntity[];
  aliases: StoredAlias[];
  domains: StoredDomain[];
  roles: StoredRole[];
  vocabularies: StoredVocabulary[];
  terms: StoredTerm[];
}

/** The base: the fixtures, and the own entity of every project created here with one. */
function baseOf(workspace: WorkspaceChanges): EntityWorld {
  const world: EntityWorld = {
    entities: [...MOCK_ENTITIES],
    aliases: [...MOCK_ALIASES],
    domains: [...MOCK_ENTITY_DOMAINS],
    roles: [...MOCK_ROLES],
    vocabularies: [...MOCK_VOCABULARIES],
    terms: [...MOCK_TERMS],
  };
  for (const project of workspace.created ?? []) {
    const own = project.own_entity;
    if (own === undefined) continue;
    world.entities.push({
      entity_id: own.entity_id,
      ...(project.workspace_id === MOCK_WORKSPACE.workspace_id ? {} : { workspace_id: project.workspace_id }),
      entity_type: 'brand',
      canonical_name: own.canonical_name,
      created_at: project.created_at,
    });
    for (const alias of own.aliases) {
      world.aliases.push({ ...alias, entity_id: own.entity_id, created_at: project.created_at });
    }
    for (const domain of own.domains) world.domains.push({ ...domain, entity_id: own.entity_id });
    world.roles.push({
      project_id: project.project_id,
      entity_id: own.entity_id,
      role: 'own',
      is_primary: true,
      color_index: 1,
      added_at: project.created_at,
    });
  }
  return world;
}

/** The rows of one kind: the base and the rows created here, less the deleted ones, as changed here. */
function rowsOf<K extends Kind>(
  kind: K,
  base: readonly Kinds[K][],
  change: Collection<Kinds[K]> | undefined,
): Kinds[K][] {
  const key = keyOf[kind];
  const deleted = new Set(change?.deleted ?? []);
  const edited = new Map((change?.edited ?? []).map((row) => [key(row), row]));
  return [...base, ...(change?.created ?? [])]
    .filter((row) => !deleted.has(key(row)))
    .map((row) => edited.get(key(row)) ?? row);
}

export function entityWorld(changes: EntityChanges, workspace: WorkspaceChanges): EntityWorld {
  const base = baseOf(workspace);
  return {
    entities: rowsOf('entities', base.entities, changes.entities),
    aliases: rowsOf('aliases', base.aliases, changes.aliases),
    domains: rowsOf('domains', base.domains, changes.domains),
    roles: rowsOf('roles', base.roles, changes.roles),
    vocabularies: rowsOf('vocabularies', base.vocabularies, changes.vocabularies),
    terms: rowsOf('terms', base.terms, changes.terms),
  };
}

/** The changes of one kind. */
function collectionOf<K extends Kind>(collections: Collections, kind: K): Collection<Kinds[K]> {
  return collections[kind] ?? {};
}

/** `changes` with a row created here. */
export function withCreated<K extends Kind>(changes: EntityChanges, kind: K, row: Kinds[K]): EntityChanges {
  const current = collectionOf(changes, kind);
  const next: Collection<Kinds[K]> = { ...current, created: [...(current.created ?? []), row] };
  return { ...changes, [kind]: next };
}

/**
 * `changes` with `patch` applied to `row` as it is now: in place for a row created here, as the whole changed
 * row for a row of the base. Members that are `undefined` keep their value.
 */
export function withEdited<K extends Kind>(
  changes: EntityChanges,
  kind: K,
  row: Kinds[K],
  patch: RowPatch<Kinds[K]>,
): EntityChanges {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  // Parsing merges the change and proves the result is still a whole row
  const merged = SCHEMAS[kind].parse({ ...row, ...defined });
  const key = keyOf[kind](row);
  const current = collectionOf(changes, kind);
  const created = current.created ?? [];
  const next: Collection<Kinds[K]> = created.some((candidate) => keyOf[kind](candidate) === key)
    ? { ...current, created: created.map((candidate) => (keyOf[kind](candidate) === key ? merged : candidate)) }
    : {
        ...current,
        edited: [...(current.edited ?? []).filter((candidate) => keyOf[kind](candidate) !== key), merged],
      };
  return { ...changes, [kind]: next };
}

/** `changes` without the row with `key`: dropped when it was created here, else marked deleted. */
export function withDeleted<K extends Kind>(changes: EntityChanges, kind: K, key: string): EntityChanges {
  const current = collectionOf(changes, kind);
  const created = current.created ?? [];
  const edited = (current.edited ?? []).filter((row) => keyOf[kind](row) !== key);
  const next: Collection<Kinds[K]> = created.some((row) => keyOf[kind](row) === key)
    ? { ...current, created: created.filter((row) => keyOf[kind](row) !== key), edited }
    : { ...current, edited, deleted: [...(current.deleted ?? []), key] };
  return { ...changes, [kind]: next };
}

/**
 * Ids for the rows a request creates, counted on from the last one this browser made, so the cookie can keep
 * a number for each. `commit` writes the count into the changes that hold the new rows.
 */
export function idMinter(changes: EntityChanges): {
  next: (kind: IdKind) => string;
  commit: (next: EntityChanges) => EntityChanges;
} {
  let last = changes.minted ?? FIRST_MINTED - 1;
  return {
    next: (kind) => {
      last += 1;
      return mockId(kind, last);
    },
    commit: (next) => ({ ...next, minted: last }),
  };
}

/** `changes` with the `entity_config_version` of each project moved once (doc 04, backend plan D7). */
export function withVersionsBumped(changes: EntityChanges, projectIds: Iterable<string>): EntityChanges {
  const versions = { ...changes.versions };
  for (const projectId of new Set(projectIds)) versions[projectId] = (versions[projectId] ?? 0) + 1;
  return { ...changes, versions };
}

/** A project's `entity_config_version` now. */
export const entityConfigVersion = (changes: EntityChanges, projectId: string): number =>
  1 + (changes.versions?.[projectId] ?? 0);

/** The workspace an entity or vocabulary belongs to. */
export const workspaceOfRow = (row: { workspace_id?: string | undefined }): string =>
  row.workspace_id ?? MOCK_WORKSPACE.workspace_id;

/** A role that was not removed. */
export const isActiveRole = (role: StoredRole): boolean => (role.removed_at ?? null) === null;

/** The projects that use an entity now: those that give it a role that is not removed. */
export const projectsUsing = (world: EntityWorld, entityId: string): string[] =>
  world.roles.filter((role) => role.entity_id === entityId && isActiveRole(role)).map((role) => role.project_id);

/** Every project that has given the entity a role, removed roles included: the projects a change bumps. */
export const projectsNaming = (world: EntityWorld, entityId: string): string[] =>
  world.roles.filter((role) => role.entity_id === entityId).map((role) => role.project_id);
