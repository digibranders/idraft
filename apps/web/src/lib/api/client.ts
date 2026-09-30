import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch';

import { apiFetch } from './api-fetch';
import { HTTP_ERROR, problemFrom } from './problem';
import type { paths } from './schema';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';

/**
 * The typed HTTP client (20-frontend-specification.md section 3.5). openapi-fetch is the only way the app
 * talks to the API: paths, parameters, bodies and responses are checked against the generated schema.
 */
export type ApiClient = Client<paths>;

/**
 * A list parameter is sent once, comma-separated (`filter[status_in]=active,paused`), the form the API
 * documents and the URL state uses. The client adds no query parameter of its own: the API refuses one it
 * does not declare (422 `extra_forbidden`).
 */
const QUERY_SERIALIZER = { array: { style: 'form', explode: false } } as const;

/**
 * `fetch` is looked up at each call, not when the client is made (./api-fetch.ts): openapi-fetch would
 * otherwise keep the function it found at import, and miss a fetch that is wrapped later (Next.js on the
 * server, MSW in tests). The second argument is openapi-fetch's `requestInitExt`, passed on untouched.
 */
const lateFetch = (request: Request, init?: RequestInit): Promise<Response> => apiFetch(request, init);

/** Gives every request an `X-Request-Id` (25-observability.md section 3.3), unless it already has one. */
function requestIdMiddleware(requestId: () => string): Middleware {
  return {
    onRequest: ({ request }) => {
      if (!request.headers.has(REQUEST_ID_HEADER)) request.headers.set(REQUEST_ID_HEADER, requestId());
      return request;
    },
  };
}

const isJson = (contentType: string | null): boolean => contentType !== null && /[/+]json\b/i.test(contentType);

/**
 * A 2xx with a body that is not JSON did not come from the API (a captive portal, a proxy's page). It
 * becomes an `http_error` problem here, instead of a `SyntaxError` that would look like a lost connection.
 */
const nonJsonGuard: Middleware = {
  onResponse: async ({ response }) => {
    if (!response.ok || response.status === 204 || isJson(response.headers.get('content-type'))) return undefined;
    const body = await response.clone().text();
    if (body === '') return undefined;
    const problem = problemFrom(response, body);
    if (problem.code !== HTTP_ERROR) return undefined;
    throw problem;
  },
};

export interface ApiClientOptions extends Omit<ClientOptions, 'querySerializer' | 'fetch'> {
  /** The id each request carries. A new one per request unless given. */
  requestId?: (() => string) | undefined;
}

/** A client for `Paths`, with the serializer, the request id and the non-JSON guard every client needs. */
export function createTypedClient<Paths extends object>({
  requestId = newRequestId,
  ...options
}: ApiClientOptions = {}): Client<Paths> {
  const client = createClient<Paths>({ querySerializer: QUERY_SERIALIZER, fetch: lateFetch, ...options });
  client.use(requestIdMiddleware(requestId), nonJsonGuard);
  return client;
}

export const createApiClient = (options: ApiClientOptions = {}): ApiClient => createTypedClient<paths>(options);

/**
 * The options of a browser client. The generated paths start with `/api/v1`, so the base is the page's own
 * origin: every call is same-origin and carries the session cookie without CORS. On the server there is no
 * page origin, and the server client of ./server.ts is used instead.
 */
export const BROWSER_CLIENT_OPTIONS: ApiClientOptions = {
  baseUrl: typeof window === 'undefined' ? '' : window.location.origin,
  credentials: 'same-origin',
};

/** The browser client. */
export const api: ApiClient = createApiClient(BROWSER_CLIENT_OPTIONS);

/** What an openapi-fetch call resolves to: the parsed body on success, the parsed error body otherwise. */
type Success<Data> = { data: Data; error?: never; response: Response };
type Outcome<Data, Failure> = Success<Data> | { data?: never; error: Failure; response: Response };

/**
 * Whether the call succeeded. The status decides: an error response with an empty body arrives without
 * `error`, and openapi-fetch parses the body of any 2xx as data.
 */
function succeeded<Data, Failure>(outcome: Outcome<Data, Failure>): outcome is Success<Data> {
  return outcome.response.ok && outcome.error === undefined;
}

/**
 * The body of a successful response, or an `ApiProblem` thrown for any other. A request that got no
 * response at all rejects with the fetch error itself, which the retry policy treats as retryable.
 */
export async function unwrap<Data, Failure>(request: Promise<Outcome<Data, Failure>>): Promise<Data> {
  const outcome = await request;
  if (!succeeded(outcome)) throw problemFrom(outcome.response, outcome.error);
  return outcome.data;
}
