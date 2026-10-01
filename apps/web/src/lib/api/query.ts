import {
  mutationOptions,
  queryOptions,
  type DataTag,
  type QueryFunction,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { ClientPathsWithMethod, FetchResponse, ParamsOption, RequestBodyOption } from 'openapi-fetch';

import { api, unwrap, type ApiClient } from './client';
import { normalizeFilters, queryKey, type Filters, type QueryKey } from './keys';
import { readAllPages } from './pages';
import type { paths } from './schema';

/**
 * TanStack Query options for the typed client (20-frontend-specification.md section 3.5). A query is a GET
 * path with its typed parameters; the key comes from the path, and an error response rejects with an
 * `ApiProblem`, so screens branch on `code` (section 3.7).
 */

type WriteMethod = 'post' | 'put' | 'patch' | 'delete';
type Method = 'get' | WriteMethod;
type JsonMedia = `${string}/${string}`;

/** A path of the versioned API with this method. Health checks (`/api/healthz`) are not called from pages. */
export type ApiPath<M extends Method> = Extract<ClientPathsWithMethod<ApiClient, M>, `/api/v1/${string}`>;
type Operation<M extends Method, P extends ApiPath<M>> = paths[P][M] extends infer O extends Record<
  string | number,
  unknown
>
  ? O
  : never;
type Parts<M extends Method, P extends ApiPath<M>> = ParamsOption<Operation<M, P>> & RequestBodyOption<Operation<M, P>>;
/**
 * The parameters and body of a request, required when the path needs them. Only these: an option such as
 * `parseAs` or `baseUrl` would change the request without changing its type or its cache key.
 */
export type ApiInit<M extends Method, P extends ApiPath<M>> =
  Partial<Parts<M, P>> extends Parts<M, P> ? Parts<M, P> | undefined : Parts<M, P>;
/** The body of a successful response; `undefined` for a 204. */
export type ApiResponse<M extends Method, P extends ApiPath<M>> = Extract<
  FetchResponse<Operation<M, P>, unknown, JsonMedia>,
  { error?: never }
>['data'];

interface QueryExtras {
  /** Query values equal to these are neither sent nor part of the key, as the URL leaves them out (keys.ts). */
  defaults?: Filters | undefined;
  /** The browser client unless given. On the server, pass `client: await serverApi()`. */
  client?: ApiClient | undefined;
}

type QueryParams<P extends ApiPath<'get'>> = ParamsOption<Operation<'get', P>>;
type QueryInit<P extends ApiPath<'get'>> = QueryParams<P> & QueryExtras;
/** The init is optional exactly when the path has no required parameter. */
type QueryArgs<P extends ApiPath<'get'>> =
  Partial<QueryParams<P>> extends QueryParams<P> ? [init?: QueryInit<P>] : [init: QueryInit<P>];

/** What the helpers pass to openapi-fetch. The public signatures above are what check it. */
interface RequestShape {
  params?: unknown;
  body?: unknown;
  signal?: AbortSignal | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The path and query parameters of a checked init, read without trusting its static type. */
function partsOf(params: unknown): { path: Record<string, string | number>; query: Filters } {
  const record = isRecord(params) ? params : {};
  const path: Record<string, string | number> = {};
  if (isRecord(record.path)) {
    for (const [name, value] of Object.entries(record.path)) {
      if (typeof value === 'string' || typeof value === 'number') path[name] = value;
    }
  }
  return { path, query: isRecord(record.query) ? record.query : {} };
}

/**
 * Sends one request. openapi-fetch's methods take the init as a rest parameter whose type TypeScript cannot
 * resolve while the path is still a type parameter, so the call goes through a view of `client.request`
 * with the init already checked by the caller's signature. The response type is the one openapi-fetch
 * gives that path.
 */
function send<M extends Method, P extends ApiPath<M>>(
  client: ApiClient,
  method: M,
  path: P,
  init: RequestShape,
): Promise<ApiResponse<M, P>> {
  // The browser client has no origin on the server; a Server Component passes the server client
  if (client === api && typeof window === 'undefined') {
    throw new Error(`${path} was requested on the server with the browser client: pass client: await serverApi()`);
  }
  const request = client.request as unknown as (
    method: M,
    path: P,
    init: RequestShape,
  ) => Promise<{ data: ApiResponse<M, P>; error?: never; response: Response } | { error: unknown; response: Response }>;
  return unwrap(request(method, path, init));
}

/**
 * What `apiQuery` returns: TanStack's options with a query function that is always set (so the options
 * also suit `useSuspenseQuery`), and the data type carried on the key for `getQueryData`.
 */
export type ApiQueryOptions<P extends ApiPath<'get'>> = UseQueryOptions<
  ApiResponse<'get', P>,
  Error,
  ApiResponse<'get', P>,
  QueryKey
> & {
  queryFn: QueryFunction<ApiResponse<'get', P>, QueryKey>;
  queryKey: DataTag<QueryKey, ApiResponse<'get', P>, Error>;
};

/** Query options for a GET: `useQuery(apiQuery('/api/v1/me'))`. */
export function apiQuery<P extends ApiPath<'get'>>(path: P, ...[init]: QueryArgs<P>): ApiQueryOptions<P> {
  const client = init?.client ?? api;
  const parts = partsOf(init?.params);
  // The request sends what the key says, so one key never stands for two different requests
  const query = normalizeFilters(parts.query, init?.defaults);
  const key = queryKey(path, parts.path, query);
  const queryFn: QueryFunction<ApiResponse<'get', P>, QueryKey> = ({ signal }) =>
    send(client, 'get', path, { params: { path: parts.path, query }, signal });
  return { ...queryOptions({ queryKey: key, queryFn }), queryFn };
}

/** A GET whose answer is one page of a list paged by offset (19-api-specification.md section 2.5). */
export type OffsetListPath = {
  [P in ApiPath<'get'>]: ApiResponse<'get', P> extends { data: readonly unknown[]; page: { total: number } }
    ? P
    : never;
}[ApiPath<'get'>];

interface OffsetPageShape {
  data: readonly unknown[];
  page: Readonly<Record<string, unknown>> & { total: number };
}

/** The items of the offset-paged `P`. */
export type PageItem<P extends OffsetListPath> =
  ApiResponse<'get', P> extends { data: readonly (infer Item)[] } ? Item : never;

const isOffsetPage = (value: unknown): value is OffsetPageShape =>
  isRecord(value) && Array.isArray(value.data) && isRecord(value.page) && typeof value.page.total === 'number';

/*
 * The two guards below check a page's shape: like every answer of the typed client, the rest is trusted to
 * follow the API document. They name the types TypeScript cannot derive for a path that is still a type
 * parameter.
 */

/** Whether `value` is a page of the offset-paged `P`, with its items. */
const isPageOf = <P extends OffsetListPath>(
  value: unknown,
): value is OffsetPageShape & { data: readonly PageItem<P>[] } => isOffsetPage(value);

/** Whether `value` is an answer of the offset-paged `P`. */
const isAnswerOf = <P extends OffsetListPath>(value: unknown): value is ApiResponse<'get', P> => isOffsetPage(value);

const PAGING = new Set(['offset', 'limit']);

/**
 * Query options for every item of a list the API pages by offset: the pages are read one after another
 * (`readAllPages`, which tells the items apart by `idOf`) and answered as one page that holds them all, so
 * a screen reads `data` and `page.total` as it would for one page. For the lists a screen shows whole, such
 * as a workspace's members; `offset` and `limit` in `init` are ignored. The key differs from the key of one
 * page of the same list.
 */
export function apiAllPagesQuery<P extends OffsetListPath>(
  path: P,
  idOf: (item: PageItem<P>) => string,
  ...[init]: QueryArgs<P>
): ApiQueryOptions<P> {
  const client = init?.client ?? api;
  const parts = partsOf(init?.params);
  const filters = Object.fromEntries(Object.entries(parts.query).filter(([name]) => !PAGING.has(name)));
  const query = normalizeFilters(filters, init?.defaults);
  const key = queryKey(path, parts.path, { ...query, pages: 'all' });
  const queryFn: QueryFunction<ApiResponse<'get', P>, QueryKey> = async ({ signal }) => {
    // The first page answered carries the answer's fields besides the list
    const firsts: OffsetPageShape[] = [];
    const { items, total } = await readAllPages(async (offset, limit) => {
      const answer: unknown = await send(client, 'get', path, {
        params: { path: parts.path, query: { ...query, offset, limit } },
        signal,
      });
      if (!isPageOf<P>(answer)) throw new Error(`${path} did not answer a page of a list`);
      if (firsts.length === 0) firsts.push(answer);
      return answer;
    }, idOf);
    const [first] = firsts;
    const whole: unknown =
      first === undefined ? null : { ...first, data: items, page: { ...first.page, offset: 0, total } };
    if (!isAnswerOf<P>(whole)) throw new Error(`${path} answered no page`);
    return whole;
  };
  return { ...queryOptions({ queryKey: key, queryFn }), queryFn };
}

/**
 * Mutation options for a write. The variables are the typed parameters and body of the request:
 * `useMutation(apiMutation('patch', '/api/v1/workspaces/{workspace_id}'))`, then
 * `mutate({ params: { path: { workspace_id } }, body: { name } })`.
 */
export function apiMutation<M extends WriteMethod, P extends ApiPath<M>>(
  method: M,
  path: P,
  { client = api }: { client?: ApiClient } = {},
): UseMutationOptions<ApiResponse<M, P>, Error, ApiInit<M, P>> {
  return mutationOptions<ApiResponse<M, P>, Error, ApiInit<M, P>>({
    mutationKey: [method, path],
    mutationFn: (variables) => send(client, method, path, variables ?? {}),
  });
}
