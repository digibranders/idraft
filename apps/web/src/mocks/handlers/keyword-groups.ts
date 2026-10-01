import { HttpResponse, type HttpHandler } from 'msw';

import { idListError, keywordProjectCaller, liveTrackedOf, now, savedKeywords } from './keyword-rules';
import { bodyError, extraMembers, isRecord, notAnObject, queryError, textError, uuidError } from './rules';
import { groupAndBelow, groupTree, groupView } from '../factories/keyword';
import {
  keywordIdMinter,
  keywordWorld,
  withGroup,
  withMembers,
  withoutGroups,
  type KeywordWorld,
  type StoredGroup,
} from '../keywords-state';
import { invalid, mock, noContent, problem } from '../respond';
import type { ValidationItem } from '@/lib/api/types';

/**
 * A project's keyword groups (19 section 3.5, backend plan D2): a tree whose names are unique among siblings,
 * moved without making a cycle, deleted for good with the groups under them (their keywords stay, out of
 * the group), and members added and removed in bulk.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const MAX_NAME = 100;

const groupsOf = (world: KeywordWorld, projectId: string): StoredGroup[] =>
  world.groups.filter((group) => group.project_id === projectId);

/** A sibling with the same name, ignoring case, other than `except`. */
const sibling = (
  world: KeywordWorld,
  projectId: string,
  parentId: string | null,
  name: string,
  except: string | null,
): StoredGroup | undefined =>
  groupsOf(world, projectId).find(
    (group) =>
      group.parent_id === parentId &&
      group.group_id !== except &&
      group.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

/** A name as the API checks and keeps it: trimmed first, then 1 to 100 characters. */
const trimmedName = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

const shapeErrors = (body: Readonly<Record<string, unknown>>, { create }: { create: boolean }): ValidationItem[] => [
  ...extraMembers(body, ['name', 'parent_id']),
  ...(create && body.name === undefined ? [bodyError('name', 'missing', 'Field required')] : []),
  ...(body.name === null ? [bodyError('name', 'null_not_allowed', 'Cannot be null.')] : []),
  ...textError(trimmedName(body.name) ?? undefined, 'name', { max: MAX_NAME }),
  ...uuidError(body.parent_id, 'parent_id', { nullable: true }),
  ...(!create && Object.keys(body).length === 0 ? [bodyError('', 'value_error', 'Change at least one field.')] : []),
];

const duplicateName = (request: Request): Response =>
  problem(request, 'duplicate', { detail: 'A group next to it already has this name.' });

export const keywordGroupHandlers: HttpHandler[] = [
  mock('get', `${P}/keyword-groups`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['format'],
    });
    if (caller instanceof Response) return caller;
    const format = caller.url.searchParams.get('format') ?? 'tree';
    if (format !== 'tree' && format !== 'flat') {
      return invalid(request, [queryError('format', 'enum', 'Allowed: tree, flat.')]);
    }
    const tree = groupTree(caller.keywords, caller.project.project_id);
    if (format === 'tree') return HttpResponse.json({ data: tree });
    // Flat: every group, by path, without children
    const flat = groupsOf(caller.keywords, caller.project.project_id)
      .map((group) => ({ ...groupView(caller.keywords, group), children: [] }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.group_id.localeCompare(b.group_id));
    return HttpResponse.json({ data: flat });
  }),

  mock('post', `${P}/keyword-groups`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = shapeErrors(body, { create: true });
    if (errors.length > 0 || typeof body.name !== 'string') return invalid(request, errors);
    const projectId = caller.project.project_id;
    const parentId = typeof body.parent_id === 'string' ? body.parent_id : null;
    if (parentId !== null && !groupsOf(caller.keywords, projectId).some((group) => group.group_id === parentId)) {
      return invalid(request, [bodyError('parent_id', 'group_unknown', 'No group of this project has this id.')]);
    }
    const name = body.name.trim();
    if (sibling(caller.keywords, projectId, parentId, name, null)) return duplicateName(request);
    const minter = keywordIdMinter(caller.keywordChanges);
    const row: StoredGroup = {
      group_id: minter.next('group'),
      project_id: projectId,
      name,
      parent_id: parentId,
      created_at: now(),
    };
    const next = minter.commit(withGroup(caller.keywordChanges, row));
    const cookie = savedKeywords(request, next);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: groupView(keywordWorld(next), row) },
      { status: 201, headers: { 'set-cookie': cookie } },
    );
  }),

  mock('patch', `${P}/keyword-groups/{group_id}`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const projectId = caller.project.project_id;
    const current = groupsOf(caller.keywords, projectId).find((group) => group.group_id === params.group_id);
    if (current === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = shapeErrors(body, { create: false });
    if (errors.length > 0) return invalid(request, errors);
    const parentId =
      'parent_id' in body ? (typeof body.parent_id === 'string' ? body.parent_id : null) : current.parent_id;
    if (parentId !== null && !groupsOf(caller.keywords, projectId).some((group) => group.group_id === parentId)) {
      return invalid(request, [bodyError('parent_id', 'group_unknown', 'No group of this project has this id.')]);
    }
    if (parentId !== null && groupAndBelow(caller.keywords, current.group_id).has(parentId)) {
      return problem(request, 'cycle_detected', { detail: 'A group cannot move under itself or a group under it.' });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : current.name;
    if (sibling(caller.keywords, projectId, parentId, name, current.group_id)) return duplicateName(request);
    const row: StoredGroup = { ...current, name, parent_id: parentId };
    if (row.name === current.name && row.parent_id === current.parent_id) {
      return HttpResponse.json({ data: groupView(caller.keywords, current) });
    }
    const next = withGroup(caller.keywordChanges, row);
    const cookie = savedKeywords(request, next);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json({ data: groupView(keywordWorld(next), row) }, { headers: { 'set-cookie': cookie } });
  }),

  mock('delete', `${P}/keyword-groups/{group_id}`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const current = groupsOf(caller.keywords, caller.project.project_id).find(
      (group) => group.group_id === params.group_id,
    );
    if (current === undefined) return problem(request, 'not_found');
    const gone = groupAndBelow(caller.keywords, current.group_id);
    const members = caller.keywords.members.filter((member) => gone.has(member.group_id));
    const next = withoutGroups(withMembers(caller.keywordChanges, [], members), gone);
    const cookie = savedKeywords(request, next);
    if (typeof cookie !== 'string') return cookie;
    return noContent({ 'set-cookie': cookie });
  }),

  mock('post', `${P}/keyword-groups/{group_id}/members`, async ({ request, cookies, params }) => {
    const result = await changeMembers(request, cookies, params, 'add');
    if (result instanceof Response) return result;
    return HttpResponse.json({ data: { added: result.count } }, { headers: { 'set-cookie': result.cookie } });
  }),

  mock('post', `${P}/keyword-groups/{group_id}/members/remove`, async ({ request, cookies, params }) => {
    const result = await changeMembers(request, cookies, params, 'remove');
    if (result instanceof Response) return result;
    return HttpResponse.json({ data: { removed: result.count } }, { headers: { 'set-cookie': result.cookie } });
  }),
];

