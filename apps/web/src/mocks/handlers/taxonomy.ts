import { HttpResponse, type HttpHandler } from 'msw';

import { savedEntities, workspaceCaller, type WorkspaceCaller } from './access';
import {
  at,
  bodyError,
  booleanError,
  booleanQuery,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  nullErrors,
  offsetPaging,
  queryError,
  textError,
  uuidError,
} from './rules';
import { emptyChange } from './workspaces';
import {
  entityWorld,
  idMinter,
  withCreated,
  withDeleted,
  withEdited,
  workspaceOfRow,
  type EntityWorld,
  type StoredTerm,
  type StoredVocabulary,
} from '../entities-state';
import { termView, vocabularyView } from '../factories/entity';
import { MOCK_CREATED_AT, MOCK_WORKSPACE } from '../fixtures';
import { invalid, mock, noContent, problem } from '../respond';
import { MAX_SLUG, termSlug } from '../term-slug';
import type { Problem, TermNode, ValidationItem } from '@/lib/api/types';

/**
 * Vocabularies and their terms (19 section 3.5). A vocabulary is workspace-wide or belongs to one project;
 * its terms form a tree whose `path` is the slugs from the root. Slugs are made from names and are unique
 * among siblings; a `path` such as `CRM/CRM for Startups` creates the parents it lacks; a move recomputes the
 * subtree's paths (they are derived, so nothing else is written), may not make a cycle or pass 10 levels,
 * and renumbers the term's slug when it lands next to a sibling with it (`c` becomes `c-2`) unless a slug is
 * given; a term with children is deleted only with `cascade`. A flat vocabulary takes no parents. A member
 * limited to some projects cannot change a workspace-wide vocabulary or its terms (`403`). A vocabulary's
 * name is unique per scope and kind, ignoring case (migration 0010). Terms are listed in path order, level
 * by level, and vocabularies by name. Changes are kept in the entities cookie (../entities-state.ts), where a term keeps the
 * fixture time as its `created_at`.
 */

const KINDS = ['topic', 'cluster', 'product', 'service', 'market', 'campaign', 'persona', 'tag', 'custom'] as const;
const FORMATS = ['tree', 'flat'] as const;
const MAX_VOCABULARY_NAME = 100;
const MAX_TERM_NAME = 200;
const MAX_PATH = 1000;
const MAX_DESCRIPTION = 2000;
const MAX_TERMS = 500;
/** A term is at most this many levels from its root. */
const MAX_DEPTH = 10;
const MAX_QUERY_TEXT = 200;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TERM_FIELDS = ['name', 'parent_id', 'path', 'slug', 'description'] as const;

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

const VOCABULARY_TAKEN = 'A vocabulary of this scope and kind already has this name.';

/** The project of a vocabulary, or `null` for a workspace-wide one. */
const projectOf = (vocabulary: StoredVocabulary): string | null => vocabulary.project_id ?? null;

/**
 * `403` when the vocabulary is workspace-wide (`projectId` is `null`) and the caller is limited to some
 * projects: it is shared by every project, so such a member cannot change it.
 */
function sharedRefusal(
  request: Request,
  caller: WorkspaceCaller,
  projectId: string | null,
): HttpResponse<Problem> | null {
  return projectId === null && caller.access.membership.project_ids !== null
    ? problem(request, 'forbidden', {
        detail:
          'A workspace-wide vocabulary is shared by every project, so a member limited to some projects cannot change it.',
      })
    : null;
}

/** The vocabulary with this id the caller may see: of the workspace, and of a project they may open. */
function vocabularyIn(
  caller: WorkspaceCaller,
  vocabularyId: string | readonly string[] | undefined,
): StoredVocabulary | undefined {
  return visibleVocabularies(caller).find((vocabulary) => vocabulary.vocabulary_id === vocabularyId);
}

function visibleVocabularies(caller: WorkspaceCaller): StoredVocabulary[] {
  const projects = new Set(caller.projects.map((project) => project.project_id));
  return caller.world.vocabularies.filter((vocabulary) => {
    const project = projectOf(vocabulary);
    return (
      workspaceOfRow(vocabulary) === caller.access.workspace.workspace_id && (project === null || projects.has(project))
    );
  });
}

