import { HttpResponse, type HttpHandler } from 'msw';

import { applyPatch, patchServiceErrors, patchShapeErrors } from './keyword-patch';
import {
  createItem,
  createServiceErrors,
  createShapeErrors,
  entityErrors,
  FILTER_NAMES,
  filteredRows,
  groupErrors,
  idListError,
  keywordProjectCaller,
  now,
  parseInclude,
  parseSort,
  queryFilter,
  quotaProblem,
  savedKeywords,
  selectedRows,
  selectionErrors,
  sortRows,
  termErrors,
  type KeywordProjectCaller,
} from './keyword-rules';
import { mergeTerms, plan, written } from './keyword-writes';
import { scheduleCheckFor } from './operations-rules';
import { at, bodyError, booleanError, extraMembers, isRecord, notAnObject, pageRequest, cursorPage } from './rules';
import {
  configHistoryView,
  overridesOf,
  trackedKeywordDetailView,
  trackedKeywordRowView,
  trackedKeywordView,
} from '../factories/keyword';
import { entityRefView } from '../factories/entity';
import { nextRunAt } from '../factories/operations';
import { operationWorld, readOperationChanges } from '../operations-state';
import {
  keywordIdMinter,
  keywordWorld,
  withMembers,
  withOverrides,
  withTermLinks,
  withTracked,
  type KeywordWorld,
  type StoredTracked,
} from '../keywords-state';
import { invalid, mock, noContent, problem } from '../respond';
import type { ValidationItem } from '@/lib/api/types';

/**
 * A project's tracked keywords (19 section 3.5, backend plan D3, D4 and D15): the cursor-paged list with
 * filters, sorts, `include` and `page.total`; tracking one keyword or up to 1,000 with restore of a deleted
 * identity and the workspace quota; a keyword's detail, settings with configuration versions, competitor
 * overrides and history; soft delete; and the bulk update and archive of a selection.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const LIST_QUERY = ['sort', 'include', 'cursor', 'limit', ...FILTER_NAMES.map((name) => `filter[${name}]`)];
const MAX_BULK_ITEMS = 1000;

/** The live tracked keyword of the project with this id. */
const liveRow = (caller: KeywordProjectCaller, id: string | readonly string[] | undefined): StoredTracked | undefined =>
  caller.keywords.tracked.find(
    (row) => row.tracked_keyword_id === id && row.project_id === caller.project.project_id && row.deleted_at === null,
  );

