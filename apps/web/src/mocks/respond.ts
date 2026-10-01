import {
  http,
  HttpResponse,
  type DefaultBodyType,
  type HttpHandler,
  type HttpResponseResolver,
  type PathParams,
} from 'msw';

import type { ApiPath, ApiResponse } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';
import type { Problem, ValidationItem } from '@/lib/api/types';
import { isRequestId, newRequestId, REQUEST_ID_HEADER } from '@/lib/request-id';

/**
 * Typed MSW handlers. A handler names a generated path and method, so its path parameters, request body and
 * response body are checked against the OpenAPI document: a contract change breaks the mocks at compile
 * time instead of letting them drift from the API.
 */

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Operation<M extends Method, P extends ApiPath<M>> = paths[P][M];
type ParamNames<M extends Method, P extends ApiPath<M>> =
  Operation<M, P> extends { parameters: { path: infer Path } } ? keyof Path & string : never;
type RequestBody<M extends Method, P extends ApiPath<M>> =
  Operation<M, P> extends { requestBody?: { content: { 'application/json': infer Body extends DefaultBodyType } } }
    ? Body
    : never;
/** What a handler may answer: the success body of the path (no body for a 204), or a problem. */
export type MockBody<M extends Method, P extends ApiPath<M>> =
  (ApiResponse<M, P> extends undefined ? null : ApiResponse<M, P>) | Problem;

/** The largest request body the API reads (19 section 2.7, `413 payload_too_large`). */
const MAX_BODY_BYTES = 1024 * 1024;

/** `/api/v1/workspaces/{workspace_id}` as an MSW path on any origin: `*\/api/v1/workspaces/:workspace_id`. */
export const mswPath = (path: string): string => `*${path.replace(/\{([^}]+)\}/g, ':$1')}`;

export function mock<M extends Method, P extends ApiPath<M>>(
  method: M,
  path: P,
  resolver: HttpResponseResolver<PathParams<ParamNames<M, P>>, RequestBody<M, P>, MockBody<M, P>>,
  /** A route with its own larger limit (the keyword upload, D11) checks it in its resolver. */
  { maxBodyBytes = MAX_BODY_BYTES }: { maxBodyBytes?: number } = {},
): HttpHandler {
  return http[method]<PathParams<ParamNames<M, P>>, RequestBody<M, P>, MockBody<M, P>>(mswPath(path), async (info) => {
    // The API refuses any body over 1 MB before it reads it (backend middleware)
    if (method !== 'get' && (await info.request.clone().arrayBuffer()).byteLength > maxBodyBytes) {
      return problem(info.request, 'payload_too_large', {
        detail: `A request body is at most ${String(Math.round(maxBodyBytes / (1024 * 1024)))} MB.`,
      });
    }
    return resolver(info);
  });
}

/**
 * The request id of a response. The API keeps a valid incoming `X-Request-Id` and answers with it, so the
 * mocks do the same (25-observability.md section 3.3).
 */
export function requestIdOf(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  return incoming !== null && isRequestId(incoming) ? incoming : newRequestId();
}

/**
 * The problems the mocks send, with the status and title the API gives each code (backend problems.py). The
 * step 4 codes the backend has not built yet carry the status of 19 section 2.7 and the catalog, and a title
 * of the same style.
 */
const PROBLEMS = {
  validation_failed: [422, 'Request validation failed'],
  invalid_token: [400, 'Link is not valid'],
  invalid_cursor: [400, 'Cursor is not valid'],
  unauthenticated: [401, 'Authentication required'],
  session_expired: [401, 'Session expired'],
  invalid_credentials: [401, 'Email or password is not correct'],
  invalid_code: [401, 'Code is not correct'],
  forbidden: [403, 'Not allowed'],
  fresh_session_required: [403, 'Recent sign-in required'],
  second_factor_required: [403, 'A two-factor code is required'],
  registration_closed: [403, 'Registration is by invitation'],
  not_found: [404, 'Resource not found'],
  email_not_verified: [403, 'Email address not verified'],
  workspace_suspended: [403, 'Workspace is suspended'],
  duplicate: [409, 'Already exists'],
  last_owner: [409, 'The workspace needs an owner'],
  invalid_state_transition: [409, 'Not possible in this state'],
  entity_in_use: [409, 'Entity is in use'],
  cannot_remove_primary_own: [409, 'The primary own entity cannot be removed'],
  has_children: [409, 'Term has children'],
  schedule_in_use: [409, 'Schedule is in use'],
  payload_too_large: [413, 'Payload too large'],
  unsupported_media_type: [415, 'Unsupported media type'],
  quota_exceeded: [422, 'Workspace limit reached'],
  too_many_subjects: [422, 'Too many subjects'],
  competitor_limit: [422, 'Competitor limit reached'],
  cycle_detected: [422, 'Would make a cycle'],
  too_many_matches: [422, 'Too many matches'],
  // The mocks' own: what a browser changed no longer fits in its cookie
  mock_state_full: [422, 'Mock state is full'],
  weak_password: [422, 'Password is not strong enough'],
  rate_limited: [429, 'Too many requests'],
  manual_run_limit: [429, 'Manual run limit reached'],
} as const satisfies Record<string, readonly [number, string]>;

