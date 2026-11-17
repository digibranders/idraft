import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, workspaceCaller } from './access';
import {
  crawledPage,
  crawledPages,
  edgeRows,
  freshId,
  hasFinishedCrawl,
  linksWorld,
  MOCK_RUN_ID,
  neighborsOf,
  otherScopes,
  pageRow,
  pageTierViews,
  ruleMatches,
  ruleView,
  statusClassOf,
  tierFlow,
  tierRef,
  worklists,
} from '../internal-links-world';
import { invalid, invalidField, mock, noContent, problem } from '../respond';
import { csvLines } from '@/lib/csv/csv-write';
import type { Problem } from '@/lib/api/types';
import { parseLinkScope, type LinkScope } from '@/lib/internal-links/scopes';
import { parseTierCsv } from '@/lib/internal-links/tier-csv';
import { MAX_TIERS } from '@/lib/internal-links/tiers';
import type { PageFilter, PageRow, TierImportResult } from '@/lib/internal-links/types';

/**
 * The backend OpenAPI's internal links routes, answered from `internal-links-world.ts` (decision W21). Requests are
 * checked as the API checks them where a screen depends on it (membership, permission, unknown query, `no_crawl`,
 * `tier_limit`, `tier_in_use`); bodies are typed by the generated schema and trusted beyond their shape. The crawl
 * runs and the internal links settings have no handler: their routes are not in the OpenAPI yet (see
 * `pending-contract.ts` and the crawl functions of the world).
 */

const W = '/api/v1/workspaces/{workspace_id}';
// Literal strings, so each path below keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const LIST_QUERY = ['run', 'scope', 'cursor', 'limit', 'format'];
const PAGE_QUERY = [
  ...LIST_QUERY,
  'filter[tier]',
  'filter[tag]',
  'filter[status]',
  'filter[indexable]',
  'filter[flags]',
  'filter[worklist]',
  'q',
  'sort',
];
const EDGE_QUERY = [
  ...LIST_QUERY,
  'filter[source_tier]',
  'filter[target_tier]',
  'filter[tag]',
  'filter[placement]',
  'filter[target_status]',
  'filter[source]',
  'filter[target]',
  'filter[worklist]',
  'q_source',
  'q_target',
];
const SITE = 'https://eventussecurity.com';

const listOf = (url: URL, key: string): string[] =>
  (url.searchParams.get(key) ?? '').split(',').filter((value) => value !== '');
const scopeOf = (url: URL): LinkScope => parseLinkScope(url.searchParams.get('scope'));
const csv = (rows: readonly (readonly (string | number)[])[], name: string): HttpResponse<string> =>
  new HttpResponse(csvLines(rows), {
    headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${name}.csv"` },
  });

/** Offset paging under an opaque cursor, as the API's cursor pages read. */
function cursorPage<T>(
  url: URL,
  rows: readonly T[],
): { data: T[]; page: { limit: number; next_cursor: string | null; has_more: boolean } } {
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
  const offset = Number(url.searchParams.get('cursor') ?? 0);
  const next = offset + limit < rows.length ? String(offset + limit) : null;
  return { data: rows.slice(offset, offset + limit), page: { limit, next_cursor: next, has_more: next !== null } };
}

/** The Pages filters, from the address of the list or from the filter of a bulk body. */
interface Criteria {
  tierIds: readonly string[];
  tagIds: readonly string[];
  status: readonly string[];
  indexable: boolean | null;
  flags: readonly string[];
  worklist: string | null;
  q: string | null;
}

const criteriaOfUrl = (url: URL): Criteria => {
  const indexable = url.searchParams.get('filter[indexable]');
  return {
    tierIds: listOf(url, 'filter[tier]'),
    tagIds: listOf(url, 'filter[tag]'),
    status: listOf(url, 'filter[status]'),
    indexable: indexable === null ? null : indexable === 'true',
    flags: listOf(url, 'filter[flags]'),
    worklist: url.searchParams.get('filter[worklist]'),
    q: url.searchParams.get('q'),
  };
};

const criteriaOfFilter = (filter: PageFilter): Criteria => ({
  tierIds: filter.tier_ids ?? [],
  tagIds: filter.tag_ids ?? [],
  status: filter.status ?? [],
  indexable: filter.indexable ?? null,
  flags: filter.flags ?? [],
  worklist: filter.worklist ?? null,
  q: filter.q ?? null,
});

