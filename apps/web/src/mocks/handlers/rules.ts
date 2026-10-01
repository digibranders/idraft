import { decodeJson, encodeJson } from '../cookie-json';
import { isPublicSuffix } from '../factories/domain';
import type { ValidationItem } from '@/lib/api/types';
import { normalizeDomain } from '@/lib/domains/normalize';

/**
 * Request rules the entity, taxonomy and registry mocks share: field errors shaped like Pydantic's
 * (19 section 2.7), query parameters, cursor pages (19 section 2.4), and the domain and alias inputs of
 * 19 section 3.4 with the backend's field codes (`invalid_domain`, `domain_is_public_suffix`,
 * `path_prefix_mismatch`, `invalid_path_prefix`, `invalid_regex`).
 */

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const bodyError = (path: string, code: string, message: string): ValidationItem => ({
  location: 'body',
  path,
  code,
  message,
});

export const queryError = (path: string, code: string, message: string): ValidationItem => ({
  location: 'query',
  path,
  code,
  message,
});

/** `prefix.name`, or `name` at the root of the body. */
export const at = (prefix: string, name: string | number): string =>
  prefix === '' ? String(name) : `${prefix}.${String(name)}`;

/** The `extra_forbidden` errors of the query parameters the route does not have (19 section 2.4). */
export const unknownQuery = (url: URL, allowed: readonly string[]): ValidationItem[] =>
  [...new Set(url.searchParams.keys())]
    .filter((name) => !allowed.includes(name))
    .sort()
    .map((name) => queryError(name, 'extra_forbidden', 'Unknown parameter.'));

/** The `extra_forbidden` errors of the members of `body` outside `allowed`, at `prefix`. */
export const extraMembers = (
  body: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  prefix = '',
): ValidationItem[] =>
  Object.keys(body)
    .filter((name) => !allowed.includes(name))
    .map((name) => bodyError(at(prefix, name), 'extra_forbidden', 'Extra inputs are not permitted'));

/** The `null_not_allowed` errors of members a partial update may leave out but not clear. */
export const nullErrors = (body: Readonly<Record<string, unknown>>, names: readonly string[]): ValidationItem[] =>
  names
    .filter((name) => name in body && body[name] === null)
    .map((name) => bodyError(name, 'null_not_allowed', 'Cannot be null.'));

/** The error of a body that is not an object, as Pydantic gives it. */
export const notAnObject = (path = ''): ValidationItem =>
  bodyError(path, 'model_attributes_type', 'Input should be an object');

/** A boolean member, or the error of one that is not. */
export function booleanError(value: unknown, path: string): ValidationItem[] {
  return value === undefined || typeof value === 'boolean'
    ? []
    : [bodyError(path, 'bool_type', 'Input should be a valid boolean')];
}

/** A text member within its length, or its error; `undefined` stands for a member left out. */
export function textError(
  value: unknown,
  path: string,
  { min = 1, max }: { min?: number; max: number },
): ValidationItem[] {
  if (value === undefined) return [];
  if (typeof value !== 'string') return [bodyError(path, 'string_type', 'Input should be a valid string')];
  if (value.length < min) return [bodyError(path, 'string_too_short', `At least ${String(min)} character.`)];
  if (value.length > max) return [bodyError(path, 'string_too_long', `At most ${String(max)} characters.`)];
  return [];
}

/** One of `allowed`, or the `enum` error. */
export const enumError = (value: unknown, path: string, allowed: readonly string[]): ValidationItem[] =>
  value === undefined || (typeof value === 'string' && allowed.includes(value))
    ? []
    : [bodyError(path, 'enum', `Allowed: ${allowed.join(', ')}.`)];

/** Whether `value` is one of `allowed`, for narrowing after the errors were answered. */
export const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && allowed.some((option) => option === value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A uuid member, or its error; `null` passes when the member may be null. */
export function uuidError(value: unknown, path: string, { nullable = false } = {}): ValidationItem[] {
  if (value === undefined || (nullable && value === null)) return [];
  return typeof value === 'string' && UUID.test(value)
    ? []
    : [bodyError(path, 'uuid_parsing', 'Input should be a valid UUID')];
}

/** A `true` or `false` query parameter, its default when left out, or the error of anything else. */
export function booleanQuery(url: URL, name: string, fallback: boolean): boolean | ValidationItem {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return queryError(name, 'bool_parsing', 'Input should be a valid boolean');
}

// Cursor pages (19 section 2.4).

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_CURSOR_LENGTH = 512;

export interface PageRequest {
  limit: number;
  cursor: string | null;
}

/** `limit` and `cursor`, or their errors. */
export function pageRequest(url: URL): PageRequest | ValidationItem[] {
  const raw = url.searchParams.get('limit');
  const limit = raw === null ? DEFAULT_LIMIT : Number(raw);
  const errors: ValidationItem[] = [];
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    errors.push(queryError('limit', 'value_error', `Use a whole number from 1 to ${String(MAX_LIMIT)}.`));
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && cursor.length > MAX_CURSOR_LENGTH) {
    errors.push(queryError('cursor', 'string_too_long', `At most ${String(MAX_CURSOR_LENGTH)} characters.`));
  }
  return errors.length > 0 ? errors : { limit, cursor };
}