export type MockProblemCode = keyof typeof PROBLEMS;

/**
 * A problem response as the API sends it: RFC 9457 JSON with the code, the request id and any extension.
 * An extension never replaces a standard member, as in the API.
 */
export function problem(
  request: Request,
  code: MockProblemCode,
  {
    detail,
    headers = {},
    ...extensions
  }: { detail?: string; headers?: Record<string, string> } & Record<string, unknown> = {},
): HttpResponse<Problem> {
  const [status, title] = PROBLEMS[code];
  const requestId = requestIdOf(request);
  const body: Problem = {
    ...extensions,
    type: `https://sightline.test/api/problems/${code}`,
    title,
    status,
    code,
    instance: new URL(request.url).pathname,
    request_id: requestId,
    ...(detail === undefined ? {} : { detail }),
  };
  return HttpResponse.json(body, {
    status,
    headers: { 'content-type': 'application/problem+json', [REQUEST_ID_HEADER]: requestId, ...headers },
  });
}

/** A `403 fresh_session_required`, with where to re-authenticate (19 section 2.7). */
export const freshSessionRequired = (request: Request): HttpResponse<Problem> =>
  problem(request, 'fresh_session_required', { reauth_url: '/api/v1/me/reauthenticate' });

/** A `422 validation_failed` with these field errors in the body. */
export function invalid(request: Request, errors: readonly ValidationItem[]): HttpResponse<Problem> {
  return problem(request, 'validation_failed', {
    detail: errors.length === 1 ? '1 field is invalid.' : `${String(errors.length)} fields are invalid.`,
    errors,
  });
}

/** A `422 validation_failed` with one field error in the body. */
export const invalidField = (request: Request, path: string, code: string, message: string): HttpResponse<Problem> =>
  invalid(request, [{ location: 'body', path, code, message }]);

export interface BodyRules {
  /** Members that must be present, as text. */
  required?: readonly string[];
  /** Members that may be present, as text or null. */
  optional?: readonly string[];
  /** Exactly one of these must be given (text, not null), as for a code or a recovery code. */
  exactlyOne?: readonly string[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks a JSON body the way the API's Pydantic models do: every request model forbids unknown members
 * (`extra_forbidden`), and required members must be there. Returns the `422` to answer, or `null` when the
 * body is fine. Typed handlers read the body afterwards, so a missing member never becomes a crash.
 */
export function checkBody(request: Request, body: unknown, rules: BodyRules): HttpResponse<Problem> | null {
  if (!isRecord(body)) return invalidField(request, '', 'model_attributes_type', 'Input should be an object');
  const { required = [], optional = [], exactlyOne = [] } = rules;
  const allowed = new Set([...required, ...optional, ...exactlyOne]);
  const errors: ValidationItem[] = [];
  for (const name of Object.keys(body)) {
    if (!allowed.has(name)) {
      errors.push({ location: 'body', path: name, code: 'extra_forbidden', message: 'Extra inputs are not permitted' });
    }
  }
  for (const name of required) {
    if (typeof body[name] !== 'string') {
      errors.push({ location: 'body', path: name, code: 'missing', message: 'Field required' });
    }
  }
  for (const name of optional) {
    const value = body[name];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push({ location: 'body', path: name, code: 'string_type', message: 'Input should be a valid string' });
    }
  }
  if (exactlyOne.length > 0 && exactlyOne.filter((name) => typeof body[name] === 'string').length !== 1) {
    errors.push({
      location: 'body',
      path: '',
      code: 'value_error',
      message: `Give exactly one of ${exactlyOne.join(', ')}`,
    });
  }
  return errors.length === 0 ? null : invalid(request, errors);
}

/** The `extra_forbidden` errors for members of `body` outside `allowed`, as every request model of the API gives. */
export function unknownMembers(body: Readonly<Record<string, unknown>>, allowed: readonly string[]): ValidationItem[] {
  return Object.keys(body)
    .filter((name) => !allowed.includes(name))
    .map((name) => ({
      location: 'body',
      path: name,
      code: 'extra_forbidden',
      message: 'Extra inputs are not permitted',
    }));
}

/** A `204 No Content`. */
export const noContent = (headers: Record<string, string> = {}): HttpResponse<null> =>
  new HttpResponse(null, { status: 204, headers });
