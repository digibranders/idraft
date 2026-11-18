import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, workspaceCaller } from './access';
import { bodyError, booleanError, isRecord, notAnObject, nullErrors, queryError } from './rules';
import {
  cancelCrawl,
  crawledPage,
  crawledPages,
  crawlsOf,
  edgeRows,
  freshId,
  hasFinishedCrawl,
  linksWorld,
  MOCK_RUN_ID,
  neighborsOf,
  otherScopes,
  pageRow,
  pageTierViews,
  requestCrawl,
  ruleMatches,
  ruleView,
  statusClassOf,
  tierFlow,
  tierRef,
  worklists,
} from '../internal-links-world';
import { invalid, invalidField, mock, noContent, problem, unknownMembers } from '../respond';
import { csvLines } from '@/lib/csv/csv-write';
import type { Problem, ValidationItem } from '@/lib/api/types';
import { textLength } from '@/lib/text/length';
import { parseLinkScope, type LinkScope } from '@/lib/internal-links/scopes';
import { checkRuleValue, MAX_RULES } from '@/lib/internal-links/rule-value';
import { MAX_BODY_BYTES, MAX_CSV_CHARS, parseTierCsv, requestBytes } from '@/lib/internal-links/tier-csv';
import { MAX_TIERS } from '@/lib/internal-links/tiers';
import type { PageFilter, PageRow, TierImportResult } from '@/lib/internal-links/types';

/**
 * The backend OpenAPI's internal links routes, answered from `internal-links-world.ts` (decision W21). Requests are
 * checked as the API checks them where a screen depends on it (membership, permission, unknown query, `no_crawl`,
 * `tier_limit`, `tier_in_use`, `crawl_in_progress`, `no_website`); bodies are typed by the generated schema and
 * trusted beyond their shape. The internal links settings are part of the project settings, in
 * `term-assignments.ts`.
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
/** The hosts an import takes as the site: its bare and `www.` forms (`site_hosts` of the backend, no subdomains set). */
const SITE_HOSTS: ReadonlySet<string> = new Set(['eventussecurity.com', 'www.eventussecurity.com']);
/** The messages of the API for an import line it refuses (`parse_tier_csv` of the backend), by code. */
const IMPORT_MESSAGES = {
  invalid_url: 'Not an http or https URL.',
  other_site: 'Not a page of this site.',
  unknown_tier: 'No tier is called that.',
  missing_column: 'The first line names `url` and `tier`.',
  too_many_rows: 'At most 20000 rows.',
} as const;

// `_PAGE_CSV_HEADER` and `_EDGE_CSV_HEADER` of backend/src/idraft/api/internal_links/reads.py
const PAGE_CSV_HEADER = [
  'url',
  'path',
  'title',
  'tier',
  'status_code',
  'indexable',
  'click_depth',
  'linking_pages',
  'linking_pages_all',
  'outlinks',
  'in_sitemap',
  'top_anchor',
  'flags',
];
const EDGE_CSV_HEADER = [
  'source_url',
  'source_tier',
  'target_url',
  'target_tier',
  'anchor',
  'placement',
  'scope',
  'rel',
  'target_status',
  'target_indexable',
  'occurrences',
];
/** The server writes a tier as "T1 Money pages", and a boolean as Python spells it. */
const tierLabel = (tier: { code: string; name: string } | null): string =>
  tier === null ? '' : `${tier.code} ${tier.name}`;
const pythonBool = (value: boolean): string => (value ? 'True' : 'False');

const listOf = (url: URL, key: string): string[] =>
  (url.searchParams.get(key) ?? '').split(',').filter((value) => value !== '');
