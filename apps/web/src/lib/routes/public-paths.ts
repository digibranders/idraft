/**
 * The pages that work without a session: signing in, the second factor, password reset, email
 * verification and invitations (Task 11 of the web app foundation plan). The proxy of Task 10 lets them
 * through without the session cookie, and the query client does not send a person away from them when
 * the API answers that nobody is signed in: the page itself handles that answer.
 */
export const PUBLIC_PATHS = ['/login', '/two-factor', '/reset-password', '/verify-email', '/invite'] as const;

/** Whether `pathname` is one of the public pages or lies under one. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
