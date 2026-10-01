import { z } from 'zod';

import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import type { Role } from '@/lib/api/types';
import { TEST_API_ORIGIN } from '@/test/api-server';

/**
 * A browser for the mock handlers' tests: it signs in as a fixture role and keeps the mock cookies each answer
 * sets (the workspace and entity state), so a test can chain requests the way a page would. Answers are read
 * through zod shapes (./api-shapes.ts), never cast.
 */

export interface Answer {
  status: number;
  body: Record<string, unknown>;
  /** The problem code, for an error. */
  code: string | undefined;
  /** The `name=value` of the cookie the answer set, if any. */
  setCookie: string | undefined;
}

export interface MockBrowser {
  call: (method: string, path: string, body?: unknown) => Promise<Answer>;
  /** The same cookies, signed in as another fixture role. */
  as: (role: Role) => MockBrowser;
  /** The value of a cookie the answers set. */
  cookie: (name: string) => string | undefined;
}

const BODY = z.record(z.string(), z.unknown());
const FIELD_ERRORS = z.object({ errors: z.array(z.object({ path: z.string(), code: z.string() })).optional() });

export function mockBrowser(role: Role, jar: Map<string, string> = new Map()): MockBrowser {
  const session = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 10 * 60 * 1000)}`;
  return {
    async call(method, path, body) {
      const response = await fetch(`${TEST_API_ORIGIN}${path}`, {
        method,
        headers: {
          cookie: [session, ...[...jar].map(([name, value]) => `${name}=${value}`)].join('; '),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
      const text = await response.text();
      const parsed = text === '' ? {} : BODY.parse(JSON.parse(text));
      const setCookie = response.headers.get('set-cookie')?.split(';')[0];
      if (setCookie !== undefined) {
        const [name = '', ...value] = setCookie.split('=');
        jar.set(name, value.join('='));
      }
      return {
        status: response.status,
        body: parsed,
        code: typeof parsed.code === 'string' ? parsed.code : undefined,
        setCookie,
      };
    },
    as: (other) => mockBrowser(other, jar),
    cookie: (name) => jar.get(name),
  };
}

/** `path:code` of each field error of a `422 validation_failed`. */
export const fieldCodes = (answer: Answer): string[] =>
  (FIELD_ERRORS.parse(answer.body).errors ?? []).map((error) => `${error.path}:${error.code}`);

/** The `data` member of an answer, checked against `shape`. */
export const dataOf = <T>(answer: Answer, shape: z.ZodType<T>): T => shape.parse(answer.body.data);

/** The `page` member of an answer, checked against `shape`. */
export const pageOf = <T>(answer: Answer, shape: z.ZodType<T>): T => shape.parse(answer.body.page);