const scopeOf = (url: URL): LinkScope => parseLinkScope(url.searchParams.get('scope'));
// The server ends lines with LF (csv_export.py); the web's writer ends them with CRLF
const csv = (rows: readonly (readonly (string | number)[])[], name: string): HttpResponse<string> =>
  new HttpResponse(csvLines(rows).replaceAll('\r\n', '\n'), {
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

/** A `core.urls` id as the API takes it: a positive int64 as digits, no leading zero (backend test_url_id_strings). */
const isUrlId = (value: string): boolean => /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n;

const urlIdError = (location: 'path' | 'query' | 'body', path: string): ValidationItem => ({
  location,
  path,
  code: 'value_error',
  message: 'Not a url id: a whole number from 1 to 9223372036854775807, as digits without a leading zero.',
});

interface Selection {
  url_ids?: string[] | null | undefined;
  filter?: PageFilter | null | undefined;
}

/**
 * The pages a bulk body names: its ids (one the crawl does not hold is left out), or its filter on the latest
 * crawl; an id that is no url id, or a body that names neither, is a 422.
 */
function selected(request: Request, body: Selection): string[] | HttpResponse<Problem> {
  if (body.url_ids !== undefined && body.url_ids !== null) {
    const bad = body.url_ids.flatMap((id, index) =>
      isUrlId(id) ? [] : [urlIdError('body', `url_ids.${String(index)}`)],
    );
    if (bad.length > 0) return invalid(request, bad);
    return [...new Set(body.url_ids)].filter((id) => crawledPage(id) !== undefined);
  }
  if (body.filter === undefined || body.filter === null) {
    return invalidField(request, 'url_ids', 'missing', 'Give url_ids or filter.');
  }
  const criteria = criteriaOfFilter(body.filter);
  return crawledPages()
    .map((page) => pageRow(page, 'editorial'))
    .filter((row) => pageMatches(row, criteria))
    .map((row) => row.url_id);
}

const TIER_NAME_MIN = 1;
const TIER_NAME_MAX = 60;
const TIER_DESCRIPTION_MAX = 200;

/** A tier text as the API's `TierName` and `TierDescription` read it: trimmed, length counted in characters, no control characters. */
function tierTextErrors(value: unknown, path: string, { min, max }: { min: number; max: number }): ValidationItem[] {
  if (value === undefined) return [];
  if (typeof value !== 'string') return [bodyError(path, 'string_type', 'Input should be a valid string')];
  const text = value.trim();
  if (textLength(text) < min) return [bodyError(path, 'string_too_short', `At least ${String(min)} character.`)];
  if (textLength(text) > max) return [bodyError(path, 'string_too_long', `At most ${String(max)} characters.`)];
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text)) {
    return [bodyError(path, 'value_error', 'Must not contain control characters.')];
  }
  return [];
}

/** A checked tier text, trimmed; empty for a member left out. */
const tierText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

type ImportedPath = { path: string } | { code: 'invalid_url' | 'other_site' };

function importedPath(text: string): ImportedPath {
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { code: 'invalid_url' };
    return SITE_HOSTS.has(url.hostname) ? { path: url.pathname } : { code: 'other_site' };
  } catch {
    return { code: 'invalid_url' };
  }
}

/** The words of the API for a rule path it refuses (`_RULE_MESSAGES` of the backend), by code. */
const RULE_MESSAGES = {
  empty: 'String should have at least 1 character',
  starts_with_slash: 'A rule matches a path, which starts with `/`.',
  too_long: 'At most 500 characters.',
  star_in_exact: '`*` is for pattern rules; an exact rule matches one path.',
  star_in_prefix: '`*` is for pattern rules; a prefix rule matches the start of a path.',
  too_many_stars: 'At most 10 `*` in a pattern.',
} as const;

