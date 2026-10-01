import type {
  Collection,
  EntityChanges,
  Kind,
  Kinds,
  StoredAlias,
  StoredDomain,
  StoredEntity,
  StoredRole,
  StoredTerm,
  StoredVocabulary,
} from './entities-state';
import { MOCK_CREATED_AT } from './fixtures';
import { mockId, mockIdNumber, type IdKind } from './mock-ids';
import { termSlug } from './term-slug';
import { z } from 'zod';

/**
 * The compact form of the entity changes in their cookie (./entities-state.ts), so a browser can keep ten
 * competitors and dozens of terms in under 4 KB:
 *
 * - each row is a tuple, its members in a fixed order, a member at its default written as `0` and trailing
 *   defaults left out;
 * - an id of the mocks (./mock-ids.ts) is its number; any other id (a project, a workspace, an entity made
 *   with a new project) is written once in `u` and named by `-(index + 1)`;
 * - times are whole minutes after the fixture time; an alias takes its entity's time and a term the fixture
 *   time, and `created_by` is kept for the fixtures only;
 * - a term's slug is left out when it is the one its name makes.
 */

type Cell = string | number | string[];
type Tuple = Cell[];

const TUPLE = z.array(z.union([z.string(), z.number(), z.array(z.string())]));
const COLLECTION = z
  .object({
    c: z.array(TUPLE).optional(),
    m: z.array(TUPLE).optional(),
    d: z.array(z.union([z.number(), z.array(z.number())])).optional(),
  })
  .optional();

/** The shape of the cookie; one that does not fit is ignored. */
export const COMPACT_CHANGES = z.object({
  n: z.number().optional(),
  u: z.array(z.string()).optional(),
  e: COLLECTION,
  a: COLLECTION,
  o: COLLECTION,
  r: COLLECTION,
  v: COLLECTION,
  t: COLLECTION,
  x: z.array(z.tuple([z.number(), z.number()])).optional(),
});
type CompactChanges = z.infer<typeof COMPACT_CHANGES>;
type CompactCollection = NonNullable<CompactChanges['e']>;

const BASE_MS = Date.parse(MOCK_CREATED_AT);
const MINUTE_MS = 60_000;
const minutesOf = (iso: string): number => Math.max(0, Math.round((Date.parse(iso) - BASE_MS) / MINUTE_MS));
const timeOf = (minutes: number): string => new Date(BASE_MS + minutes * MINUTE_MS).toISOString();

/** Now, to the minute the cookie keeps, so a row reads back with the time it was answered with. */
export const stateTime = (now: number = Date.now()): string => timeOf(minutesOf(new Date(now).toISOString()));

/** Codes for the enumerations, the first of each being the default. */
const ENTITY_TYPES = ['brand', 'product', 'organization', 'person', 'other'] as const;
const MATCH_MODES = ['word_boundary', 'exact_case', 'substring', 'regex'] as const;
const MATCH_SCOPES = ['registrable', 'host', 'path_prefix'] as const;
const ROLES = ['competitor', 'own', 'watch'] as const;
const KINDS = ['topic', 'cluster', 'product', 'service', 'market', 'campaign', 'persona', 'tag', 'custom'] as const;
const SOURCES = ['manual', 'import', 'auto_cluster', 'ai_suggestion'] as const;

const MAX_ID_NUMBER = 999_999_999_999;

/** A cookie whose contents do not decode; it is ignored as a whole. */
class CookieShapeError extends Error {}

/** Trailing defaults left out. */
function trimmed(cells: Tuple): Tuple {
  const out = [...cells];
  while (out.length > 0 && out.at(-1) === 0) out.pop();
  return out;
}

const flags = (...set: boolean[]): number => set.reduce((sum, on, index) => sum + (on ? 2 ** index : 0), 0);
const flag = (value: number, index: number): boolean => Math.floor(value / 2 ** index) % 2 === 1;

class Encoder {
  readonly table: string[] = [];

  ref(id: string, kind: IdKind | null): number {
    const n = kind === null ? null : mockIdNumber(id, kind);
    if (n !== null) return n;
    const index = this.table.indexOf(id);
    if (index >= 0) return -(index + 1);
    this.table.push(id);
    return -this.table.length;
  }

  optRef(id: string | null | undefined, kind: IdKind | null): number {
    return id === null || id === undefined ? 0 : this.ref(id, kind);
  }
}

class Decoder {
  constructor(private readonly table: readonly string[]) {}

  text(cells: Tuple, index: number): string {
    const value = cells[index];
    if (typeof value !== 'string') throw new CookieShapeError();
    return value;
  }

