import { domainRefFactory } from './domain';
import {
  isActiveRole,
  type EntityWorld,
  type StoredAlias,
  type StoredDomain,
  type StoredEntity,
  type StoredRole,
  type StoredTerm,
  type StoredVocabulary,
} from '../entities-state';
import { MOCK_INVITED_USER, MOCK_USERS } from '../fixtures';
import type {
  Alias,
  Entity,
  EntityDetail,
  EntityDomain,
  EntityRef,
  ProjectEntity,
  Term,
  Vocabulary,
} from '@/lib/api/types';

/**
 * The entity and taxonomy payloads of the API (19 sections 3.4 and 3.5), built from the stored rows of
 * ../entities-state.ts with their defaults filled in, and typed by the generated schema.
 */

export function aliasView(row: StoredAlias): Alias {
  const author = [...MOCK_USERS, MOCK_INVITED_USER].find((user) => user.user_id === row.created_by);
  return {
    alias_id: row.alias_id,
    entity_id: row.entity_id,
    alias: row.alias,
    match_mode: row.match_mode ?? 'word_boundary',
    case_sensitive: row.case_sensitive ?? false,
    language_code: row.language_code ?? null,
    is_negative: row.is_negative ?? false,
    requires_context: row.requires_context ?? false,
    created_by: author ? { user_id: author.user_id, name: author.name, email: author.email } : null,
    created_at: row.created_at,
  };
}

export const entityDomainView = (row: StoredDomain): EntityDomain => ({
  entity_domain_id: row.entity_domain_id,
  entity_id: row.entity_id,
  domain: domainRefFactory(row.host),
  match_scope: row.match_scope ?? 'registrable',
  path_prefix: row.path_prefix ?? null,
});

/** An entity's domains, by host and then path prefix. */
const domainsOf = (world: EntityWorld, entityId: string): EntityDomain[] =>
  world.domains
    .filter((domain) => domain.entity_id === entityId)
    .sort((a, b) => a.host.localeCompare(b.host) || (a.path_prefix ?? '').localeCompare(b.path_prefix ?? ''))
    .map(entityDomainView);

/** An entity's aliases, in the order they were added (the sort is stable, so one batch keeps its order). */
export const aliasesOf = (world: EntityWorld, entityId: string): StoredAlias[] =>
  world.aliases
    .filter((alias) => alias.entity_id === entityId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

export function entityView(world: EntityWorld, row: StoredEntity): Entity {
  return {
    entity_id: row.entity_id,
    entity_type: row.entity_type,
    canonical_name: row.canonical_name,
    parent_entity_id: row.parent_entity_id ?? null,
    description: row.description ?? null,
    is_ambiguous: row.is_ambiguous ?? false,
    disambiguation_hints: row.disambiguation_hints ?? [],
    alias_count: world.aliases.filter((alias) => alias.entity_id === row.entity_id).length,
    domains: domainsOf(world, row.entity_id),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

/** The detail of an entity, with the roles of the projects the caller may open, removed ones included. */
export function entityDetailView(world: EntityWorld, row: StoredEntity, projectIds: readonly string[]): EntityDetail {
  return {
    ...entityView(world, row),
    aliases: aliasesOf(world, row.entity_id).map(aliasView),
    projects: world.roles
      .filter((role) => role.entity_id === row.entity_id && projectIds.includes(role.project_id))
      .map((role) => ({
        project_id: role.project_id,
        role: role.role,
        is_primary: role.is_primary ?? false,
        removed_at: role.removed_at ?? null,
      })),
  };
}

/** An entity as other payloads name it, with its role in the project asked about when there is one. */
export const entityRefView = (row: StoredEntity, role?: StoredRole): EntityRef => ({
  entity_id: row.entity_id,
  canonical_name: row.canonical_name,
  entity_type: row.entity_type,
  role: role && isActiveRole(role) ? role.role : null,
  color_index: role?.color_index ?? null,
});

export function projectEntityView(world: EntityWorld, role: StoredRole): ProjectEntity {
  const entity = world.entities.find((candidate) => candidate.entity_id === role.entity_id);
  if (!entity) throw new Error(`The role names an entity that is missing: ${role.entity_id}`);
  return {
    project_id: role.project_id,
    entity: entityRefView(entity, role),
    role: role.role,
    is_primary: role.is_primary ?? false,
    track_seo: role.track_seo ?? true,
    track_ai: role.track_ai ?? true,
    color_index: role.color_index ?? null,
    added_at: role.added_at,
    removed_at: role.removed_at ?? null,
    alias_count: world.aliases.filter((alias) => alias.entity_id === role.entity_id).length,
    domains: domainsOf(world, role.entity_id),
  };
}

export const vocabularyView = (world: EntityWorld, row: StoredVocabulary): Vocabulary => ({
  vocabulary_id: row.vocabulary_id,
  project_id: row.project_id ?? null,
  kind: row.kind,
  name: row.name,
  is_hierarchical: row.is_hierarchical ?? false,
  is_single_valued: row.is_single_valued ?? false,
  term_count: world.terms.filter((term) => term.vocabulary_id === row.vocabulary_id).length,
});

/** The slugs from the root down to `row`, joined by `/`. A broken chain (a hand-edited cookie) stops where it breaks. */
function termPath(world: EntityWorld, row: StoredTerm): string {
  const slugs = [row.slug];
  const seen = new Set([row.term_id]);
  let parentId = row.parent_id ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = world.terms.find((term) => term.term_id === parentId);
    if (!parent) break;
    slugs.unshift(parent.slug);
    seen.add(parent.term_id);
    parentId = parent.parent_id ?? null;
  }
  return slugs.join('/');
}

export const termView = (world: EntityWorld, row: StoredTerm): Term => ({
  term_id: row.term_id,
  vocabulary_id: row.vocabulary_id,
  parent_id: row.parent_id ?? null,
  name: row.name,
  slug: row.slug,
  path: termPath(world, row),
  source: row.source ?? 'manual',
  description: row.description ?? null,
  created_at: row.created_at,
});