export interface CursorPage<T> {
  data: T[];
  page: { limit: number; next_cursor: string | null; has_more: boolean };
}

/**
 * One page of `rows`, which are already in their order. The cursor is opaque to the client; here it holds the
 * position and the filters it was made for, so reusing it with other filters is refused as the API refuses it
 * (`400 invalid_cursor`). `null` stands for that refusal.
 */
export function cursorPage<T>(rows: readonly T[], request: PageRequest, filters: string): CursorPage<T> | null {
  let offset = 0;
  if (request.cursor !== null) {
    let position: unknown;
    try {
      position = decodeJson(request.cursor);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof DOMException) return null;
      throw error;
    }
    if (!isRecord(position) || position.filters !== filters || typeof position.offset !== 'number') return null;
    offset = position.offset;
  }
  const end = offset + request.limit;
  const hasMore = end < rows.length;
  return {
    data: rows.slice(offset, end),
    page: {
      limit: request.limit,
      next_cursor: hasMore ? encodeJson({ offset: end, filters }) : null,
      has_more: hasMore,
    },
  };
}

// Domains (19 section 3.4, DomainInput).

export const MATCH_SCOPES = ['path_prefix', 'host', 'registrable'] as const;
export type MatchScope = (typeof MATCH_SCOPES)[number];
const MAX_DOMAIN_INPUT = 2048;
const MAX_PATH_PREFIX = 512;

/** The canonical host of a domain the API accepts (a host or an http(s) URL), or `null`. */
export function canonicalHost(raw: string): string | null {
  const normalized = normalizeDomain(raw);
  return normalized.ok ? normalized.domain : null;
}

/** The errors of a text that should hold a host or URL, at `path`. */
export function domainTextError(value: unknown, path: string): ValidationItem[] {
  const shape = textError(value, path, { max: MAX_DOMAIN_INPUT });
  if (shape.length > 0 || value === undefined) return shape;
  return typeof value === 'string' && canonicalHost(value) === null
    ? [bodyError(path, 'invalid_domain', 'Not a host name or an http(s) URL.')]
    : [];
}

/** A path prefix as the canonicalizer writes it (`/@acme/` is `/@acme`), or `null` for one with a query or fragment. */
function canonicalPathPrefix(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.includes('?') || trimmed.includes('#')) return null;
  const rooted = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutSlash = rooted.replace(/\/+$/, '');
  return withoutSlash === '' ? '/' : withoutSlash;
}

export interface DomainValues {
  host: string;
  match_scope: MatchScope;
  path_prefix: string | null;
}

/** A `DomainInput` at `prefix`, canonicalized, or its errors. */
export function domainInput(value: unknown, prefix: string): DomainValues | ValidationItem[] {
  if (!isRecord(value)) return [notAnObject(prefix)];
  const errors = [
    ...extraMembers(value, ['domain', 'match_scope', 'path_prefix'], prefix),
    ...(value.domain === undefined ? [bodyError(at(prefix, 'domain'), 'missing', 'Field required')] : []),
    ...domainTextError(value.domain, at(prefix, 'domain')),
    ...enumError(value.match_scope, at(prefix, 'match_scope'), MATCH_SCOPES),
  ];
  const rawPrefix = value.path_prefix ?? null;
  let pathPrefix: string | null = null;
  if (rawPrefix !== null) {
    const shape = textError(rawPrefix, at(prefix, 'path_prefix'), { max: MAX_PATH_PREFIX });
    errors.push(...shape);
    if (shape.length === 0 && typeof rawPrefix === 'string') {
      pathPrefix = canonicalPathPrefix(rawPrefix);
      if (pathPrefix === null) {
        errors.push(
          bodyError(
            at(prefix, 'path_prefix'),
            'invalid_path_prefix',
            'A path prefix is a path with no query or fragment.',
          ),
        );
      }
    }
  }
  if (errors.length > 0) return errors;
  const host = typeof value.domain === 'string' ? canonicalHost(value.domain) : null;
  if (host === null) return [bodyError(at(prefix, 'domain'), 'invalid_domain', 'Not a host name or an http(s) URL.')];
  const scope: MatchScope = isOneOf(value.match_scope, MATCH_SCOPES) ? value.match_scope : 'registrable';
  // Model-level rules report at the input itself, as Pydantic's model validators do
  if ((scope === 'path_prefix') !== (rawPrefix !== null)) {
    return [
      bodyError(prefix, 'path_prefix_mismatch', 'Give `path_prefix` exactly when `match_scope` is `path_prefix`.'),
    ];
  }
  if (scope === 'registrable' && isPublicSuffix(host)) {
    return [
      bodyError(prefix, 'domain_is_public_suffix', 'A public suffix is shared by many sites; name a host under it.'),
    ];
  }
  return { host, match_scope: scope, path_prefix: pathPrefix };
}

