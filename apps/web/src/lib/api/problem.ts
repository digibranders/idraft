import type { ValidationItem } from './types';

/**
 * An error response of the API as the app handles it (19-api-specification.md section 2.7). Every error
 * body is RFC 9457 problem JSON, but a request can also be answered by something in front of the API (a
 * proxy's HTML 502, an empty 504), so the fields are read defensively and never trusted to exist.
 */

/** The code of a response whose body is not problem JSON. */
export const HTTP_ERROR = 'http_error';

type Body = Readonly<Record<string, unknown>>;

interface ApiProblemInit {
  status: number;
  code: string;
  title: string;
  detail: string | null;
  requestId: string | null;
  errors: readonly ValidationItem[];
  retryAfterSeconds: number | null;
  body: Body;
}

export class ApiProblem extends Error {
  /** The HTTP status of the response, which wins over a `status` member in the body. */
  readonly status: number;
  /** The stable machine value (`not_found`, `validation_failed`, ...), or `http_error`. */
  readonly code: string;
  /** For people; may change. `null` when the body has none. */
  readonly detail: string | null;
  readonly requestId: string | null;
  /** The field errors of a `validation_failed` problem, empty for every other code. */
  readonly errors: readonly ValidationItem[];
  /** How long to wait before asking again, from `Retry-After` or the body's `retry_after_seconds`. */
  readonly retryAfterSeconds: number | null;
  /** The whole body, extension members included (`limit`, `used`, `reauth_url`, ...). */
  readonly body: Body;

  constructor(init: ApiProblemInit) {
    super(`${String(init.status)} ${init.code}: ${init.detail ?? init.title}`);
    this.name = 'ApiProblem';
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.errors = init.errors;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.body = init.body;
  }

  /** A numeric extension member, such as `limit`, `used` or `requested` on `quota_exceeded`. */
  number(name: string): number | null {
    const value = this.body[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** A text extension member, such as `reauth_url` on `fresh_session_required`. */
  string(name: string): string | null {
    const value = this.body[name];
    return typeof value === 'string' ? value : null;
  }
}

const isRecord = (value: unknown): value is Body =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

function isValidationItem(value: unknown): value is ValidationItem {
  return (
    isRecord(value) &&
    typeof value.location === 'string' &&
    typeof value.path === 'string' &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}

/** Whole seconds, or an HTTP date (RFC 9110 section 10.2.3). A date in the past means now. */
function retryAfterHeader(value: string | null, now: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // The three HTTP date forms open with the weekday and close with GMT or the year. Anything else goes no
  // further, because Date.parse reads almost any text as some date ("-5" is a year, "abc 1" a day)
  if (!/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,? .*(gmt|\d{4})$/i.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

function retryAfterBody(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
}

/**
 * The `ApiProblem` for an error response and its parsed body (JSON, or the text when it was not JSON, or
 * nothing). It never throws: whatever answered, the caller gets a problem it can branch on.
 */
export function problemFrom(response: Response, body: unknown, now: number = Date.now()): ApiProblem {
  const record = isRecord(body) ? body : {};
  const code = text(record.code);
  return new ApiProblem({
    status: response.status,
    code: code ?? HTTP_ERROR,
    title: text(record.title) ?? text(response.statusText) ?? `HTTP ${String(response.status)}`,
    detail: text(record.detail),
    requestId: text(record.request_id) ?? text(response.headers.get('x-request-id')),
    errors: Array.isArray(record.errors) ? record.errors.filter(isValidationItem) : [],
    retryAfterSeconds:
      retryAfterHeader(response.headers.get('retry-after'), now) ?? retryAfterBody(record.retry_after_seconds),
    body: record,
  });
}

const SECONDS_PER_MINUTE = 60;

/** The wait of a `429 rate_limited` in whole minutes, at least one, for a sentence that says when to retry. */
export function retryMinutes(problem: Pick<ApiProblem, 'retryAfterSeconds'>): number {
  return Math.max(1, Math.ceil((problem.retryAfterSeconds ?? SECONDS_PER_MINUTE) / SECONDS_PER_MINUTE));
}

/** Whether `error` is an `ApiProblem`, and when `code` is given, one with that code. */
export function isApiProblem(error: unknown, code?: string): error is ApiProblem {
  return error instanceof ApiProblem && (code === undefined || error.code === code);
}
