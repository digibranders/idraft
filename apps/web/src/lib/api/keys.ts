/**
 * Query keys (20-frontend-specification.md section 3.5). A key follows the path of the request, with the
 * tenancy first, so everything under a project or a workspace can be invalidated by its prefix:
 *
 *   GET /api/v1/workspaces/{W}/projects/{P}/seo/tracked-keywords?limit=50
 *   ['ws', W, 'p', P, 'seo', 'tracked-keywords', { limit: 50 }]
 *
 * The last element is always the normalized query, so two URLs that mean the same share one cache entry.
 */

export type Filters = Readonly<Record<string, unknown>>;
export type QueryKey = readonly unknown[];

const API_PREFIX = '/api/v1/';
/** Tenancy segments get a short name in the key: `workspaces/{W}` is `ws, W` and `projects/{P}` is `p, P`. */
const TENANCY: Readonly<Record<string, string>> = { workspaces: 'ws', projects: 'p' };

function sameValue(first: unknown, second: unknown): boolean {
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((item, index) => sameValue(item, second[index]));
  }
  return Object.is(first, second);
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || (Array.isArray(value) && value.length === 0);

/**
 * The filters as a key: keys sorted, and without `undefined`, `null`, empty lists and values equal to
 * their default. List order is kept: in a sort order it means something.
 */
export function normalizeFilters(filters: Filters = {}, defaults: Filters = {}): Filters {
  const normalized: Record<string, unknown> = {};
  for (const name of Object.keys(filters).sort()) {
    const value = filters[name];
    if (isEmpty(value) || (name in defaults && sameValue(value, defaults[name]))) continue;
    normalized[name] = value;
  }
  return normalized;
}

/** The key of the project, for invalidating everything under it. */
export const projectKey = (workspaceId: string, projectId: string): QueryKey => ['ws', workspaceId, 'p', projectId];

/** The key of the workspace, for invalidating everything under it, its projects included. */
export const workspaceKey = (workspaceId: string): QueryKey => ['ws', workspaceId];

/**
 * The key of a request: the segments of its path after `/api/v1/`, with each `{parameter}` replaced by its
 * value and the tenancy segments shortened, then the normalized query.
 */
export function queryKey(
  path: string,
  pathParams: Readonly<Record<string, string | number>> = {},
  query: Filters = {},
  defaults: Filters = {},
): QueryKey {
  if (!path.startsWith(API_PREFIX)) throw new Error(`Not an API path: ${path}`);
  const segments = path.slice(API_PREFIX.length).split('/');
  const key: unknown[] = [];
  segments.forEach((segment, index) => {
    const parameter = /^\{(.+)\}$/.exec(segment)?.[1];
    if (parameter === undefined) {
      // A tenancy segment followed by its id is shortened; a list such as `workspaces/{W}/projects` is not
      const followedById = segments[index + 1]?.startsWith('{') ?? false;
      key.push(followedById ? (TENANCY[segment] ?? segment) : segment);
      return;
    }
    const value = pathParams[parameter];
    if (value === undefined) throw new Error(`Missing path parameter ${parameter} for ${path}`);
    key.push(String(value));
  });
  key.push(normalizeFilters(query, defaults));
  return key;
}