export const trackedKeywordHandlers: HttpHandler[] = [
  mock('get', `${P}/tracked-keywords`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: LIST_QUERY,
    });
    if (caller instanceof Response) return caller;
    const filter = queryFilter(caller.url);
    const sort = parseSort(caller.url.searchParams.get('sort'));
    const include = parseInclude(caller.url);
    const paging = pageRequest(caller.url);
    const errors = [
      ...(Array.isArray(filter) ? filter : []),
      ...(Array.isArray(sort) ? [] : [sort]),
      ...(include instanceof Set ? [] : [include]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (
      errors.length > 0 ||
      Array.isArray(filter) ||
      !Array.isArray(sort) ||
      !(include instanceof Set) ||
      Array.isArray(paging)
    ) {
      return invalid(request, errors);
    }
    const rows = sortRows(caller.keywords, filteredRows(caller, filter), sort);
    // The cursor holds what it was made for: the filters and the sort, not `include` or `limit`
    const scope = new URLSearchParams(
      [...caller.url.searchParams.entries()].filter(
        ([name]) => name !== 'cursor' && name !== 'limit' && name !== 'include',
      ),
    );
    scope.sort();
    const page = cursorPage(rows, paging, scope.toString());
    if (page === null) return problem(request, 'invalid_cursor');
    return HttpResponse.json({
      data: page.data.map((row) => trackedKeywordRowView(caller.keywords, caller.world, row, include)),
      page: { ...page.page, total: rows.length },
    });
  }),

  mock('post', `${P}/tracked-keywords`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const shape = createShapeErrors(body, '');
    if (shape.length > 0) return invalid(request, shape);
    const item = createItem(body);
    const service = createServiceErrors(caller, item, '', scheduleCheckFor(cookies));
    if (service.length > 0) return invalid(request, service);
    const minter = keywordIdMinter(caller.keywordChanges);
    const planned = plan(caller, item, caller.keywordChanges, minter.next);
    const duplicate = planned.rows.find((entry) => entry.kind === 'duplicate');
    if (duplicate !== undefined) {
      return problem(request, 'duplicate', {
        detail: 'The project already tracks this keyword at this location, language and device.',
        existing_id: duplicate.row.tracked_keyword_id,
      });
    }
    const over = quotaProblem(request, caller, planned.rows.length);
    if (over) return over;
    const rows = planned.rows.map((entry) => entry.row);
    const next = minter.commit(written(caller, planned.changes, planned.rows, item));
    const cookie = savedKeywords(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = keywordWorld(next);
    return HttpResponse.json(
      { data: rows.map((row) => trackedKeywordView(world, row)) },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('post', `${P}/tracked-keywords/bulk-create`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const items = body.items;
    const onDuplicate = body.on_duplicate ?? 'skip';
    const shapeErrors: ValidationItem[] = [
      ...extraMembers(body, ['items', 'on_duplicate']),
      ...(onDuplicate === 'skip' || onDuplicate === 'merge_terms'
        ? []
        : [bodyError('on_duplicate', 'enum', 'Allowed: skip, merge_terms.')]),
    ];
    if (!Array.isArray(items))
      shapeErrors.push(
        bodyError('items', items === undefined ? 'missing' : 'list_type', 'A list of 1 to 1,000 keywords.'),
      );
    else if (items.length < 1 || items.length > MAX_BULK_ITEMS)
      shapeErrors.push(
        bodyError('items', items.length < 1 ? 'too_short' : 'too_long', 'A list of 1 to 1,000 keywords.'),
      );
    else
      items.forEach((value, index) =>
        shapeErrors.push(
          ...(isRecord(value) ? createShapeErrors(value, at('items', index)) : [notAnObject(at('items', index))]),
        ),
      );
    if (shapeErrors.length > 0 || !Array.isArray(items)) return invalid(request, shapeErrors);
    const scheduleIsKnown = scheduleCheckFor(cookies);
    const minter = keywordIdMinter(caller.keywordChanges);
    let changes = caller.keywordChanges;
    const created: string[] = [];
    const skipped: { index: number; existing_id: string }[] = [];
    const rejected: { index: number; code: string; message: string }[] = [];
    let requested = 0;
    items.forEach((value, index) => {
      if (!isRecord(value)) return;
      const item = createItem(value);
      const [first] = createServiceErrors(caller, item, '', scheduleIsKnown);
      if (first !== undefined) {
        rejected.push({ index, code: first.code, message: first.message });
        return;
      }
      // Each item sees the ones before it, so a repeat in the request is skipped like an existing row
      const planned = plan(caller, item, changes, minter.next);
      const fresh = planned.rows.filter((entry) => entry.kind !== 'duplicate');
      changes = written(caller, planned.changes, fresh, item);
      requested += fresh.length;
      created.push(...fresh.map((entry) => entry.row.tracked_keyword_id));
      for (const entry of planned.rows.filter((candidate) => candidate.kind === 'duplicate')) {
        skipped.push({ index, existing_id: entry.row.tracked_keyword_id });
        if (onDuplicate === 'merge_terms') changes = mergeTerms(caller, changes, entry.row.tracked_keyword_id, item);
      }
    });
    const over = quotaProblem(request, caller, requested);
    if (over) return over;
    const cookie = savedKeywords(request, minter.commit(changes));
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json({ data: { created, skipped, rejected } }, { headers: { 'set-cookie': cookie } });
  }),

  mock('get', `${P}/tracked-keywords/{tracked_keyword_id}`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const row = liveRow(caller, params.tracked_keyword_id);
    if (row === undefined) return problem(request, 'not_found');
    const operations = operationWorld(readOperationChanges(cookies));
    const schedule = operations.schedules.find(
      (candidate) => candidate.schedule_id === row.schedule_id && candidate.deleted_at === null,
    );
    const scheduleRef =
      schedule === undefined
        ? null
        : { schedule_id: schedule.schedule_id, name: schedule.name, next_run_at: nextRunAt(schedule, Date.now()) };
    return HttpResponse.json({ data: trackedKeywordDetailView(caller.keywords, caller.world, row, scheduleRef) });
  }),

  mock('patch', `${P}/tracked-keywords/{tracked_keyword_id}`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const row = liveRow(caller, params.tracked_keyword_id);
    if (row === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    const shape = patchShapeErrors(body, '');
    if (shape.length > 0 || !isRecord(body)) return invalid(request, shape);
    const service = patchServiceErrors(body, '', caller.project.project_id, scheduleCheckFor(cookies));
    if (service.length > 0) return invalid(request, service);
    const patched = applyPatch(row, body, caller.session.user.user_id);
    if (!patched.changed) return HttpResponse.json({ data: trackedKeywordView(caller.keywords, row) });
    if (patched.unarchived) {
      const over = quotaProblem(request, caller, 1);
      if (over) return over;
    }
    const next = withTracked(caller.keywordChanges, patched.row);
    const cookie = savedKeywords(request, next);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: trackedKeywordView(keywordWorld(next), patched.row) },
      { headers: { 'set-cookie': cookie } },
    );
  }),

  mock('delete', `${P}/tracked-keywords/{tracked_keyword_id}`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const row = liveRow(caller, params.tracked_keyword_id);
    if (row === undefined) return problem(request, 'not_found');
    const deletedAt = now();
    const cookie = savedKeywords(
      request,
      withTracked(caller.keywordChanges, { ...row, deleted_at: deletedAt, updated_at: deletedAt }),
    );
    if (typeof cookie !== 'string') return cookie;
    return noContent({ 'set-cookie': cookie });
  }),

  mock('put', `${P}/tracked-keywords/{tracked_keyword_id}/competitors`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const row = liveRow(caller, params.tracked_keyword_id);
    if (row === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const shape = [
      ...extraMembers(body, ['include', 'exclude']),
      ...idListError(body.include, 'include', 100),
      ...idListError(body.exclude, 'exclude', 100),
    ];
    const include = Array.isArray(body.include)
      ? body.include.filter((id): id is string => typeof id === 'string')
      : [];
    const exclude = Array.isArray(body.exclude)
      ? body.exclude.filter((id): id is string => typeof id === 'string')
      : [];
    if (shape.length === 0 && include.some((id) => exclude.includes(id))) {
      shape.push(bodyError('', 'value_error', 'An entity is either included or excluded.'));
    }
    if (shape.length > 0) return invalid(request, shape);
    const service = [...entityErrors(caller, include, 'include'), ...entityErrors(caller, exclude, 'exclude')];
    if (service.length > 0) return invalid(request, service);
    const id = row.tracked_keyword_id;
    const next = withOverrides(caller.keywordChanges, id, [
      ...include.map((entity_id) => ({ tracked_keyword_id: id, entity_id, mode: 'include' as const })),
      ...exclude.map((entity_id) => ({ tracked_keyword_id: id, entity_id, mode: 'exclude' as const })),
    ]);
    const cookie = savedKeywords(request, next);
    if (typeof cookie !== 'string') return cookie;
    const world = keywordWorld(next);
    const projectId = caller.project.project_id;
    // Effective: the project's competitors, less the excluded, plus the included
    const competitors = new Set(
      caller.world.roles
        .filter(
          (role) =>
            role.project_id === projectId &&
            role.role === 'competitor' &&
            (role.track_seo ?? true) &&
            (role.removed_at ?? null) === null,
        )
        .map((role) => role.entity_id),
    );
    for (const entityId of exclude) competitors.delete(entityId);
    for (const entityId of include) competitors.add(entityId);
    const effective = caller.world.entities
      .filter((entity) => competitors.has(entity.entity_id))
      .sort(
        (a, b) =>
          a.canonical_name.toLowerCase().localeCompare(b.canonical_name.toLowerCase()) ||
          a.entity_id.localeCompare(b.entity_id),
      )
      .map((entity) =>
        entityRefView(
          entity,
          caller.world.roles.find(
            (role) =>
              role.project_id === projectId &&
              role.entity_id === entity.entity_id &&
              (role.removed_at ?? null) === null,
          ),
        ),
      );
    return HttpResponse.json(
      { data: { effective_competitors: effective, overrides: overridesOf(world, caller.world, row) } },
      { headers: { 'set-cookie': cookie } },
    );
  }),

  mock('get', `${P}/tracked-keywords/{tracked_keyword_id}/config-history`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const row = liveRow(caller, params.tracked_keyword_id);
    if (row === undefined) return problem(request, 'not_found');
    return HttpResponse.json({ data: configHistoryView(row) });
  }),

  mock('post', `${P}/tracked-keywords/bulk-update`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const LINKS = ['add_group_ids', 'remove_group_ids', 'add_term_ids', 'remove_term_ids'] as const;
    const set = body.set ?? null;
    const shape = [
      ...extraMembers(body, ['ids', 'filter', 'set', ...LINKS]),
      ...selectionErrors(body),
      ...(set === null ? [] : patchShapeErrors(set, 'set')),
      ...LINKS.flatMap((name) => idListError(body[name], name, 100)),
    ];
    if (shape.length > 0) return invalid(request, shape);
    const ids = (name: (typeof LINKS)[number]): string[] =>
      Array.isArray(body[name]) ? body[name].filter((id): id is string => typeof id === 'string') : [];
    const service = [
      ...(isRecord(set) ? patchServiceErrors(set, 'set', caller.project.project_id, scheduleCheckFor(cookies)) : []),
      ...groupErrors(caller, ids('add_group_ids'), 'add_group_ids'),
      ...groupErrors(caller, ids('remove_group_ids'), 'remove_group_ids'),
      ...termErrors(caller, ids('add_term_ids'), 'add_term_ids'),
      ...termErrors(caller, ids('remove_term_ids'), 'remove_term_ids', { removing: true }),
    ];
    if (service.length > 0) return invalid(request, service);
    const selected = selectedRows(request, caller, body);
    if (selected instanceof Response) return selected;
    const singleValued = new Set(
      caller.world.vocabularies
        .filter((vocabulary) => vocabulary.is_single_valued === true)
        .map((v) => v.vocabulary_id),
    );
    let changes = caller.keywordChanges;
    let updated = 0;
    let versions = 0;
    let unarchived = 0;
    for (const row of selected) {
      const id = row.tracked_keyword_id;
      const patched = isRecord(set) ? applyPatch(row, set, caller.session.user.user_id) : null;
      const before = keywordWorld(changes);
      const linksBefore = linkKey(before, id);
      if (patched?.changed === true) changes = withTracked(changes, patched.row);
      changes = withMembers(
        changes,
        ids('add_group_ids').map((group_id) => ({ group_id, tracked_keyword_id: id })),
        ids('remove_group_ids').map((group_id) => ({ group_id, tracked_keyword_id: id })),
      );
      // A term of a single-valued vocabulary takes the place of the keyword's other term there
      const added = new Set(ids('add_term_ids'));
      const replacedVocabularies = new Set(
        caller.world.terms
          .filter((term) => added.has(term.term_id) && singleValued.has(term.vocabulary_id))
          .map((term) => term.vocabulary_id),
      );
      const displaced = before.termLinks
        .filter((link) => link.tracked_keyword_id === id && !added.has(link.term_id))
        .filter((link) => {
          const vocabulary = caller.world.terms.find((term) => term.term_id === link.term_id)?.vocabulary_id;
          return vocabulary !== undefined && replacedVocabularies.has(vocabulary);
        });
      changes = withTermLinks(
        changes,
        [...added].map((term_id) => ({ term_id, tracked_keyword_id: id })),
        [...ids('remove_term_ids').map((term_id) => ({ term_id, tracked_keyword_id: id })), ...displaced],
      );
      const linksMoved = linkKey(keywordWorld(changes), id) !== linksBefore;
      if (patched?.changed === true || linksMoved) updated += 1;
      if (patched?.versioned === true) versions += 1;
      if (patched?.unarchived === true) unarchived += 1;
    }
    if (unarchived > 0) {
      const over = quotaProblem(request, caller, unarchived);
      if (over) return over;
    }
    const cookie = savedKeywords(request, changes);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: { matched: selected.length, updated, config_versions_created: versions } },
      { headers: { 'set-cookie': cookie } },
    );
  }),

  mock('post', `${P}/tracked-keywords/bulk-archive`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const shape = [
      ...extraMembers(body, ['ids', 'filter', 'archive']),
      ...(body.archive === undefined
        ? [bodyError('archive', 'missing', 'Field required')]
        : booleanError(body.archive, 'archive')),
      ...selectionErrors(body),
    ];
    if (shape.length > 0) return invalid(request, shape);
    const selected = selectedRows(request, caller, body);
    if (selected instanceof Response) return selected;
    const active = body.archive !== true;
    const changing = selected.filter((row) => row.is_active !== active);
    if (active) {
      const over = quotaProblem(request, caller, changing.length);
      if (over) return over;
    }
    const changedAt = now();
    const changes = changing.reduce(
      (next, row) => withTracked(next, { ...row, is_active: active, updated_at: changedAt }),
      caller.keywordChanges,
    );
    const cookie = savedKeywords(request, changes);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: { matched: selected.length, updated: changing.length } },
      { headers: { 'set-cookie': cookie } },
    );
  }),
];

/** A tracked keyword's groups and terms as one comparable text, so a swap counts as a change. */
function linkKey(world: KeywordWorld, trackedKeywordId: string): string {
  const groups = world.members.filter((m) => m.tracked_keyword_id === trackedKeywordId).map((m) => m.group_id);
  const terms = world.termLinks.filter((l) => l.tracked_keyword_id === trackedKeywordId).map((l) => l.term_id);
  return `${groups.sort().join(',')}|${terms.sort().join(',')}`;
}
