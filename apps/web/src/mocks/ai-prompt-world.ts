import { EVENTUS_DEFINITION, type AiPromptDefinition } from './ai-prompt-definition';
import type {
  StoredAlias,
  StoredDomain,
  StoredEntity,
  StoredRole,
  StoredTerm,
  StoredVocabulary,
} from './entities-state';
import { MOCK_CREATED_AT, MOCK_PROJECTS } from './fixtures';
import { mockId } from './mock-ids';

/**
 * The entities and the topic vocabulary a project's definition file (./ai-prompt-definition.ts) stands for, in the
 * stored form of ./entities-state.ts. The numbers start where the older fixtures stop (./entity-fixtures.ts: 10
 * entities, 17 aliases, 10 domains, 2 vocabularies, 9 terms), so nothing of theirs moves, and stay below
 * `FIRST_MINTED`.
 */

const FIRST = { entity: 11, alias: 18, domain: 11, vocabulary: 3, term: 10 } as const;

/** The brand or a competitor of the file. */
interface Party {
  key: string;
  name: string;
  aliases: string[];
  domains: string[];
  ambiguous?: boolean | undefined;
  disambiguation_hints?: string[] | undefined;
}

export interface DefinitionWorld {
  definition: AiPromptDefinition;
  projectId: string;
  /** The own brand's entity id. */
  brandId: string;
  entities: StoredEntity[];
  aliases: StoredAlias[];
  domains: StoredDomain[];
  roles: StoredRole[];
  vocabulary: StoredVocabulary;
  terms: StoredTerm[];
  /** The entity id of the brand or a competitor, by its key in the file. */
  entityIdOf: (key: string) => string;
  /** The term id of a topic, by its slug in the file. */
  termIdOf: (slug: string) => string;
}

export function buildWorld(definition: AiPromptDefinition): DefinitionWorld {
  const seed = MOCK_PROJECTS.find((project) => project.slug === definition.project.slug);
  if (seed === undefined) throw new Error(`The project ${definition.project.slug} has no fixture`);
  const at = MOCK_CREATED_AT;

  const parties: Party[] = [definition.brand, ...definition.competitors];
  const entityIds = new Map(parties.map((party, place) => [party.key, mockId('entity', FIRST.entity + place)]));
  const entityIdOf = (key: string): string => {
    const found = entityIds.get(key);
    if (found === undefined) throw new Error(`No entity has the key ${key}`);
    return found;
  };

  const entities = parties.map((party): StoredEntity => ({
    entity_id: entityIdOf(party.key),
    entity_type: 'brand',
    canonical_name: party.name,
    ...(party.ambiguous === true ? { is_ambiguous: true, disambiguation_hints: party.disambiguation_hints ?? [] } : {}),
    created_at: at,
  }));
  const aliases = parties
    .flatMap((party) => party.aliases.map((alias) => ({ entity: entityIdOf(party.key), alias })))
    .map(({ entity, alias }, place): StoredAlias => ({
      alias_id: mockId('alias', FIRST.alias + place),
      entity_id: entity,
      alias,
      created_at: at,
    }));
  const domains = parties
    .flatMap((party) => party.domains.map((host) => ({ entity: entityIdOf(party.key), host })))
    .map(({ entity, host }, place): StoredDomain => ({
      entity_domain_id: mockId('domain', FIRST.domain + place),
      entity_id: entity,
      host,
    }));
  // Own is colour 1 and the competitors follow, as the older fixtures number them
  const roles = parties.map((party, place): StoredRole =>
    place === 0
      ? {
          project_id: seed.project_id,
          entity_id: entityIdOf(party.key),
          added_at: at,
          role: 'own',
          is_primary: true,
          color_index: 1,
        }
      : {
          project_id: seed.project_id,
          entity_id: entityIdOf(party.key),
          added_at: at,
          role: 'competitor',
          color_index: place + 1,
        },
  );

  const vocabulary: StoredVocabulary = {
    vocabulary_id: mockId('vocabulary', FIRST.vocabulary),
    project_id: seed.project_id,
    kind: 'topic',
    name: 'Security topics',
    is_hierarchical: true,
  };
  const termIds = new Map<string, string>();
  const terms: StoredTerm[] = [];
  for (const parent of definition.topics) {
    const parentId = mockId('term', FIRST.term + terms.length);
    termIds.set(parent.slug, parentId);
    terms.push({
      term_id: parentId,
      vocabulary_id: vocabulary.vocabulary_id,
      name: parent.name,
      slug: parent.slug,
      created_at: at,
    });
    for (const child of parent.children) {
      const childId = mockId('term', FIRST.term + terms.length);
      termIds.set(child.slug, childId);
      terms.push({
        term_id: childId,
        vocabulary_id: vocabulary.vocabulary_id,
        parent_id: parentId,
        name: child.name,
        slug: child.slug,
        created_at: at,
      });
    }
  }
  const termIdOf = (slug: string): string => {
    const found = termIds.get(slug);
    if (found === undefined) throw new Error(`No topic has the slug ${slug}`);
    return found;
  };

  return {
    definition,
    projectId: seed.project_id,
    brandId: entityIdOf(definition.brand.key),
    entities,
    aliases,
    domains,
    roles,
    vocabulary,
    terms,
    entityIdOf,
    termIdOf,
  };
}

export const EVENTUS_WORLD: DefinitionWorld = buildWorld(EVENTUS_DEFINITION);
