import { HttpResponse, type HttpHandler } from 'msw';

import { idListError, keywordProjectCaller, liveTrackedOf, now, savedKeywords } from './keyword-rules';
import { bodyError, extraMembers, isRecord, notAnObject, queryError, textError, uuidError } from './rules';
import { byGroupPath, groupAndBelow, groupPath, groupTree, groupView } from '../factories/keyword';
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
  // A path joins names with "/", so a name cannot hold one
  ...(typeof body.name === 'string' && body.name.includes('/')
    ? [bodyError('name', 'slash_not_allowed', 'A group name cannot hold "/".')]
    : []),
  ...uuidError(body.parent_id, 'parent_id', { nullable: true }),
  ...(!create && Object.keys(body).length === 0 ? [bodyError('', 'value_error', 'Change at least one field.')] : []),
];

/** Levels a tree may have, and the bytes a path may hold (backend as built). */
const MAX_DEPTH = 10;
const MAX_PATH_BYTES = 2048;
const pathBytes = (path: string): number => new TextEncoder().encode(path).length;

/** Levels from the root down to a group: a root group is level 1, no group is level 0. */
function levelOf(world: KeywordWorld, groupId: string | null): number {
  let level = 0;
  let current = groupId;
  while (current !== null && level <= MAX_DEPTH * 2) {
    const group = world.groups.find((candidate) => candidate.group_id === current);
    if (group === undefined) break;
    level += 1;
    current = group.parent_id;
  }
  return level;
}

/**
 * The errors of putting a group named `name` under `parentId`: too deep for its subtree, or a path too long
 * for its longest descendant. `current` is the group being moved or renamed, if any.
 */
export function placeErrors(
  world: KeywordWorld,
  parentId: string | null,
  name: string,
  current: StoredGroup | null,
): ValidationItem[] {
  const parent = parentId === null ? undefined : world.groups.find((group) => group.group_id === parentId);
  const path = parent === undefined ? name : `${groupPath(world, parent)}/${name}`;
  const below =
    current === null ? [] : [...groupAndBelow(world, current.group_id)].filter((id) => id !== current.group_id);
  const ownLevel = current === null ? 0 : levelOf(world, current.group_id);
  // The subtree's height and its longest path below the group, as they will hang under the new place
  let height = 1;
  let longest = path;
  for (const id of below) {
    const group = world.groups.find((candidate) => candidate.group_id === id);
    if (group === undefined || current === null) continue;
    height = Math.max(height, levelOf(world, id) - ownLevel + 1);
    const suffix = groupPath(world, group).slice(groupPath(world, current).length);
    if (pathBytes(path + suffix) > pathBytes(longest)) longest = path + suffix;
  }
  return [
    ...(levelOf(world, parentId) + height > MAX_DEPTH
      ? [bodyError('parent_id', 'too_deep', `Groups are at most ${String(MAX_DEPTH)} levels deep.`)]
      : []),
    ...(pathBytes(longest) > MAX_PATH_BYTES
      ? [bodyError('name', 'path_too_long', `A group path holds at most ${String(MAX_PATH_BYTES)} bytes.`)]
      : []),
  ];
}

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
      .sort((a, b) => byGroupPath(a.path, b.path) || a.group_id.localeCompare(b.group_id));
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
    const place = placeErrors(caller.keywords, parentId, name, null);
    if (place.length > 0) return invalid(request, place);
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
    const place = placeErrors(caller.keywords, parentId, name, current);
    if (place.length > 0) return invalid(request, place);
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