/** The terms of a vocabulary. */
const termsOf = (world: EntityWorld, vocabularyId: string): StoredTerm[] =>
  world.terms.filter((term) => term.vocabulary_id === vocabularyId);

/** The terms directly under `parentId` (`null` for the roots). */
const childrenOf = (terms: readonly StoredTerm[], parentId: string | null): StoredTerm[] =>
  terms.filter((term) => (term.parent_id ?? null) === parentId);

/** A term and everything below it. */
function subtreeOf(terms: readonly StoredTerm[], termId: string): StoredTerm[] {
  const found: StoredTerm[] = [];
  const queue = [termId];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const id = next;
    const term = terms.find((candidate) => candidate.term_id === id);
    if (!term || found.includes(term)) continue;
    found.push(term);
    queue.push(...childrenOf(terms, term.term_id).map((child) => child.term_id));
  }
  return found;
}

/** How many levels a term is from its root: 1 for a root. */
function depthOf(terms: readonly StoredTerm[], term: StoredTerm): number {
  let depth = 1;
  for (let parentId = term.parent_id ?? null; parentId !== null; depth += 1) {
    const id = parentId;
    parentId = terms.find((candidate) => candidate.term_id === id)?.parent_id ?? null;
  }
  return depth;
}

/** How many levels a term's subtree reaches below it: 0 for a leaf. */
const levelsBelow = (terms: readonly StoredTerm[], term: StoredTerm): number =>
  Math.max(...subtreeOf(terms, term.term_id).map((below) => depthOf(terms, below))) - depthOf(terms, term);