// Aliases (19 section 3.4, AliasInput).

export const MATCH_MODES = ['word_boundary', 'exact_case', 'substring', 'regex'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];
const MAX_ALIAS = 200;
const LANGUAGE = /^[a-z]{2}$/;

export interface AliasValues {
  alias: string;
  match_mode: MatchMode;
  case_sensitive: boolean;
  language_code: string | null;
  is_negative: boolean;
  requires_context: boolean;
}

/**
 * Whether the browser can compile a regex alias. The API compiles it with RE2, which also refuses
 * backreferences, lookaround and very large programs; the mock refuses only what `RegExp` cannot compile.
 */
export function compiles(pattern: string, caseSensitive: boolean): boolean {
  try {
    new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

/** The errors of the alias members present in `value` (all of them optional here), at `prefix`. */
export function aliasMemberErrors(value: Readonly<Record<string, unknown>>, prefix: string): ValidationItem[] {
  const language = value.language_code;
  return [
    ...textError(value.alias, at(prefix, 'alias'), { max: MAX_ALIAS }),
    ...enumError(value.match_mode, at(prefix, 'match_mode'), MATCH_MODES),
    ...booleanError(value.case_sensitive, at(prefix, 'case_sensitive')),
    ...booleanError(value.is_negative, at(prefix, 'is_negative')),
    ...booleanError(value.requires_context, at(prefix, 'requires_context')),
    ...(language === undefined || language === null || (typeof language === 'string' && LANGUAGE.test(language))
      ? []
      : [bodyError(at(prefix, 'language_code'), 'string_pattern_mismatch', 'A language code such as en.')]),
  ];
}

/**
 * The text an alias is stored with: a word alias is trimmed and must keep a character, a pattern is kept as
 * written and must compile. The error reports at the input, as the API's model validator does.
 */
export function aliasShape(
  alias: string,
  mode: MatchMode,
  caseSensitive: boolean,
  prefix: string,
): string | ValidationItem {
  if (mode === 'regex') {
    return compiles(alias, caseSensitive)
      ? alias
      : bodyError(prefix, 'invalid_regex', 'RE2 cannot compile this pattern (doc 13 stage 4).');
  }
  const trimmed = alias.trim();
  return trimmed === '' ? bodyError(prefix, 'string_too_short', 'An alias has at least one character.') : trimmed;
}

/** An `AliasInput` at `prefix` with its defaults, or its errors. */
export function aliasInput(value: unknown, prefix: string): AliasValues | ValidationItem[] {
  if (!isRecord(value)) return [notAnObject(prefix)];
  const errors = [
    ...extraMembers(
      value,
      ['alias', 'match_mode', 'case_sensitive', 'language_code', 'is_negative', 'requires_context'],
      prefix,
    ),
    ...(value.alias === undefined ? [bodyError(at(prefix, 'alias'), 'missing', 'Field required')] : []),
    ...aliasMemberErrors(value, prefix),
  ];
  if (errors.length > 0 || typeof value.alias !== 'string') return errors;
  const mode: MatchMode = isOneOf(value.match_mode, MATCH_MODES) ? value.match_mode : 'word_boundary';
  const caseSensitive = value.case_sensitive === true;
  const shaped = aliasShape(value.alias, mode, caseSensitive, prefix);
  if (typeof shaped !== 'string') return [shaped];
  return {
    alias: shaped,
    match_mode: mode,
    case_sensitive: caseSensitive,
    language_code: typeof value.language_code === 'string' ? value.language_code : null,
    is_negative: value.is_negative === true,
    requires_context: value.requires_context === true,
  };
}

/**
 * Whether two aliases of one entity are the same: an alias that ignores case is a duplicate in any case
 * (19 section 3.4, as built).
 */
export const sameAlias = (
  a: { alias: string; case_sensitive: boolean },
  b: { alias: string; case_sensitive: boolean },
): boolean =>
  a.case_sensitive && b.case_sensitive ? a.alias === b.alias : a.alias.toLowerCase() === b.alias.toLowerCase();