  optText(cells: Tuple, index: number): string | null {
    const value = cells[index];
    if (value === undefined || value === 0) return null;
    if (typeof value !== 'string') throw new CookieShapeError();
    return value;
  }

  int(cells: Tuple, index: number): number {
    const value = cells[index] ?? 0;
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new CookieShapeError();
    return value;
  }

  list(cells: Tuple, index: number): string[] {
    const value = cells[index];
    if (value === undefined || value === 0) return [];
    if (!Array.isArray(value)) throw new CookieShapeError();
    return value;
  }

  code<T extends string>(cells: Tuple, index: number, options: readonly T[]): T {
    const value = cells[index] ?? 0;
    const found = typeof value === 'number' ? options[value] : undefined;
    if (found === undefined) throw new CookieShapeError();
    return found;
  }

  ref(value: number, kind: IdKind | null): string {
    if (value > 0 && kind !== null) {
      if (!Number.isSafeInteger(value) || value > MAX_ID_NUMBER) throw new CookieShapeError();
      return mockId(kind, value);
    }
    const id = value < 0 ? this.table[-value - 1] : undefined;
    if (id === undefined) throw new CookieShapeError();
    return id;
  }

  refAt(cells: Tuple, index: number, kind: IdKind | null): string {
    return this.ref(this.int(cells, index), kind);
  }

  optRefAt(cells: Tuple, index: number, kind: IdKind | null): string | null {
    const value = this.int(cells, index);
    return value === 0 ? null : this.ref(value, kind);
  }
}

interface RowCodec<R> {
  encode: (row: R, encoder: Encoder) => Tuple;
  decode: (cells: Tuple, decoder: Decoder, entityTimes: ReadonlyMap<string, string>) => R;
}

const indexOf = <T extends string>(options: readonly T[], value: T): number => options.indexOf(value);

const ENTITY: RowCodec<StoredEntity> = {
  encode: (row, encoder) => [
    encoder.ref(row.entity_id, 'entity'),
    indexOf(ENTITY_TYPES, row.entity_type),
    row.canonical_name,
    minutesOf(row.created_at),
    encoder.optRef(row.parent_entity_id, 'entity'),
    row.description ?? 0,
    flags(row.is_ambiguous ?? false),
    row.disambiguation_hints !== undefined && row.disambiguation_hints.length > 0 ? row.disambiguation_hints : 0,
    encoder.optRef(row.workspace_id, null),
    row.updated_at === undefined ? 0 : minutesOf(row.updated_at),
  ],
  decode: (cells, decoder) => {
    const parent = decoder.optRefAt(cells, 4, 'entity');
    const description = decoder.optText(cells, 5);
    const hints = decoder.list(cells, 7);
    const workspace = decoder.optRefAt(cells, 8, null);
    const updated = decoder.int(cells, 9);
    return {
      entity_id: decoder.refAt(cells, 0, 'entity'),
      entity_type: decoder.code(cells, 1, ENTITY_TYPES),
      canonical_name: decoder.text(cells, 2),
      created_at: timeOf(decoder.int(cells, 3)),
      ...(parent === null ? {} : { parent_entity_id: parent }),
      ...(description === null ? {} : { description }),
      ...(flag(decoder.int(cells, 6), 0) ? { is_ambiguous: true } : {}),
      ...(hints.length > 0 ? { disambiguation_hints: hints } : {}),
      ...(workspace === null ? {} : { workspace_id: workspace }),
      ...(updated === 0 ? {} : { updated_at: timeOf(updated) }),
    };
  },
};

const ALIAS: RowCodec<StoredAlias> = {
  encode: (row, encoder) => [
    encoder.ref(row.alias_id, 'alias'),
    encoder.ref(row.entity_id, 'entity'),
    row.alias,
    indexOf(MATCH_MODES, row.match_mode ?? 'word_boundary'),
    flags(row.case_sensitive ?? false, row.is_negative ?? false, row.requires_context ?? false),
    row.language_code ?? 0,
  ],
  decode: (cells, decoder, entityTimes) => {
    const entityId = decoder.refAt(cells, 1, 'entity');
    const mode = decoder.code(cells, 3, MATCH_MODES);
    const set = decoder.int(cells, 4);
    const language = decoder.optText(cells, 5);
    return {
      alias_id: decoder.refAt(cells, 0, 'alias'),
      entity_id: entityId,
      alias: decoder.text(cells, 2),
      ...(mode === 'word_boundary' ? {} : { match_mode: mode }),
      ...(flag(set, 0) ? { case_sensitive: true } : {}),
      ...(flag(set, 1) ? { is_negative: true } : {}),
      ...(flag(set, 2) ? { requires_context: true } : {}),
      ...(language === null ? {} : { language_code: language }),
      created_at: entityTimes.get(entityId) ?? MOCK_CREATED_AT,
    };
  },
};

