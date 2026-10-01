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