/** A `422` for a rule value the API would refuse, with the reason in the field error and a count in the detail. */
function ruleValueProblem(request: Request, matchType: string, value: unknown): HttpResponse<Problem> | null {
  if (typeof value !== 'string' || (matchType !== 'exact' && matchType !== 'prefix' && matchType !== 'pattern')) {
    return null;
  }
  const found = checkRuleValue(matchType, value);
  return found === null ? null : invalidField(request, 'value', found, RULE_MESSAGES[found]);
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
    const body: unknown = await request.json().catch(() => undefined);
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...unknownMembers(body, ['name', 'description']),
      ...('name' in body ? [] : [bodyError('name', 'missing', 'Field required')]),
      ...tierTextErrors(body.name, 'name', { min: TIER_NAME_MIN, max: TIER_NAME_MAX }),
      ...tierTextErrors(body.description, 'description', { min: 0, max: TIER_DESCRIPTION_MAX }),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const world = linksWorld();
    if (world.tiers.length >= MAX_TIERS) return problem(request, 'tier_limit');
    world.tiers.push({
      tier_id: freshId(),
      name: tierText(body.name),
      description: tierText(body.description),
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
    const body: unknown = await request.json().catch(() => undefined);
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...unknownMembers(body, ['name', 'description']),
      ...(Object.keys(body).length === 0 ? [bodyError('', 'value_error', 'Give a name or a description.')] : []),
      ...nullErrors(body, ['name', 'description']),
      ...(body.name === null ? [] : tierTextErrors(body.name, 'name', { min: TIER_NAME_MIN, max: TIER_NAME_MAX })),
      ...(body.description === null
        ? []
        : tierTextErrors(body.description, 'description', { min: 0, max: TIER_DESCRIPTION_MAX })),
    ];
    if (errors.length > 0) return invalid(request, errors);
    if (body.name !== undefined) tier.name = tierText(body.name);
    if (body.description !== undefined) tier.description = tierText(body.description);
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
    // As the backend orders them (tier_levels.py): the tier itself is a 422, a tier of no workspace a 404
    if (moveTo === view.tier_id) {
      return invalid(request, [queryError('move_to', 'move_to_self', 'Move to another tier or `none`.')]);
    }
    if (moveTo !== null && moveTo !== 'none' && !world.tiers.some((tier) => tier.tier_id === moveTo)) {
      return problem(request, 'not_found');
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
    const refused = ruleValueProblem(request, body.match_type, body.value);
    if (refused !== null) return refused;
    const world = linksWorld();
    if (world.rules.length >= MAX_RULES) return invalidField(request, 'position', 'rule_limit', 'At most 500 rules.');
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
    // The value is checked against the type the rule ends up with
    const refused = ruleValueProblem(request, body.match_type ?? rule.match_type, body.value ?? rule.value);
    if (refused !== null) return refused;
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
    // The API refuses a body over 1 MiB with 413 before it reads it, and a text over CSV_MAX with 422
    if (typeof text === 'string' && requestBytes(text) > MAX_BODY_BYTES) return problem(request, 'payload_too_large');
    if (typeof text === 'string' && text.length > MAX_CSV_CHARS) {
      return invalidField(request, 'csv', 'string_too_long', 'Over 900,000 characters.');
    }
    // The API wants a header naming url and tier, and an absolute http(s) address on every row
    const parsed = parseTierCsv(text, pageTierViews(), { strict: true });
    const errors: TierImportResult['errors'] = parsed.errors.flatMap((error) =>
      error.code === 'too_large' || error.code === 'body_too_large'
        ? []
        : [
            {
              line: error.line,
              code: error.code === 'missing_header' ? ('missing_column' as const) : error.code,
              message: IMPORT_MESSAGES[error.code === 'missing_header' ? 'missing_column' : error.code],
            },
          ],
    );
    const byPath = new Map(crawledPages().map((page) => [page.path, page.id]));
    const found: { id: string; tierId: string | null }[] = [];
    const pending: { line: number; url: string }[] = [];
    for (const row of parsed.rows) {
      const where = importedPath(row.url);
      if ('code' in where) {
        errors.push({ line: row.line, code: where.code, message: IMPORT_MESSAGES[where.code] });
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
    // As the API: `accepted` counts every valid row, the ones that wait for a crawl included (they are in `pending`)
    return HttpResponse.json({ data: { accepted: found.length + pending.length, pending, errors, applied } });
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
  // Crawls (backend docs section 4.8)

  mock('get', `${P}/link-crawls`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['cursor', 'limit'],
    });
    if (caller instanceof Response) return caller;
    return HttpResponse.json(cursorPage(caller.url, crawlsOf(caller.project.project_id)));
  }),

  mock('post', `${P}/link-crawls`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'runs:trigger',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json().catch(() => undefined);
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [...unknownMembers(body, ['higher_limit']), ...booleanError(body.higher_limit, 'higher_limit')];
    if (errors.length > 0) return invalid(request, errors);
    const started = requestCrawl(caller.project.project_id, {
      hasWebsite: caller.project.primary_domain !== null,
      higherLimit: body.higher_limit === true,
    });
    if (started.ok) return HttpResponse.json({ data: started.run }, { status: 202 });
    if (started.code === 'crawls_disabled') return problem(request, 'crawls_disabled');
    if (started.code === 'crawl_in_progress') return problem(request, 'crawl_in_progress', { run_id: started.runId });
    if (started.code === 'no_stopped_crawl') {
      return invalidField(request, 'higher_limit', 'no_stopped_crawl', 'No crawl stopped at its ceiling.');
    }
    return problem(request, 'no_website');
  }),

  mock('get', `${P}/link-crawls/{run_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const run = crawlsOf(caller.project.project_id).find((candidate) => candidate.run_id === params.run_id);
    return run === undefined ? problem(request, 'not_found') : HttpResponse.json({ data: run });
  }),

  mock('post', `${P}/link-crawls/{run_id}/cancel`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'runs:trigger',
    });
    if (caller instanceof Response) return caller;
    const ended = cancelCrawl(caller.project.project_id, String(params.run_id));
    if (ended.ok) return HttpResponse.json({ data: ended.run });
    return problem(request, ended.code);
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
      // The server's columns in the server's order (`_PAGE_CSV_HEADER` of reads.py); it has no equity column
      return csv(
        [
          PAGE_CSV_HEADER,
          ...rows.map((row) => [
            row.url,
            row.path,
            row.title ?? '',
            tierLabel(row.tier),
            row.status_code ?? '',
            pythonBool(row.is_indexable),
            row.click_depth ?? '',
            row.linking_pages,
            row.linking_pages_all,
            row.outlinks,
            pythonBool(row.in_sitemap),
            row.top_anchor ?? '',
            row.flags.join(' '),
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
    const id = String(params.url_id);
    if (!isUrlId(id)) return invalid(request, [urlIdError('path', 'url_id')]);
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const page = crawledPage(id);
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
        // Nothing enriched yet: the backend's answer for a crawl whose enrichment has not run (plan 05 Task 9 fills it)
        extras: {
          anchors: { distinct: null, generic: 0, generic_share: 0, matches_keyword: null, top: null, total: 0 },
          change: null,
          citations: { ai_mode: 0, chatgpt: 0, gemini: 0, total: 0 },
          gsc: { state: 'pending', clicks: null, impressions: null, window_start: null, window_end: null },
          keywords: [],
        },
      },
    });
  }),

  mock('get', `${P}/internal-links/edges`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: EDGE_QUERY,
    });
    if (caller instanceof Response) return caller;
    const badIds = ['filter[source]', 'filter[target]'].flatMap((name) => {
      const given = caller.url.searchParams.get(name);
      return given === null || isUrlId(given) ? [] : [urlIdError('query', name)];
    });
    if (badIds.length > 0) return invalid(request, badIds);
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
      // The server's columns in the server's order (`_EDGE_CSV_HEADER` of reads.py)
      return csv(
        [
          EDGE_CSV_HEADER,
          ...rows.map((row) => [
            row.source.url,
            tierLabel(row.source.tier),
            row.target.url,
            tierLabel(row.target.tier),
            row.anchor,
            row.placement,
            row.scope,
            row.rel.join(' '),
            row.target.status_code ?? '',
            row.target.is_indexable === null ? '' : pythonBool(row.target.is_indexable),
            row.occurrences,
          ]),
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
    const url = caller.url;
    const id = url.searchParams.get('url_id') ?? '';
    if (!isUrlId(id)) return invalid(request, [urlIdError('query', 'url_id')]);
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
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