const DOMAIN: RowCodec<StoredDomain> = {
  encode: (row, encoder) => [
    encoder.ref(row.entity_domain_id, 'domain'),
    encoder.ref(row.entity_id, 'entity'),
    row.host,
    indexOf(MATCH_SCOPES, row.match_scope ?? 'registrable'),
    row.path_prefix ?? 0,
  ],
  decode: (cells, decoder) => {
    const scope = decoder.code(cells, 3, MATCH_SCOPES);
    const prefix = decoder.optText(cells, 4);
    return {
      entity_domain_id: decoder.refAt(cells, 0, 'domain'),
      entity_id: decoder.refAt(cells, 1, 'entity'),
      host: decoder.text(cells, 2),
      ...(scope === 'registrable' ? {} : { match_scope: scope }),
      ...(prefix === null ? {} : { path_prefix: prefix }),
    };
  },
};

const ROLE: RowCodec<StoredRole> = {
  encode: (row, encoder) => [
    encoder.ref(row.project_id, null),
    encoder.ref(row.entity_id, 'entity'),
    indexOf(ROLES, row.role),
    minutesOf(row.added_at),
    row.color_index ?? 0,
    flags(row.is_primary ?? false, row.track_seo === false, row.track_ai === false),
    row.removed_at === null || row.removed_at === undefined ? 0 : Math.max(1, minutesOf(row.removed_at)),
  ],
  decode: (cells, decoder) => {
    const color = decoder.int(cells, 4);
    const set = decoder.int(cells, 5);
    const removed = decoder.int(cells, 6);
    return {
      project_id: decoder.refAt(cells, 0, null),
      entity_id: decoder.refAt(cells, 1, 'entity'),
      role: decoder.code(cells, 2, ROLES),
      added_at: timeOf(decoder.int(cells, 3)),
      ...(color === 0 ? {} : { color_index: color }),
      ...(flag(set, 0) ? { is_primary: true } : {}),
      ...(flag(set, 1) ? { track_seo: false } : {}),
      ...(flag(set, 2) ? { track_ai: false } : {}),
      ...(removed === 0 ? {} : { removed_at: timeOf(removed) }),
    };
  },
};

const VOCABULARY: RowCodec<StoredVocabulary> = {
  encode: (row, encoder) => [
    encoder.ref(row.vocabulary_id, 'vocabulary'),
    indexOf(KINDS, row.kind),
    row.name,
    flags(row.is_hierarchical ?? false, row.is_single_valued ?? false),
    encoder.optRef(row.project_id, null),
    encoder.optRef(row.workspace_id, null),
  ],
  decode: (cells, decoder) => {
    const set = decoder.int(cells, 3);
    const project = decoder.optRefAt(cells, 4, null);
    const workspace = decoder.optRefAt(cells, 5, null);
    return {
      vocabulary_id: decoder.refAt(cells, 0, 'vocabulary'),
      kind: decoder.code(cells, 1, KINDS),
      name: decoder.text(cells, 2),
      ...(flag(set, 0) ? { is_hierarchical: true } : {}),
      ...(flag(set, 1) ? { is_single_valued: true } : {}),
      ...(project === null ? {} : { project_id: project }),
      ...(workspace === null ? {} : { workspace_id: workspace }),
    };
  },
};

const TERM: RowCodec<StoredTerm> = {
  encode: (row, encoder) => [
    encoder.ref(row.term_id, 'term'),
    encoder.ref(row.vocabulary_id, 'vocabulary'),
    encoder.optRef(row.parent_id, 'term'),
    row.name,
    row.slug === termSlug(row.name) ? 0 : row.slug,
    row.description ?? 0,
    indexOf(SOURCES, row.source ?? 'manual'),
  ],
  decode: (cells, decoder) => {
    const name = decoder.text(cells, 3);
    const parent = decoder.optRefAt(cells, 2, 'term');
    const description = decoder.optText(cells, 5);
    const source = decoder.code(cells, 6, SOURCES);
    return {
      term_id: decoder.refAt(cells, 0, 'term'),
      vocabulary_id: decoder.refAt(cells, 1, 'vocabulary'),
      ...(parent === null ? {} : { parent_id: parent }),
      name,
      slug: decoder.optText(cells, 4) ?? termSlug(name),
      ...(description === null ? {} : { description }),
      ...(source === 'manual' ? {} : { source }),
      created_at: MOCK_CREATED_AT,
    };
  },
};

const CODECS: { readonly [K in Kind]: RowCodec<Kinds[K]> } = {
  entities: ENTITY,
  aliases: ALIAS,
  domains: DOMAIN,
  roles: ROLE,
  vocabularies: VOCABULARY,
  terms: TERM,
};

