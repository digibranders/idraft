import { describe, expect, it } from 'vitest';

import { ApiProblem, HTTP_ERROR, isApiProblem, problemFrom } from './problem';

const response = (status: number, headers: Record<string, string> = {}, statusText = ''): Response =>
  new Response(null, { status, headers, statusText });

const VALIDATION = {
  type: 'https://sightline.test/api/problems/validation_failed',
  title: 'Request validation failed',
  status: 422,
  detail: '2 fields are invalid.',
  instance: '/api/v1/workspaces',
  code: 'validation_failed',
  request_id: 'req_01J9ZC4W8Q2T6V3K5M7N9P1R3S',
  errors: [
    { location: 'body', path: 'slug', code: 'slug_reserved', message: 'This word is reserved.' },
    { location: 'body', path: 'name', code: 'string_too_long', message: 'At most 80 characters.' },
  ],
};

describe('problemFrom', () => {
  it('reads a full problem body', () => {
    const problem = problemFrom(response(422), VALIDATION);
    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem).toBeInstanceOf(Error);
    expect(problem).toMatchObject({
      name: 'ApiProblem',
      status: 422,
      code: 'validation_failed',
      detail: '2 fields are invalid.',
      requestId: 'req_01J9ZC4W8Q2T6V3K5M7N9P1R3S',
      retryAfterSeconds: null,
      message: '422 validation_failed: 2 fields are invalid.',
    });
    expect(problem.errors).toEqual(VALIDATION.errors);
  });

  it('keeps extension members in body and reads them typed', () => {
    const problem = problemFrom(response(422), {
      ...VALIDATION,
      code: 'quota_exceeded',
      errors: undefined,
      limit: 5,
      used: 5,
      requested: 1,
      reauth_url: '/login/reauthenticate',
    });
    expect(problem.body).toMatchObject({ limit: 5, used: 5, requested: 1 });
    expect(problem.number('limit')).toBe(5);
    expect(problem.number('reauth_url')).toBeNull();
    expect(problem.string('reauth_url')).toBe('/login/reauthenticate');
    expect(problem.string('limit')).toBeNull();
    expect(problem.number('missing')).toBeNull();
  });

  it('has no field errors when the body has none, and drops items that are not field errors', () => {
    const withoutErrors = Object.fromEntries(Object.entries(VALIDATION).filter(([name]) => name !== 'errors'));
    expect(problemFrom(response(422), withoutErrors).errors).toEqual([]);
    const mixed = problemFrom(response(422), {
      ...VALIDATION,
      errors: [VALIDATION.errors[0], { path: 'name' }, 'oops', null],
    });
    expect(mixed.errors).toEqual([VALIDATION.errors[0]]);
    expect(problemFrom(response(422), { ...VALIDATION, errors: 'not a list' }).errors).toEqual([]);
  });

  it('turns a body that is not problem JSON into an http_error with the response status', () => {
    const html = problemFrom(response(502, {}, 'Bad Gateway'), '<html><body>502 Bad Gateway</body></html>');
    expect(html).toMatchObject({ status: 502, code: HTTP_ERROR, detail: null, requestId: null, errors: [] });
    expect(html.body).toEqual({});
    expect(html.message).toBe('502 http_error: Bad Gateway');
    expect(problemFrom(response(504), undefined)).toMatchObject({ status: 504, code: HTTP_ERROR });
    expect(problemFrom(response(500), ['a', 'list'])).toMatchObject({ code: HTTP_ERROR, body: {} });
    expect(problemFrom(response(503), { code: '   ' }).code).toBe(HTTP_ERROR);
    expect(problemFrom(response(500), null).message).toBe('500 http_error: HTTP 500');
  });

  it('takes the status from the response, not from the body', () => {
    expect(problemFrom(response(409), { ...VALIDATION, status: 200, code: 'conflict' }).status).toBe(409);
  });

  it('falls back to the x-request-id header for the request id', () => {
    const problem = problemFrom(response(502, { 'x-request-id': 'req_proxy' }), 'Bad Gateway');
    expect(problem.requestId).toBe('req_proxy');
  });

  it('reads Retry-After as whole seconds', () => {
    expect(problemFrom(response(429, { 'retry-after': '12' }), {}).retryAfterSeconds).toBe(12);
    expect(problemFrom(response(429, { 'retry-after': ' 0 ' }), {}).retryAfterSeconds).toBe(0);
  });

  it('reads Retry-After as an HTTP date, counted from now and never negative', () => {
    const now = Date.parse('Wed, 30 Sep 2026 10:00:00 GMT');
    const later = response(503, { 'retry-after': 'Wed, 30 Sep 2026 10:01:30 GMT' });
    expect(problemFrom(later, {}, now).retryAfterSeconds).toBe(90);
    const past = response(503, { 'retry-after': 'Wed, 30 Sep 2026 09:00:00 GMT' });
    expect(problemFrom(past, {}, now).retryAfterSeconds).toBe(0);
  });

  it('reads the two obsolete HTTP date forms too, and no other text', () => {
    const now = Date.parse('Wed, 30 Sep 2026 10:00:00 GMT');
    const rfc850 = response(503, { 'retry-after': 'Wednesday, 30-Sep-26 10:00:30 GMT' });
    expect(problemFrom(rfc850, {}, now).retryAfterSeconds).toBe(30);
    const asctime = response(503, { 'retry-after': 'Wed Sep 30 10:01:00 2026' });
    expect(problemFrom(asctime, {}, now).retryAfterSeconds).not.toBeNull();
    for (const text of ['abc 1', 'tomorrow', '1.5', '1e3', 'Infinity']) {
      expect(problemFrom(response(503, { 'retry-after': text }), {}, now).retryAfterSeconds, text).toBeNull();
    }
  });

  it('falls back to retry_after_seconds in the body, and ignores a Retry-After it cannot read', () => {
    expect(problemFrom(response(429), { code: 'rate_limited', retry_after_seconds: 7 }).retryAfterSeconds).toBe(7);
    expect(problemFrom(response(429), { retry_after_seconds: 2.2 }).retryAfterSeconds).toBe(3);
    expect(problemFrom(response(429), { retry_after_seconds: -1 }).retryAfterSeconds).toBeNull();
    expect(problemFrom(response(429), { retry_after_seconds: '7' }).retryAfterSeconds).toBeNull();
    const unreadable = response(429, { 'retry-after': 'soon' });
    expect(problemFrom(unreadable, { retry_after_seconds: 4 }).retryAfterSeconds).toBe(4);
    expect(problemFrom(response(429, { 'retry-after': '-5' }), {}).retryAfterSeconds).toBeNull();
  });
});

describe('isApiProblem', () => {
  const problem = problemFrom(response(401), { ...VALIDATION, code: 'session_expired' });

  it('recognizes an ApiProblem, and only that', () => {
    expect(isApiProblem(problem)).toBe(true);
    expect(isApiProblem(new Error('session_expired'))).toBe(false);
    expect(isApiProblem({ code: 'session_expired', status: 401 })).toBe(false);
    expect(isApiProblem(null)).toBe(false);
  });

  it('matches the code when one is given', () => {
    expect(isApiProblem(problem, 'session_expired')).toBe(true);
    expect(isApiProblem(problem, 'unauthenticated')).toBe(false);
  });
});
