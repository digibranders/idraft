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
