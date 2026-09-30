import type { Route } from 'next';

/**
 * The paths the app builds from data. Typed routes (next.config `typedRoutes`) check a literal path; one
 * built from a slug is a plain string to TypeScript, so it is typed here, once, the way the Next.js
 * documentation shows for dynamic strings. Slugs are lower-case letters, digits and hyphens (the API
 * refuses anything else), and are encoded all the same.
 */

/** The root of a workspace. */
export const workspacePath = (slug: string): Route => `/${encodeURIComponent(slug)}` as Route;

/** A page of a project: its root, or `rest` below it (`/settings/profile`). */
export const projectPath = (workspace: string, project: string, rest: '' | `/${string}` = ''): Route =>
  `/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}${rest}` as Route;

/** The sign-in page, told to come back to `path` (a path of this app, from the request being rendered). */
export const signInPath = (path: string): Route => `/login?next=${encodeURIComponent(path)}` as Route;

/** The request header in which the proxy hands a page render its own path and query (src/proxy.ts). */
export const PATHNAME_HEADER = 'x-pathname';

/** A path of this app read from one of its own links (a leave guard sends the person there afterwards). */
export const linkedPath = (url: URL): Route => `${url.pathname}${url.search}${url.hash}` as Route;