/** The id kind of each collection's key; a role's key is its project and entity. */
const KEY_KIND: Readonly<Record<Exclude<Kind, 'roles'>, IdKind>> = {
  entities: 'entity',
  aliases: 'alias',
  domains: 'domain',
  vocabularies: 'vocabulary',
  terms: 'term',
};

function encodeKey(kind: Kind, key: string, encoder: Encoder): number | number[] {
  if (kind !== 'roles') return encoder.ref(key, KEY_KIND[kind]);
  const [project = '', entity = ''] = key.split(':');
  return [encoder.ref(project, null), encoder.ref(entity, 'entity')];
}

function decodeKey(kind: Kind, cell: number | number[], decoder: Decoder): string {
  if (kind !== 'roles') {
    if (typeof cell !== 'number') throw new CookieShapeError();
    return decoder.ref(cell, KEY_KIND[kind]);
  }
  const [project, entity] = typeof cell === 'number' ? [] : cell;
  if (project === undefined || entity === undefined) throw new CookieShapeError();
  return `${decoder.ref(project, null)}:${decoder.ref(entity, 'entity')}`;
}

function encodeCollection<K extends Kind>(
  kind: K,
  collection: Collection<Kinds[K]> | undefined,
  encoder: Encoder,
): CompactCollection | undefined {
  if (collection === undefined) return undefined;
  const codec = CODECS[kind];
  const out: CompactCollection = {};
  if (collection.created && collection.created.length > 0) {
    out.c = collection.created.map((row) => trimmed(codec.encode(row, encoder)));
  }
  if (collection.edited && collection.edited.length > 0) {
    out.m = collection.edited.map((row) => trimmed(codec.encode(row, encoder)));
  }
  if (collection.deleted && collection.deleted.length > 0) {
    out.d = collection.deleted.map((key) => encodeKey(kind, key, encoder));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function decodeCollection<K extends Kind>(
  kind: K,
  compact: CompactCollection | undefined,
  decoder: Decoder,
  entityTimes: ReadonlyMap<string, string>,
): Collection<Kinds[K]> | undefined {
  if (compact === undefined) return undefined;
  const codec = CODECS[kind];
  return {
    created: (compact.c ?? []).map((cells) => codec.decode(cells, decoder, entityTimes)),
    edited: (compact.m ?? []).map((cells) => codec.decode(cells, decoder, entityTimes)),
    deleted: (compact.d ?? []).map((cell) => decodeKey(kind, cell, decoder)),
  };
}

export function encodeChanges(changes: EntityChanges): CompactChanges {
  const encoder = new Encoder();
  const compact: CompactChanges = {
    e: encodeCollection('entities', changes.entities, encoder),
    a: encodeCollection('aliases', changes.aliases, encoder),
    o: encodeCollection('domains', changes.domains, encoder),
    r: encodeCollection('roles', changes.roles, encoder),
    v: encodeCollection('vocabularies', changes.vocabularies, encoder),
    t: encodeCollection('terms', changes.terms, encoder),
  };
  const versions = Object.entries(changes.versions ?? {});
  if (versions.length > 0) {
    compact.x = versions.map(([projectId, count]): [number, number] => [encoder.ref(projectId, null), count]);
  }
  if (changes.minted !== undefined) compact.n = changes.minted;
  if (encoder.table.length > 0) compact.u = encoder.table;
  return compact;
}

/** The changes the compact form holds, or `null` when it does not decode. */
export function decodeChanges(compact: CompactChanges): EntityChanges | null {
  const decoder = new Decoder(compact.u ?? []);
  try {
    const entities = decodeCollection('entities', compact.e, decoder, new Map());
    // An alias added to an entity made here takes that entity's time
    const entityTimes = new Map((entities?.created ?? []).map((row) => [row.entity_id, row.created_at]));
    return {
      ...(entities === undefined ? {} : { entities }),
      aliases: decodeCollection('aliases', compact.a, decoder, entityTimes),
      domains: decodeCollection('domains', compact.o, decoder, entityTimes),
      roles: decodeCollection('roles', compact.r, decoder, entityTimes),
      vocabularies: decodeCollection('vocabularies', compact.v, decoder, entityTimes),
      terms: decodeCollection('terms', compact.t, decoder, entityTimes),
      versions: Object.fromEntries((compact.x ?? []).map(([ref, count]) => [decoder.ref(ref, null), count])),
      ...(compact.n === undefined ? {} : { minted: compact.n }),
    };
  } catch (error) {
    if (error instanceof CookieShapeError) return null;
    throw error;
  }
}
