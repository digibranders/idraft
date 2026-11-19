import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { termSubtree } from './citations-model';
import {
  boardOf,
  citedPageOf,
  citedPagesOf,
  gapOf,
  gapsOf,
  overviewOf,
  type Board,
  type BoardScope,
  type BoardWorld,
  type PageListQuery,
  type RunsChoice,
} from './citations-v2-model';
import { booleanQuery, offsetPaging, queryError, unknownQuery, uuidError } from './rules';
import { CITATIONS_FIXTURE } from '../citations-v2-fixture';
import { MOCK_WORKSPACE } from '../fixtures';
import { ENGINE_CODES } from '../prompt-fixtures';
import { invalid, mock, problem } from '../respond';
import {
  citedPageRowDomain_roleValues,
  pathsApiV1WorkspacesWorkspace_idProjectsProject_idAiCitedPagesGetParametersQuerySortValues as CITED_SORTS,
} from '@/lib/api/schema';
import type { EngineCode, Problem, ValidationItem } from '@/lib/api/types';

/**
 * WP-77: the five routes of the Citations page (WP-76; docs/19 "As built (AI visibility WP-76 ...)"), answered from the
 * design preview's answers (./citations-v2-model.ts). The request is checked in the API's order: 401, 404, 403, 422,
 * `competitor_not_tracked`, then the 404 of a page or prompt the window does not have.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const SHARED = [
  'runs',
  'filter[engine_code_in]',
  'filter[term]',
  'include_branded',
  'include_unresolved_redirects',
  'include_engine_internal',
];
const COMPETITORS = 'filter[competitor_id_in]';
const PAGE_LIST = ['filter[domain_role_in]', 'q', 'sort', 'offset', 'limit'];
const MAX_COMPETITORS = 5;
const MAX_QUERY = 200;
const RUNS: readonly RunsChoice[] = [1, 2, 4];

type PathValue = string | readonly string[] | undefined;
type PathParams = Readonly<Partial<Record<'workspace_id' | 'project_id' | 'url_id' | 'prompt_id', PathValue>>>;

const single = (value: PathValue): string => (typeof value === 'string' ? value : '');
const listParam = (url: URL, name: string): string[] =>
  url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');

/** A topic vocabulary the project sees: the workspace's, or the project's own. */
const isProjectTopic = (
  vocabulary: { kind: string; workspace_id?: string | undefined; project_id?: string | null | undefined },
  project: { workspace_id: string; project_id: string },
): boolean =>
  vocabulary.kind === 'topic' &&
  (vocabulary.workspace_id ?? MOCK_WORKSPACE.workspace_id) === project.workspace_id &&
  (vocabulary.project_id === null ||
    vocabulary.project_id === undefined ||
    vocabulary.project_id === project.project_id);

/** The project's world as the model reads it: own host, tracked competitors in role order, topic terms. */
function worldOf(caller: ProjectCaller): BoardWorld {
  const { world, project } = caller;
  const roles = world.roles.filter(
    (role) => role.project_id === project.project_id && (role.removed_at ?? null) === null,
  );
  const competitors = roles
    .filter((role) => role.role === 'competitor')
    .map((role) => ({
      entityId: role.entity_id,
      name: world.entities.find((entity) => entity.entity_id === role.entity_id)?.canonical_name ?? role.entity_id,
      colorIndex: role.color_index ?? null,
      domain:
        world.domains.find((domain) => domain.entity_id === role.entity_id && domain.match_scope !== 'path_prefix')
          ?.host ?? null,
    }))
    // The order of `GET /entities` (by name, `project-entities.ts` byRole), the one Settings shows and D-7 reads
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const vocabularies = new Set(
    world.vocabularies
      .filter((vocabulary) => isProjectTopic(vocabulary, project))
      .map((vocabulary) => vocabulary.vocabulary_id),
  );
  return {
    ownHost: project.primary_domain?.registrable_domain ?? CITATIONS_FIXTURE.ownDomain,
    timezone: project.timezone,
    competitors,
    topics: world.terms
      .filter((term) => vocabularies.has(term.vocabulary_id))
      .map((term) => ({ termId: term.term_id, name: term.name })),
  };
}

interface Read<T> {
  caller: ProjectCaller;
  board: Board;
  scope: BoardScope;
  own: T;
}

/** The checks every route shares, then the route's own (`own`), which adds its errors to `errors`. */
function readOf<T>(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  params: PathParams,
  allowed: readonly string[],
  own: (url: URL, errors: ValidationItem[], board: Board) => T,
): Read<T> | HttpResponse<Problem> {
  const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
    permission: 'data:read',
    query: [...new Set(new URL(request.url).searchParams.keys())],
  });
  if (caller instanceof Response) return caller;
  const { url } = caller;
  const errors = unknownQuery(url, allowed);
  const rawRuns = url.searchParams.get('runs');
  const runs = rawRuns === null ? 4 : RUNS.find((choice) => String(choice) === rawRuns);
  if (runs === undefined) errors.push(queryError('runs', 'value_error', 'runs is 1, 2 or 4.'));
  const asked = listParam(url, 'filter[engine_code_in]');
  asked.forEach((value, place) => {
    if (!ENGINE_CODES.some((code) => code === value)) {
      errors.push(
        queryError(`filter[engine_code_in].${String(place)}`, 'enum', `Allowed: ${ENGINE_CODES.join(', ')}.`),
      );
    }
  });
  const engines: EngineCode[] = ENGINE_CODES.filter((code) => asked.length === 0 || asked.includes(code));
  const term = url.searchParams.get('filter[term]');
  if (term !== null) {
    errors.push(...uuidError(term, 'filter[term]').map((item) => queryError(item.path, item.code, item.message)));
  }
  for (const flag of ['include_branded', 'include_unresolved_redirects', 'include_engine_internal']) {
    const value = booleanQuery(url, flag, false);
    if (typeof value !== 'boolean') errors.push(value);
  }
  const world = worldOf(caller);
  const board = boardOf(CITATIONS_FIXTURE, world);
  const parsed = own(url, errors, board);
  if (errors.length > 0) return invalid(request, errors);
  const terms = caller.world.terms.filter((candidate) =>
    world.topics.some((topic) => topic.termId === candidate.term_id),
  );
  return {
    caller,
    board,
    scope: { runs: runs ?? 4, engines, termIds: term === null ? null : termSubtree(terms, term) },
    own: parsed,
  };
}