/** Text in code point order, as the API compares slugs and paths. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Path order, level by level: a parent comes right before its subtree, so `a-b` sorts after `a/b`. */
function byPath(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = byCodePoint(left[index] ?? '', right[index] ?? '');
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/** `slug`, or `slug-2`, `slug-3` and so on, whichever no sibling has. */
function freeSlug(siblings: readonly StoredTerm[], slug: string): string {
  const taken = new Set(siblings.map((term) => term.slug));
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n += 1) {
    const suffix = `-${String(n)}`;
    const candidate = `${slug.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The errors of a slug member. */
function slugError(value: unknown, path: string): ValidationItem[] {
  if (value === undefined || value === null) return [];
  const shape = textError(value, path, { max: MAX_SLUG });
  if (shape.length > 0) return shape;
  return typeof value === 'string' && SLUG.test(value)
    ? []
    : [bodyError(path, 'string_pattern_mismatch', 'Lower case letters and digits joined by hyphens.')];
}

const trimmedTextError = (value: unknown, path: string, max: number): ValidationItem[] =>
  value === undefined || value === null
    ? []
    : textError(typeof value === 'string' ? value.trim() : value, path, { max });

/** `CRM/CRM for Startups` as names from the root down, or `null` when a name is empty or too long. */
function pathNames(path: string): string[] | null {
  const names = path.split('/').map((name) => name.trim());
  return names.some((name) => name === '' || name.length > MAX_TERM_NAME) ? null : names;
}

interface TermValues {
  /** The names from the root down; one name under `parent_id` for a `name` input. */
  names: string[];
  parent_id: string | null;
  slug: string | null;
  description: string | null;
  /** Given as a `path`, whose existing terms are reused. */
  isPath: boolean;
  /** Where the input was, for its errors. */
  prefix: string;
}

/** A `TermInput` at `prefix`, or its errors. */
function termInput(value: unknown, prefix: string): TermValues | ValidationItem[] {
  if (!isRecord(value)) return [notAnObject(prefix)];
  const errors = [
    ...extraMembers(value, TERM_FIELDS, prefix),
    ...trimmedTextError(value.name, at(prefix, 'name'), MAX_TERM_NAME),
    ...uuidError(value.parent_id, at(prefix, 'parent_id'), { nullable: true }),
    ...(value.path === undefined || value.path === null
      ? []
      : textError(value.path, at(prefix, 'path'), { max: MAX_PATH })),
    ...slugError(value.slug, at(prefix, 'slug')),
    ...(value.description === undefined || value.description === null
      ? []
      : textError(value.description, at(prefix, 'description'), { min: 0, max: MAX_DESCRIPTION })),
  ];
  if (errors.length > 0) return errors;
  const name = typeof value.name === 'string' ? value.name.trim() : null;
  const path = typeof value.path === 'string' ? value.path : null;
  const parentId = typeof value.parent_id === 'string' ? value.parent_id : null;
  if ((name === null) === (path === null))
    return [bodyError(prefix, 'one_of', 'Give exactly one of `name` and `path`.')];
  if (path !== null && parentId !== null) {
    return [bodyError(prefix, 'one_of', 'A `path` starts at the root, so it takes no `parent_id`.')];
  }
  const names = path === null ? [name ?? ''] : pathNames(path);
  if (names === null) {
    return [
      bodyError(at(prefix, 'path'), 'invalid_term_path', 'A path is term names separated by `/`, none of them empty.'),
    ];
  }
  if (names.length > MAX_DEPTH) {
    return [bodyError(at(prefix, 'path'), 'too_deep', `A path has at most ${String(MAX_DEPTH)} levels.`)];
  }
  return {
    names,
    parent_id: parentId,
    slug: typeof value.slug === 'string' ? value.slug : null,
    description: typeof value.description === 'string' ? value.description : null,
    isPath: path !== null,
    prefix,
  };
}

/** One term, or `{ items }` of 1 to 500, or the errors. */
function termInputs(body: unknown): TermValues[] | ValidationItem[] {
  if (!(isRecord(body) && 'items' in body)) {
    const single = termInput(body, '');
    return Array.isArray(single) ? single : [single];
  }
  const errors = extraMembers(body, ['items']);
  const items = body.items;
  if (!Array.isArray(items)) return [...errors, bodyError('items', 'list_type', 'Input should be a valid list')];
  if (items.length === 0) return [...errors, bodyError('items', 'too_short', 'At least 1 item.')];
  if (items.length > MAX_TERMS)
    return [...errors, bodyError('items', 'too_long', `At most ${String(MAX_TERMS)} items.`)];
  const parsed = items.map((item: unknown, index) => termInput(item, at('items', index)));
  const all = [...errors, ...parsed.flatMap((item) => (Array.isArray(item) ? item : []))];
  return all.length > 0 ? all : parsed.filter((item): item is TermValues => !Array.isArray(item));
}

const isTermList = (value: TermValues[] | ValidationItem[]): value is TermValues[] =>
  value.every((item) => 'names' in item);

/** The tree of `terms` under `parentId`, in path order: siblings by slug. */
function treeOf(world: EntityWorld, terms: readonly StoredTerm[], parentId: string | null): TermNode[] {
  return childrenOf(terms, parentId)
    .sort((a, b) => byCodePoint(a.slug, b.slug))
    .map((term) => ({ ...termView(world, term), children: treeOf(world, terms, term.term_id) }));
}

/** By name, ignoring case, then by id, as the API lists them. */
const byName = (a: StoredVocabulary, b: StoredVocabulary): number =>
  byCodePoint(a.name.toLowerCase(), b.name.toLowerCase()) || byCodePoint(a.vocabulary_id, b.vocabulary_id);

const W = '/api/v1/workspaces/{workspace_id}';

export const taxonomyHandlers: HttpHandler[] = [
  mock('get', `${W}/vocabularies`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'data:read',
      query: ['offset', 'limit', 'filter[project_id]', 'filter[kind]'],
    });
    if (caller instanceof Response) return caller;
    const paging = offsetPaging(caller.url);
    const projectId = caller.url.searchParams.get('filter[project_id]');
    const kind = caller.url.searchParams.get('filter[kind]');
    const errors = [
      ...(Array.isArray(paging) ? paging : []),
      ...(kind === null || isOneOf(kind, KINDS)
        ? []
        : [queryError('filter[kind]', 'enum', `Allowed: ${KINDS.join(', ')}.`)]),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    if (projectId !== null && !caller.projects.some((project) => project.project_id === projectId)) {
      return problem(request, 'not_found');
    }
    // A project's list includes the workspace-wide vocabularies
    const rows = visibleVocabularies(caller)
      .filter(
        (vocabulary) => projectId === null || projectOf(vocabulary) === null || projectOf(vocabulary) === projectId,
      )
      .filter((vocabulary) => kind === null || vocabulary.kind === kind)
      .sort(byName);
    return HttpResponse.json({
      data: rows.slice(paging.offset, paging.offset + paging.limit).map((row) => vocabularyView(caller.world, row)),
      page: { offset: paging.offset, limit: paging.limit, total: rows.length },
    });
  }),

  mock('post', `${W}/vocabularies`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'taxonomy:write' });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...extraMembers(body, ['kind', 'name', 'project_id', 'is_hierarchical', 'is_single_valued']),
      ...['kind', 'name']
        .filter((name) => body[name] === undefined)
        .map((name) => bodyError(name, 'missing', 'Field required')),
      ...nullErrors(body, ['kind', 'name', 'is_hierarchical', 'is_single_valued']),
      ...enumError(body.kind === null ? undefined : body.kind, 'kind', KINDS),
      ...trimmedTextError(body.name, 'name', MAX_VOCABULARY_NAME),
      ...uuidError(body.project_id, 'project_id', { nullable: true }),
      ...booleanError(body.is_hierarchical === null ? undefined : body.is_hierarchical, 'is_hierarchical'),
      ...booleanError(body.is_single_valued === null ? undefined : body.is_single_valued, 'is_single_valued'),
    ];
    if (errors.length > 0) return invalid(request, errors);
    if (!isOneOf(body.kind, KINDS) || typeof body.name !== 'string')
      throw new Error('The kind and name were checked above');
    const projectId = typeof body.project_id === 'string' ? body.project_id : null;
    const refused = sharedRefusal(request, caller, projectId);
    if (refused) return refused;
    // The body names a project, so the route checks the caller's scope itself (19 section 2.2)
    if (projectId !== null && !caller.projects.some((project) => project.project_id === projectId)) {
      return invalid(request, [bodyError('project_id', 'project_unknown', 'A project is not in this workspace.')]);
    }
    const name = body.name.trim();
    const kind = body.kind;
    if (
      visibleVocabularies(caller).some(
        (vocabulary) =>
          projectOf(vocabulary) === projectId && vocabulary.kind === kind && sameName(vocabulary.name, name),
      )
    ) {
      return problem(request, 'duplicate', { detail: VOCABULARY_TAKEN });
    }
    const workspaceId = caller.access.workspace.workspace_id;
    const ids = idMinter(caller.entityChanges);
    const row: StoredVocabulary = {
      vocabulary_id: ids.next('vocabulary'),
      ...(workspaceId === MOCK_WORKSPACE.workspace_id ? {} : { workspace_id: workspaceId }),
      ...(projectId === null ? {} : { project_id: projectId }),
      kind: body.kind,
      name,
      ...(body.is_hierarchical === true ? { is_hierarchical: true } : {}),
      ...(body.is_single_valued === true ? { is_single_valued: true } : {}),
    };
    const next = ids.commit(withCreated(caller.entityChanges, 'vocabularies', row));
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: vocabularyView(entityWorld(next, caller.changes), row) },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('patch', `${W}/vocabularies/{vocabulary_id}`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'taxonomy:write' });
    if (caller instanceof Response) return caller;
    const vocabulary = vocabularyIn(caller, params.vocabulary_id);
    if (!vocabulary) return problem(request, 'not_found');
    const refused = sharedRefusal(request, caller, projectOf(vocabulary));
    if (refused) return refused;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const errors = [
      ...extraMembers(body, ['name', 'is_single_valued']),
      ...nullErrors(body, ['name', 'is_single_valued']),
      ...trimmedTextError(body.name, 'name', MAX_VOCABULARY_NAME),
      ...booleanError(body.is_single_valued === null ? undefined : body.is_single_valued, 'is_single_valued'),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    if (
      name !== undefined &&
      visibleVocabularies(caller).some(
        (other) =>
          other.vocabulary_id !== vocabulary.vocabulary_id &&
          projectOf(other) === projectOf(vocabulary) &&
          other.kind === vocabulary.kind &&
          sameName(other.name, name),
      )
    ) {
      return problem(request, 'duplicate', { detail: VOCABULARY_TAKEN });
    }
    // Turning on single-valued cannot fail yet: no subject has terms until keywords and prompts exist
    const next = withEdited(caller.entityChanges, 'vocabularies', vocabulary, {
      name,
      is_single_valued: typeof body.is_single_valued === 'boolean' ? body.is_single_valued : undefined,
    });
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    const saved = world.vocabularies.find((row) => row.vocabulary_id === vocabulary.vocabulary_id);
    if (!saved) throw new Error('The changed vocabulary is missing');
    return HttpResponse.json({ data: vocabularyView(world, saved) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('delete', `${W}/vocabularies/{vocabulary_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'taxonomy:write' });
    if (caller instanceof Response) return caller;
    const vocabulary = vocabularyIn(caller, params.vocabulary_id);
    if (!vocabulary) return problem(request, 'not_found');
    const refused = sharedRefusal(request, caller, projectOf(vocabulary));
    if (refused) return refused;
    // Terms go with their vocabulary
    let next = withDeleted(caller.entityChanges, 'vocabularies', vocabulary.vocabulary_id);
    for (const term of termsOf(caller.world, vocabulary.vocabulary_id)) next = withDeleted(next, 'terms', term.term_id);
    const cookie = savedEntities(request, next);
    return typeof cookie === 'string' ? noContent({ 'set-cookie': cookie }) : cookie;
  }),

  mock('get', `${W}/vocabularies/{vocabulary_id}/terms`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'data:read',
      query: ['format', 'filter[q]'],
    });
    if (caller instanceof Response) return caller;
    const vocabulary = vocabularyIn(caller, params.vocabulary_id);
    if (!vocabulary) return problem(request, 'not_found');
    const format = caller.url.searchParams.get('format') ?? 'tree';
    const text = caller.url.searchParams.get('filter[q]');
    const errors = [
      ...(isOneOf(format, FORMATS) ? [] : [queryError('format', 'enum', `Allowed: ${FORMATS.join(', ')}.`)]),
      ...(text !== null && text.length > MAX_QUERY_TEXT
        ? [queryError('filter[q]', 'string_too_long', `At most ${String(MAX_QUERY_TEXT)} characters.`)]
        : []),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const { world } = caller;
    const terms = termsOf(world, vocabulary.vocabulary_id);
    const needle = text?.trim().toLowerCase() ?? '';
    const matching = needle === '' ? terms : terms.filter((term) => term.name.toLowerCase().includes(needle));
    if (format === 'flat') {
      const data: TermNode[] = matching
        .map((term) => ({ ...termView(world, term), children: [] }))
        .sort((a, b) => byPath(a.path, b.path));
      return HttpResponse.json({ data });
    }
    // The tree keeps the ancestors of every match, so each match shows where it sits
    const kept = new Set<string>();
    for (const term of matching) {
      let current: StoredTerm | undefined = term;
      while (current && !kept.has(current.term_id)) {
        kept.add(current.term_id);
        const parentId: string | null = current.parent_id ?? null;
        current = parentId === null ? undefined : terms.find((candidate) => candidate.term_id === parentId);
      }
    }
    return HttpResponse.json({
      data: treeOf(
        world,
        terms.filter((term) => kept.has(term.term_id)),
        null,
      ),
    });
  }),

  mock('post', `${W}/vocabularies/{vocabulary_id}/terms`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'taxonomy:write' });
    if (caller instanceof Response) return caller;
    const vocabulary = vocabularyIn(caller, params.vocabulary_id);
    if (!vocabulary) return problem(request, 'not_found');
    const refused = sharedRefusal(request, caller, projectOf(vocabulary));
    if (refused) return refused;
    const body: unknown = await request.json();
    const inputs = termInputs(body);
    if (!isTermList(inputs)) return invalid(request, inputs);
    const flat = vocabulary.is_hierarchical !== true;
    // Each input sees the terms the ones before it made, so a batch can build a tree
    const terms = [...termsOf(caller.world, vocabulary.vocabulary_id)];
    const created: StoredTerm[] = [];
    const ids = idMinter(caller.entityChanges);
    for (const input of inputs) {
      let parentId = input.parent_id;
      const byPathInput = input.isPath;
      if (flat && (parentId !== null || input.names.length > 1)) {
        const where = at(input.prefix, byPathInput ? 'path' : 'parent_id');
        return invalid(request, [bodyError(where, 'not_hierarchical', 'The vocabulary is flat: no parents.')]);
      }
      if (parentId !== null) {
        const parent = terms.find((term) => term.term_id === parentId);
        if (!parent) {
          return invalid(request, [
            bodyError(at(input.prefix, 'parent_id'), 'parent_unknown', 'No such term in this vocabulary.'),
          ]);
        }
        if (depthOf(terms, parent) >= MAX_DEPTH) {
          return invalid(request, [
            bodyError(
              at(input.prefix, 'parent_id'),
              'too_deep',
              `A term is at most ${String(MAX_DEPTH)} levels from its root.`,
            ),
          ]);
        }
      }
      for (const [index, name] of input.names.entries()) {
        const last = index === input.names.length - 1;
        const siblings = childrenOf(terms, parentId);
        const existing = siblings.find((term) => sameName(term.name, name));
        // A path reuses the terms it names that exist; a path that exists adds nothing
        if (existing && byPathInput) {
          parentId = existing.term_id;
          continue;
        }
        if (existing) return problem(request, 'duplicate', { detail: `"${name}" is already a term at this place.` });
        if (last && input.slug !== null && siblings.some((term) => term.slug === input.slug)) {
          return problem(request, 'duplicate', { detail: 'A term at this place already has this slug.' });
        }
        const term: StoredTerm = {
          term_id: ids.next('term'),
          vocabulary_id: vocabulary.vocabulary_id,
          ...(parentId === null ? {} : { parent_id: parentId }),
          name,
          slug: last && input.slug !== null ? input.slug : freeSlug(siblings, termSlug(name)),
          ...(last && input.description !== null ? { description: input.description } : {}),
          created_at: MOCK_CREATED_AT,
        };
        terms.push(term);
        created.push(term);
        parentId = term.term_id;
      }
    }
    let next = caller.entityChanges;
    for (const term of created) next = withCreated(next, 'terms', term);
    next = ids.commit(next);
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    return HttpResponse.json(
      { data: created.map((term) => termView(world, term)) },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('patch', `${W}/terms/{term_id}`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'taxonomy:write' });
    if (caller instanceof Response) return caller;
    const term = caller.world.terms.find((row) => row.term_id === params.term_id);
    const vocabulary = term ? vocabularyIn(caller, term.vocabulary_id) : undefined;
    if (!term || !vocabulary) return problem(request, 'not_found');
    const refused = sharedRefusal(request, caller, projectOf(vocabulary));
    if (refused) return refused;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const empty = emptyChange(request, body);
    if (empty) return empty;
    const errors = [
      ...extraMembers(body, ['name', 'slug', 'parent_id', 'description']),
      ...nullErrors(body, ['name', 'slug']),
      ...trimmedTextError(body.name, 'name', MAX_TERM_NAME),
      ...slugError(body.slug, 'slug'),
      ...uuidError(body.parent_id, 'parent_id', { nullable: true }),
      ...(body.description === undefined || body.description === null
        ? []
        : textError(body.description, 'description', { min: 0, max: MAX_DESCRIPTION })),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const terms = termsOf(caller.world, vocabulary.vocabulary_id);
    const currentParent = term.parent_id ?? null;
    const parentId = 'parent_id' in body ? (typeof body.parent_id === 'string' ? body.parent_id : null) : currentParent;
    const moving = parentId !== currentParent;
    if (moving && parentId !== null) {
      if (vocabulary.is_hierarchical !== true) {
        return invalid(request, [bodyError('parent_id', 'not_hierarchical', 'The vocabulary is flat.')]);
      }
      const parent = terms.find((candidate) => candidate.term_id === parentId);
      if (!parent) {
        return invalid(request, [bodyError('parent_id', 'parent_unknown', 'No such term in this vocabulary.')]);
      }
      // A term cannot move under itself or under one of its own terms
      if (subtreeOf(terms, term.term_id).some((below) => below.term_id === parentId)) {
        return problem(request, 'cycle_detected', { detail: 'The parent is this term or one under it.' });
      }
      if (depthOf(terms, parent) + 1 + levelsBelow(terms, term) > MAX_DEPTH) {
        return invalid(request, [
          bodyError('parent_id', 'too_deep', `A term is at most ${String(MAX_DEPTH)} levels from its root.`),
        ]);
      }
    }
    const name = typeof body.name === 'string' ? body.name.trim() : term.name;
    const slugGiven = typeof body.slug === 'string';
    const siblings = childrenOf(terms, parentId).filter((other) => other.term_id !== term.term_id);
    if ((moving || name !== term.name) && siblings.some((other) => sameName(other.name, name))) {
      return problem(request, 'duplicate', { detail: `"${name}" is already a term at this place.` });
    }
    const taken = (candidate: string): boolean => siblings.some((other) => other.slug === candidate);
    let slug = typeof body.slug === 'string' ? body.slug : term.slug;
    if (slugGiven && (moving || slug !== term.slug) && taken(slug)) {
      return problem(request, 'duplicate', { detail: 'A term at this place already has this slug.' });
    }
    // Moved without a slug next to a sibling that has its slug, the term is numbered as an insert is
    if (!slugGiven && moving && taken(slug)) slug = freeSlug(siblings, slug);
    const next = withEdited(caller.entityChanges, 'terms', term, {
      name: typeof body.name === 'string' ? name : undefined,
      slug: slug === term.slug ? undefined : slug,
      parent_id: 'parent_id' in body ? parentId : undefined,
      description: 'description' in body ? (typeof body.description === 'string' ? body.description : null) : undefined,
    });
    const cookie = savedEntities(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = entityWorld(next, caller.changes);
    const saved = world.terms.find((row) => row.term_id === term.term_id);
    if (!saved) throw new Error('The changed term is missing');
    return HttpResponse.json({ data: termView(world, saved) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('delete', `${W}/terms/{term_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'taxonomy:write',
      query: ['cascade'],
    });
    if (caller instanceof Response) return caller;
    const term = caller.world.terms.find((row) => row.term_id === params.term_id);
    const vocabulary = term ? vocabularyIn(caller, term.vocabulary_id) : undefined;
    if (!term || !vocabulary) return problem(request, 'not_found');
    const refused = sharedRefusal(request, caller, projectOf(vocabulary));
    if (refused) return refused;
    const cascade = booleanQuery(caller.url, 'cascade', false);
    if (typeof cascade !== 'boolean') return invalid(request, [cascade]);
    const terms = termsOf(caller.world, vocabulary.vocabulary_id);
    const subtree = subtreeOf(terms, term.term_id);
    if (subtree.length > 1 && !cascade) {
      return problem(request, 'has_children', { detail: 'Delete its terms first, or delete with cascade.' });
    }
    let next = caller.entityChanges;
    for (const row of subtree) next = withDeleted(next, 'terms', row.term_id);
    const cookie = savedEntities(request, next);
    return typeof cookie === 'string' ? noContent({ 'set-cookie': cookie }) : cookie;
  }),
];