/**
 * Adds live tracked keywords of the project to the group, or takes them out. Ids of other projects or of
 * deleted keywords change nothing, and neither does a keyword already in (or not in) the group.
 */
async function changeMembers(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  params: {
    workspace_id?: string | readonly string[];
    project_id?: string | readonly string[];
    group_id?: string | readonly string[];
  },
  op: 'add' | 'remove',
): Promise<{ count: number; cookie: string } | Response> {
  const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
    permission: 'keywords:write',
  });
  if (caller instanceof Response) return caller;
  const group = groupsOf(caller.keywords, caller.project.project_id).find(
    (candidate) => candidate.group_id === params.group_id,
  );
  if (group === undefined) return problem(request, 'not_found');
  const body: unknown = await request.json();
  if (!isRecord(body)) return invalid(request, [notAnObject()]);
  const errors = [
    ...extraMembers(body, ['tracked_keyword_ids']),
    ...(body.tracked_keyword_ids === undefined
      ? [bodyError('tracked_keyword_ids', 'missing', 'Field required')]
      : idListError(body.tracked_keyword_ids, 'tracked_keyword_ids', 5000, { min: 1 })),
  ];
  if (errors.length > 0 || !Array.isArray(body.tracked_keyword_ids)) return invalid(request, errors);
  const wanted = new Set(body.tracked_keyword_ids);
  const inGroup = new Set(
    caller.keywords.members
      .filter((member) => member.group_id === group.group_id)
      .map((member) => member.tracked_keyword_id),
  );
  const touched = liveTrackedOf(caller.keywords, caller.project.project_id)
    .filter((row) => wanted.has(row.tracked_keyword_id))
    .filter((row) => (op === 'add' ? !inGroup.has(row.tracked_keyword_id) : inGroup.has(row.tracked_keyword_id)))
    .map((row) => ({ group_id: group.group_id, tracked_keyword_id: row.tracked_keyword_id }));
  const next =
    op === 'add' ? withMembers(caller.keywordChanges, touched, []) : withMembers(caller.keywordChanges, [], touched);
  const cookie = savedKeywords(request, next);
  if (typeof cookie !== 'string') return cookie;
  return { count: touched.length, cookie };
}