/** `filter[competitor_id_in]`: 1 to 5 ids, repeats dropped and the order kept; each must be tracked. */
function competitorsOf(url: URL, errors: ValidationItem[]): string[] {
  const ids = [...new Set(listParam(url, COMPETITORS))];
  if (ids.length === 0) errors.push(queryError(COMPETITORS, 'missing', 'Field required'));
  if (ids.length > MAX_COMPETITORS) {
    errors.push(queryError(COMPETITORS, 'too_long', `List should have at most ${String(MAX_COMPETITORS)} items.`));
  }
  ids.forEach((id, place) =>
    errors.push(
      ...uuidError(id, `${COMPETITORS}.${String(place)}`).map((item) => queryError(item.path, item.code, item.message)),
    ),
  );
  return ids;
}

function untracked(request: Request, board: Board, ids: readonly string[]): HttpResponse<Problem> | null {
  const unknown = ids.filter((id) => !board.world.competitors.some((competitor) => competitor.entityId === id));
  return unknown.length === 0
    ? null
    : problem(request, 'competitor_not_tracked', {
        detail: 'Every competitor must be one the project tracks.',
        entity_ids: unknown,
      });
}

function pageListOf(url: URL, errors: ValidationItem[]): PageListQuery {
  const role = url.searchParams.get('filter[domain_role_in]');
  const knownRole = citedPageRowDomain_roleValues.find((value) => value === role) ?? null;
  if (role !== null && knownRole === null) {
    errors.push(queryError('filter[domain_role_in]', 'enum', `Allowed: ${citedPageRowDomain_roleValues.join(', ')}.`));
  }
  const q = url.searchParams.get('q') ?? '';
  if (q.length > MAX_QUERY) {
    errors.push(queryError('q', 'string_too_long', `String should have at most ${String(MAX_QUERY)} characters`));
  }
  const rawSort = url.searchParams.get('sort');
  const sort = CITED_SORTS.find((value) => value === rawSort) ?? '-citations';
  if (rawSort !== null && !CITED_SORTS.some((value) => value === rawSort)) {
    errors.push(queryError('sort', 'enum', `Allowed: ${CITED_SORTS.join(', ')}.`));
  }
  const paging = offsetPaging(url);
  if (Array.isArray(paging)) errors.push(...paging);
  return {
    role: knownRole,
    q: q.trim(),
    sort,
    ...(Array.isArray(paging) ? { offset: 0, limit: 50 } : paging),
  };
}

export const citationBoardHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/citation-overview`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, SHARED, () => null);
    if (read instanceof Response) return read;
    return HttpResponse.json(overviewOf(read.board, read.scope));
  }),

  mock('get', `${P}/ai/cited-pages`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, [...SHARED, ...PAGE_LIST], pageListOf);
    if (read instanceof Response) return read;
    return HttpResponse.json(citedPagesOf(read.board, read.scope, read.own));
  }),

  mock('get', `${P}/ai/cited-pages/{url_id}`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, SHARED, (_, errors) => {
      const raw = single(params.url_id);
      const id = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id)) {
        errors.push(queryError('url_id', 'int_parsing', 'Input should be a valid integer'));
      }
      return id;
    });
    if (read instanceof Response) return read;
    const detail = citedPageOf(read.board, read.scope, read.own);
    return detail === null
      ? problem(request, 'not_found', { detail: 'No answer of the window cites this page.' })
      : HttpResponse.json(detail);
  }),

  mock('get', `${P}/ai/citation-gaps`, ({ request, cookies, params }) => {
    const read = readOf(request, cookies, params, [...SHARED, COMPETITORS], competitorsOf);
    if (read instanceof Response) return read;
    return untracked(request, read.board, read.own) ?? HttpResponse.json(gapsOf(read.board, read.scope, read.own));
  }),

  mock('get', `${P}/ai/citation-gaps/{prompt_id}`, ({ request, cookies, params }) => {
    const promptId = single(params.prompt_id);
    const read = readOf(request, cookies, params, [...SHARED, COMPETITORS], (url, errors) => {
      errors.push(...uuidError(promptId, 'prompt_id').map((item) => queryError(item.path, item.code, item.message)));
      return competitorsOf(url, errors);
    });
    if (read instanceof Response) return read;
    const refused = untracked(request, read.board, read.own);
    if (refused !== null) return refused;
    const detail = gapOf(read.board, read.scope, read.own, promptId);
    return detail === null
      ? problem(request, 'not_found', { detail: 'The prompt has no answer in the window.' })
      : HttpResponse.json(detail);
  }),
];
