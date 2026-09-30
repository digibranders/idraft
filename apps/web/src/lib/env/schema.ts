import { z } from 'zod';

import { APP_ENVIRONMENTS, DEFAULT_RELEASE, MOCKING_MODES, type AppEnvironment, type PublicEnv } from './public';

/**
 * Validation of the environment (20 section 9.2). Used where the values enter: next.config.ts for the
 * public ones, the server start for the server ones. It is not imported by client code, which keeps zod
 * out of the browser bundle.
 */
const LOCAL_API_ORIGIN = 'http://127.0.0.1:8000';

/** An origin is scheme, host and port: the generated API paths already start with /api/v1. */
function isHttpOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
}
const origin = z
  .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be text') })
  .refine(isHttpOrigin, {
    error:
      'must be an http or https origin written the way a browser writes it, such as http://api:8000: lower-case host, no default port, no path, no trailing slash',
  });

const publicSchema = z
  .object({
    NEXT_PUBLIC_APP_ENV: z.enum(APP_ENVIRONMENTS).default('development'),
    NEXT_PUBLIC_API_MOCKING: z.enum(MOCKING_MODES).default('off'),
    NEXT_PUBLIC_RELEASE: z.string().trim().min(1).default(DEFAULT_RELEASE),
  })
  .refine((value) => value.NEXT_PUBLIC_APP_ENV !== 'production' || value.NEXT_PUBLIC_API_MOCKING === 'off', {
    path: ['NEXT_PUBLIC_API_MOCKING'],
    error: 'must be off in production: mocked responses would be served to real users',
  });

const serverSchema = z.object({
  API_INTERNAL_ORIGIN: origin,
  API_PROXY_TARGET: origin.optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
type Source = Readonly<Record<string, string | undefined>>;

/** An unset variable and a blank one are the same: Compose passes `VAR=` for a variable without a value. */
const present = (source: Source): Record<string, string> =>
  Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '',
    ),
  );

function parse<T>(schema: z.ZodType<T>, source: Record<string, string>): T {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`);
  throw new Error(`Invalid environment. ${problems.join('. ')}.`);
}

export function parsePublicEnv(source: Source): PublicEnv {
  return parse(publicSchema, present(source));
}

/**
 * The API is on the same machine in development and in tests, so its origin has a default there. In
 * production it must be set: a wrong guess would send server-side requests nowhere.
 *
 * `appEnv` is the environment the bundle was built for. It is passed in, not read from `source`: the
 * server may be started without NEXT_PUBLIC_APP_ENV, and a production image must not fall back to the
 * development default because of that.
 */
export function parseServerEnv(source: Source, appEnv: AppEnvironment): ServerEnv {
  const values = present(source);
  if (appEnv !== 'production') return parse(serverSchema, { API_INTERNAL_ORIGIN: LOCAL_API_ORIGIN, ...values });
  if (values.API_PROXY_TARGET !== undefined) {
    throw new Error(
      'Invalid environment. API_PROXY_TARGET: is for development only. In production the reverse proxy routes /api to the API.',
    );
  }
  return parse(serverSchema, values);
}