function pageMatches(row: PageRow, criteria: Criteria): boolean {
  const { tierIds, tagIds, status, indexable, flags, worklist, q } = criteria;
  if (tierIds.length > 0 && !tierIds.includes(row.tier?.tier_id ?? 'none')) return false;
  if (tagIds.length > 0 && !row.tags.some((tag) => tagIds.includes(tag.term_id))) return false;
  if (status.length > 0 && (row.status_code === null || !status.includes(statusClassOf(row.status_code)))) return false;
  if (indexable !== null && row.is_indexable !== indexable) return false;
  for (const flag of flags) {
    const has = flag === 'has_broken_outlinks' ? row.broken_outlinks > 0 : row.flags.some((own) => own === flag);
    if (!has) return false;
  }
  if (worklist === 'orphans' && !row.flags.includes('orphan')) return false;
  if (worklist === 'editorial_orphans' && !row.flags.includes('editorial_orphan')) return false;
  if (worklist === 'deep_only_through_auto' && !row.flags.includes('deep_only_through_auto')) return false;
  if (
    worklist === 'under_linked_t1' &&
    !(row.tier?.code === 'T1' && row.status_code === 200 && (row.linking_pages < 3 || (row.click_depth ?? 99) > 3))
  ) {
    return false;
  }
  return q === null || row.path.includes(q);
}

// `equity_share` is in the API's payloads and its sort list; nothing here sorts by it, so it falls back to the path
const SORTS: Readonly<Record<string, (row: PageRow) => string | number>> = {
  path: (row) => row.path,
  status_code: (row) => row.status_code ?? 0,
  click_depth: (row) => row.click_depth ?? 999,
  linking_pages: (row) => row.linking_pages,
  outlinks: (row) => row.outlinks,
};

function sortRows(rows: PageRow[], sort: string): PageRow[] {
  const desc = sort.startsWith('-');
  const read = SORTS[desc ? sort.slice(1) : sort] ?? SORTS.path;
  if (read === undefined) return rows;
  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    const order =
      typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return (desc ? -order : order) || a.path.localeCompare(b.path);
  });
}

interface Selection {
  url_ids?: number[] | null | undefined;
  filter?: PageFilter | null | undefined;
}

/** The pages a bulk body names: its ids, or its filter on the latest crawl; a body that names neither is a 422. */
function selected(request: Request, body: Selection): string[] | HttpResponse<Problem> {
  if (body.url_ids !== undefined && body.url_ids !== null) return body.url_ids.map(String);
  if (body.filter === undefined || body.filter === null) {
    return invalidField(request, 'url_ids', 'missing', 'Give url_ids or filter.');
  }
  const criteria = criteriaOfFilter(body.filter);
  return crawledPages()
    .map((page) => pageRow(page, 'editorial'))
    .filter((row) => pageMatches(row, criteria))
    .map((row) => row.url_id);
}

type ImportedPath = { path: string } | { code: 'invalid_url' | 'other_site' };

function importedPath(text: string): ImportedPath {
  try {
    const url = new URL(text, SITE);
    return url.origin === SITE ? { path: url.pathname } : { code: 'other_site' };
  } catch {
    return { code: 'invalid_url' };
  }
}

