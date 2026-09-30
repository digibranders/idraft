import 'server-only';

import { headers } from 'next/headers';

import { createApiClient, type ApiClient } from './client';
import { serverEnv } from '@/lib/env/server';
import { REQUEST_ID_HEADER, isRequestId, newRequestId } from '@/lib/request-id';

/**
 * A client on `origin` for the page request whose headers are `incoming`. It sends the session cookie and
 * one request id, and nothing else of that request, least of all an `authorization` header a caller put
 * on it (20-frontend-specification.md section 3.5). Responses are never cached.
 *
 * The request id is the page render's when it is in the API's format (the web server mints it, Task 10),
 * so the page and its API calls share one id in both logs; otherwise the render gets one of its own.
 */
export function createServerApi(incoming: Headers, origin: string): ApiClient {
  const cookie = incoming.get('cookie');
  const forwardedId = incoming.get(REQUEST_ID_HEADER);
  const requestId = forwardedId !== null && isRequestId(forwardedId) ? forwardedId : newRequestId();
  return createApiClient({
    baseUrl: origin,
    headers: cookie === null ? {} : { cookie },
    requestId: () => requestId,
    cache: 'no-store',
  });
}

/**
 * The client for Server Components and route handlers: it calls the API over the internal network, as the
 * person whose request is being rendered.
 */
export async function serverApi(): Promise<ApiClient> {
  return createServerApi(await headers(), serverEnv().API_INTERNAL_ORIGIN);
}
