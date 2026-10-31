import type { Route } from 'next';

/**
 * The paths the app builds from data. Typed routes (next.config `typedRoutes`) check a literal path; one
 * built from a slug is a plain string to TypeScript, so it is typed here, once, the way the Next.js
 * documentation shows for dynamic strings. Slugs are lower-case letters, digits and hyphens (the API
 * refuses anything else), and are encoded all the same.
 */

/**
 * Whether `value` can be a workspace or project slug at all: lower-case letters, digits and hyphens, as the
 * API allows (19-api-specification.md, Slugs). Anything else (`favicon.ico`, a path the proxy does not see) is a 404 before
 * the page reads its session or its headers.
 */
export const isSlugShaped = (value: string): boolean => /^[a-z0-9-]+$/.test(value);

/** Whether `value` is a UUID as the API writes ids in paths: hyphenated, in either case. */
export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The root of a workspace. */
export const workspacePath = (slug: string): Route => `/${encodeURIComponent(slug)}` as Route;

/** Where a platform operator creates a workspace (`new` is a reserved workspace slug). */
export const NEW_WORKSPACE_PATH: Route = '/new';

/** The new-project page of a workspace (20 section 5.1). */
export const onboardingPath = (workspace: string): Route => `/${encodeURIComponent(workspace)}/onboarding` as Route;

/** A page of a project: its root, or `rest` below it (`/settings/profile`). */
export const projectPath = (workspace: string, project: string, rest: '' | `/${string}` = ''): Route =>
  `/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}${rest}` as Route;

/** SEO > Keywords of a project. */
export const rankingsPath = (workspace: string, project: string): Route =>
  projectPath(workspace, project, '/seo/keywords');

/** The import dialog over Keywords: its own route, so a link or the Back button opens and closes it. */
export const rankingsImportPath = (workspace: string, project: string): Route =>
  projectPath(workspace, project, '/seo/keywords/import');

/** `path` with the query string `query` (without its `?`) kept, as when a dialog opens over a filtered page. */
export const withQuery = (path: Route, query: string): Route => (query === '' ? path : (`${path}?${query}` as Route));

/**
 * Costs (11-navigation.md section 1): the page of `project` inside the project shell, which shows the
 * whole workspace's spend. Without a project (a member who can open none) the workspace's own page, in the
 * workspace shell.
 */
export const costsPath = (workspace: string, project?: string | undefined): Route =>
  project === undefined
    ? (`/${encodeURIComponent(workspace)}/costs` as Route)
    : projectPath(workspace, project, '/costs');

/**
 * Operations > Runs of `project`, inside the project shell. Without a project (a member who can open none)
 * the workspace's own page, which says there is nothing to show.
 */
export const runsPath = (workspace: string, project?: string | undefined): Route =>
  project === undefined
    ? (`/${encodeURIComponent(workspace)}/ops/runs` as Route)
    : projectPath(workspace, project, '/ops/runs');

/**
 * The query string (without its `?`) of a page's `searchParams`, for a redirect that keeps what the person
 * had chosen: every key in its order, a repeated key repeated, except the keys in `omit`.
 */
export function queryOf(
  searchParams: Readonly<Record<string, string | readonly string[] | undefined>>,
  omit: readonly string[] = [],
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || omit.includes(key)) continue;
    for (const item of typeof value === 'string' ? [value] : value) query.append(key, item);
  }
  return query.toString();
}

/** The sections of Settings that exist outside any project: the account's and the workspace's. */
export type WorkspaceSettingsSection = 'profile' | 'security' | 'preferences' | 'workspace' | 'members';

/**
 * A section of Settings outside any project, reachable from the workspace page and when the member can
 * open no project (11-navigation.md section 5).
 */
export const workspaceSettingsPath = (workspace: string, section: WorkspaceSettingsSection): Route =>
  `/${encodeURIComponent(workspace)}/settings/${section}` as Route;

/** The sign-in page. */
export const SIGN_IN_PATH: Route = '/login';

/** The sign-in page, told to come back to `path` (a path of this app, from the request being rendered). */
export const signInPath = (path: string): Route => `${SIGN_IN_PATH}?next=${encodeURIComponent(path)}` as Route;

/** The request header in which the proxy hands a page render its own path and query (src/proxy.ts). */
export const PATHNAME_HEADER = 'x-pathname';

/** A path of this app read from one of its own links (a leave guard sends the person there afterwards). */
export const linkedPath = (url: URL): Route => `${url.pathname}${url.search}${url.hash}` as Route;