export const internalLinkHandlers: HttpHandler[] = [
  // ---------------------------------------------------------------------------------------------
  // Workspace tiers

  mock('get', `${W}/page-tiers`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: pageTierViews() });
  }),

  mock('post', `${W}/page-tiers`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'workspace:update' });
    if (caller instanceof Response) return caller;
    const body = await request.json();
    if (body.name.trim() === '') return invalidField(request, 'name', 'string_too_short', 'Enter a name.');
    const world = linksWorld();
    if (world.tiers.length >= MAX_TIERS) return problem(request, 'tier_limit');
    world.tiers.push({
      tier_id: freshId(),
      name: body.name.trim(),
      description: body.description,
      updated_at: new Date().toISOString(),
    });
    const created = pageTierViews().at(-1);
    return created === undefined
      ? problem(request, 'internal_error')
      : HttpResponse.json({ data: created }, { status: 201 });
  }),

  mock('patch', `${W}/page-tiers/{tier_id}`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'workspace:update' });
    if (caller instanceof Response) return caller;
    const tier = linksWorld().tiers.find((candidate) => candidate.tier_id === params.tier_id);
    if (tier === undefined) return problem(request, 'not_found');
    const body = await request.json();
    if (body.name !== undefined) tier.name = body.name.trim();
    if (body.description !== undefined) tier.description = body.description;
    tier.updated_at = new Date().toISOString();
    const view = pageTierViews().find((candidate) => candidate.tier_id === tier.tier_id);
    return view === undefined ? problem(request, 'internal_error') : HttpResponse.json({ data: view });
  }),

  mock('delete', `${W}/page-tiers/{tier_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, {
      permission: 'workspace:update',
      query: ['move_to'],
    });
    if (caller instanceof Response) return caller;
    const world = linksWorld();
    const view = pageTierViews().find((candidate) => candidate.tier_id === params.tier_id);
    if (view === undefined) return problem(request, 'not_found');
    const moveTo = caller.url.searchParams.get('move_to');
    if ((view.page_count > 0 || view.rule_count > 0) && moveTo === null) {
      return problem(request, 'tier_in_use', { page_count: view.page_count, rule_count: view.rule_count });
    }
    const target = moveTo === 'none' ? null : moveTo;
    for (const [id, manual] of world.manual) {
      if (manual.tier_id === view.tier_id) world.manual.set(id, { ...manual, tier_id: target });
    }
    world.rules = world.rules.flatMap((rule) =>
      rule.tier_id !== view.tier_id ? [rule] : target === null ? [] : [{ ...rule, tier_id: target }],
    );
    world.tiers = world.tiers.filter((tier) => tier.tier_id !== view.tier_id);
    return noContent();
  }),

  // ---------------------------------------------------------------------------------------------
  // Rules, page tiers, import, tags

  mock('get', `${P}/tier-rules`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: linksWorld().rules.map((rule, index) => ruleView(rule, index + 1)) });
  }),

  mock('post', `${P}/tier-rules`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body = await request.json();
    if (tierRef(body.tier_id) === null) {
      return invalid(request, [
        { path: 'tier_id', code: 'unknown_tier', message: 'Not a tier of this workspace.', location: 'body' },
      ]);
    }
    const world = linksWorld();
    const rule = {
      rule_id: freshId(),
      match_type: body.match_type,
      value: body.value,
      tier_id: body.tier_id,
      created_at: new Date().toISOString(),
    };
    const at = Math.min(Math.max((body.position ?? world.rules.length + 1) - 1, 0), world.rules.length);
    world.rules.splice(at, 0, rule);
    return HttpResponse.json({ data: ruleView(rule, at + 1) }, { status: 201 });
  }),

  mock('patch', `${P}/tier-rules/{rule_id}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const world = linksWorld();
    const index = world.rules.findIndex((rule) => rule.rule_id === params.rule_id);
    const rule = world.rules[index];
    if (rule === undefined) return problem(request, 'not_found');
    const body = await request.json();
    const next = {
      ...rule,
      ...(body.match_type === undefined ? {} : { match_type: body.match_type }),
      ...(body.value === undefined ? {} : { value: body.value }),
      ...(body.tier_id === undefined ? {} : { tier_id: body.tier_id }),
    };
    world.rules.splice(index, 1);
    const at = Math.min(Math.max((body.position ?? index + 1) - 1, 0), world.rules.length);
    world.rules.splice(at, 0, next);
    return HttpResponse.json({ data: ruleView(next, at + 1) });
  }),

  mock('delete', `${P}/tier-rules/{rule_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const world = linksWorld();
    if (!world.rules.some((rule) => rule.rule_id === params.rule_id)) return problem(request, 'not_found');
    world.rules = world.rules.filter((rule) => rule.rule_id !== params.rule_id);
    return noContent();
  }),

  mock('post', `${P}/tier-rules/preview`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const body = await request.json();
    const world = linksWorld();
    const earlier = world.rules
      .slice(0, (body.position ?? world.rules.length + 1) - 1)
      .filter((rule) => rule.rule_id !== body.rule_id);
    const matching = crawledPages().filter((page) => ruleMatches(body, page.path));
    const wouldApply = matching.filter(
      (page) => !world.manual.has(page.id) && !earlier.some((rule) => ruleMatches(rule, page.path)),
    );
    return HttpResponse.json({ data: { matching_pages: matching.length, would_apply: wouldApply.length } });
  }),

  mock('put', `${P}/pages/tiers`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body = await request.json();
    const ids = selected(request, body);
    if (ids instanceof Response) return ids;
    if (body.tier_id !== null && tierRef(body.tier_id) === null) {
      return invalidField(request, 'tier_id', 'unknown_tier', 'Not a tier of this workspace.');
    }
    const world = linksWorld();
    let changed = 0;
    for (const id of ids) {
      if (world.manual.get(id)?.tier_id === body.tier_id) continue;
      world.manual.set(id, { tier_id: body.tier_id, set_at: new Date().toISOString() });
      changed += 1;
    }
    return HttpResponse.json({ data: { matched: ids.length, changed } });
  }),

  mock('post', `${P}/pages/tiers/reset`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const ids = selected(request, await request.json());
    if (ids instanceof Response) return ids;
    const world = linksWorld();
    const changed = ids.filter((id) => world.manual.delete(id)).length;
    return HttpResponse.json({ data: { matched: ids.length, changed } });
  }),

  mock('post', `${P}/pages/tiers/import`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const { csv: text } = await request.json();
    const parsed = parseTierCsv(text, pageTierViews());
    const errors: TierImportResult['errors'] = parsed.errors.map((error) => ({
      line: error.line,
      code: error.code,
      message: `Line ${String(error.line)}: ${error.code}.`,
    }));
    const byPath = new Map(crawledPages().map((page) => [page.path, page.id]));
    const found: { id: string; tierId: string }[] = [];
    const pending: { line: number; url: string }[] = [];
    for (const row of parsed.rows) {
      const where = importedPath(row.url);
      if ('code' in where) {
        errors.push({ line: row.line, code: where.code, message: `Line ${String(row.line)}: ${where.code}.` });
        continue;
      }
      const id = byPath.get(where.path);
      if (id === undefined) pending.push({ line: row.line, url: row.url });
      else found.push({ id, tierId: row.tierId });
    }
    errors.sort((a, b) => a.line - b.line);
    // Nothing applies while a line has an error (backend plan 02)
    const applied = errors.length === 0;
    if (applied) {
      for (const { id, tierId } of found) {
        linksWorld().manual.set(id, { tier_id: tierId, set_at: new Date().toISOString() });
      }
    }
    return HttpResponse.json({ data: { accepted: found.length, pending, errors, applied } });
  }),

  mock('put', `${P}/pages/tags`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body = await request.json();
    const ids = selected(request, body);
    if (ids instanceof Response) return ids;
    const world = linksWorld();
    let added = 0;
    let removed = 0;
    for (const id of ids) {
      const tags = world.tags.get(id) ?? new Set<string>();
      for (const term of body.add) {
        if (!tags.has(term)) {
          tags.add(term);
          added += 1;
        }
      }
      for (const term of body.remove) if (tags.delete(term)) removed += 1;
      world.tags.set(id, tags);
    }
    return HttpResponse.json({ data: { matched: ids.length, added, removed } });
  }),

  // ---------------------------------------------------------------------------------------------
  // Reads

  mock('get', `${P}/internal-links/pages`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: PAGE_QUERY,
    });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const view = scopeOf(caller.url);
    const criteria = criteriaOfUrl(caller.url);
    const rows = sortRows(
      crawledPages()
        .map((page) => pageRow(page, view))
        .filter((row) => pageMatches(row, criteria)),
      caller.url.searchParams.get('sort') ?? 'path',
    );
    if (caller.url.searchParams.get('format') === 'csv') {
      // No equity column: the web never shows it (decision W4), so this mock export leaves it out
      return csv(
        [
          ['url', 'tier', 'status_code', 'click_depth', 'linking_pages', 'outlinks'],
          ...rows.map((row) => [
            row.url,
            row.tier?.code ?? '',
            row.status_code ?? '',
            row.click_depth ?? '',
            row.linking_pages,
            row.outlinks,
          ]),
        ],
        'pages',
      );
    }
    return HttpResponse.json({
      ...cursorPage(caller.url, rows),
      meta: { run_id: MOCK_RUN_ID, scope: view, total: rows.length },
    });
  }),

  mock('get', `${P}/internal-links/pages/{url_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run', 'scope'],
    });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const page = crawledPage(String(params.url_id));
    if (page === undefined) return problem(request, 'not_found');
    const view = scopeOf(caller.url);
    const row = pageRow(page, view);
    const linking = neighborsOf(page.id, 'in', view);
    const outlinks = neighborsOf(page.id, 'out', view);
    const placements = new Map<NonNullable<(typeof linking)[number]['placement']>, number>();
    for (const neighbor of linking) {
      if (neighbor.placement !== null)
        placements.set(neighbor.placement, (placements.get(neighbor.placement) ?? 0) + 1);
    }
    return HttpResponse.json({
      data: {
        page: row,
        linking_by_tier: row.linked_from_tiers,
        linking_by_placement: [...placements].map(([placement, pages]) => ({ placement, pages })),
        top_anchors: row.top_anchor === null ? [] : [{ anchor: row.top_anchor, links: 1 }],
        linking_pages: linking.slice(0, 25),
        outlinks: outlinks.slice(0, 25),
        linking_pages_total: linking.length,
        outlinks_total: outlinks.length,
      },
    });
  }),

  mock('get', `${P}/internal-links/edges`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: EDGE_QUERY,
    });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const url = caller.url;
    const view = scopeOf(url);
    const sourceTiers = listOf(url, 'filter[source_tier]');
    const targetTiers = listOf(url, 'filter[target_tier]');
    const placements = listOf(url, 'filter[placement]');
    const statuses = listOf(url, 'filter[target_status]');
    const worklist = url.searchParams.get('filter[worklist]');
    const rows = edgeRows(worklist === null ? view : 'all').filter(
      (row) =>
        (sourceTiers.length === 0 || sourceTiers.includes(row.source.tier?.tier_id ?? 'none')) &&
        (targetTiers.length === 0 || targetTiers.includes(row.target.tier?.tier_id ?? 'none')) &&
        (placements.length === 0 || placements.includes(row.placement)) &&
        (statuses.length === 0 ||
          (row.target.status_code !== null && statuses.includes(statusClassOf(row.target.status_code)))) &&
        (url.searchParams.get('filter[source]') === null ||
          row.source.url_id === url.searchParams.get('filter[source]')) &&
        (url.searchParams.get('filter[target]') === null ||
          row.target.url_id === url.searchParams.get('filter[target]')) &&
        (worklist !== 'broken_and_redirected' || (row.target.status_code ?? 200) >= 300) &&
        (worklist !== 'links_to_non_indexable' ||
          (row.target.status_code === 200 && row.target.is_indexable === false)) &&
        row.source.path.includes(url.searchParams.get('q_source') ?? '') &&
        row.target.path.includes(url.searchParams.get('q_target') ?? ''),
    );
    if (url.searchParams.get('format') === 'csv') {
      return csv(
        [
          ['source_url', 'target_url', 'anchor', 'placement'],
          ...rows.map((row) => [row.source.url, row.target.url, row.anchor, row.placement]),
        ],
        'links',
      );
    }
    return HttpResponse.json({
      ...cursorPage(url, rows),
      meta: { run_id: MOCK_RUN_ID, scope: view, total: rows.length },
    });
  }),

  mock('get', `${P}/internal-links/neighbors`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['url_id', 'direction', 'run', 'scope', 'limit', 'offset'],
    });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const url = caller.url;
    const id = url.searchParams.get('url_id') ?? '';
    const page = crawledPage(id);
    if (page === undefined) return problem(request, 'not_found');
    const direction = url.searchParams.get('direction') === 'in' ? 'in' : 'out';
    const view = scopeOf(url);
    const all = neighborsOf(id, direction, view);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 8));
    return HttpResponse.json({
      data: all.slice(offset, offset + limit),
      meta: {
        run_id: MOCK_RUN_ID,
        url_id: id,
        direction,
        scope: view,
        total: all.length,
        other_scopes: otherScopes(id, direction, view),
        focus: { url_id: id, status_code: page.status, redirect_url_id: page.redirectTo ?? null },
      },
    });
  }),

  mock('get', `${P}/internal-links/tier-flow`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run', 'scope'],
    });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    return HttpResponse.json({ data: tierFlow(scopeOf(caller.url)) });
  }),

  mock('get', `${P}/internal-links/worklists`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run'],
    });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    return HttpResponse.json({ data: worklists() });
  }),
];
