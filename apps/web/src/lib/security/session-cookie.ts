/**
 * The name of the session cookie the API sets (backend auth/dependencies.py). `__Host-` binds it to this
 * origin: Secure, `Path=/`, no Domain. The app never reads its value; the proxy only checks that it is
 * there, and the API decides whether the session is valid.
 */
export const SESSION_COOKIE = '__Host-session';
