import { reservedProjectSlugValues, reservedWorkspaceSlugValues } from '@/lib/api/schema';

/**
 * Workspace and project slugs as the API accepts them (19-api-specification.md, Slugs): 3 to 40 lower-case
 * letters, digits and hyphens, starting and ending with a letter or digit, not shaped like a uuid, and not
 * one of the words that are routes of the web app (the two reserved lists of the OpenAPI document).
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const SLUG_MAX_LENGTH = 40;

/** The API refuses a slug in the hyphenated uuid form only (it could be read as an id in a path). */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SlugKind = 'workspace' | 'project';

/** Why the API would refuse `slug`, by its field code, or `null` when it would take it. */
export type SlugProblem = 'string_pattern_mismatch' | 'slug_reserved' | 'slug_is_id';

const RESERVED: Readonly<Record<SlugKind, readonly string[]>> = {
  workspace: reservedWorkspaceSlugValues,
  project: reservedProjectSlugValues,
};

export function slugProblem(slug: string, kind: SlugKind): SlugProblem | null {
  if (!SLUG_PATTERN.test(slug)) return 'string_pattern_mismatch';
  if (UUID_SHAPE.test(slug)) return 'slug_is_id';
  if (RESERVED[kind].includes(slug)) return 'slug_reserved';
  return null;
}

/**
 * A slug suggested from a name: lower case, accents dropped, anything else a hyphen, hyphens never doubled
 * or at an end, at most 40 characters. It may still be refused (too short, reserved); the form says why.
 */
export function slugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/** The catalog key (namespace of the form) that says why a slug is refused. */
export type SlugMessageKey = 'slugInvalid' | 'slugReserved' | 'slugIsId';

export const slugMessageKey = (problem: SlugProblem): SlugMessageKey =>
  problem === 'slug_reserved' ? 'slugReserved' : problem === 'slug_is_id' ? 'slugIsId' : 'slugInvalid';
