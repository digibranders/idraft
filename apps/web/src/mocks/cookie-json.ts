import { cookieOf } from './session';
import type { z } from 'zod';

/**
 * What the mocks keep in a cookie as JSON: the workspace's changes (./workspace-state.ts) and the entities'
 * (./entities-state.ts). A cookie is read by the browser's worker and the server's MSW alike, so both see
 * the same state. The value is checked against its shape when read, and refused before it grows too large.
 */

/** UTF-8 JSON as base64url, so the value needs no escaping and decodes the same wherever it is read. */
export function encodeJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeJson(text: string): unknown {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
}

/**
 * The cookie `name` checked against `shape`, or `empty`: a cookie that is missing, of an older format or hand
 * edited is ignored, never trusted.
 */
export function readJsonCookie<T>(
  cookies: Readonly<Record<string, string>>,
  name: string,
  shape: z.ZodType<T>,
  empty: T,
): T {
  const raw = cookieOf(cookies, name);
  if (raw === undefined || raw === '') return empty;
  try {
    const parsed = shape.safeParse(decodeJson(raw));
    return parsed.success ? parsed.data : empty;
  } catch (error) {
    // Not base64url or not JSON: an older format of this cookie
    if (error instanceof SyntaxError || error instanceof DOMException) return empty;
    throw error;
  }
}

/** One year, like the other cookies of the mocks' memory. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
/** Browsers refuse a cookie over 4096 bytes and say nothing: the mocks fail loudly before that. */
export const MAX_COOKIE_BYTES = 3800;

/** The `Set-Cookie` that keeps `value` in cookie `name`. Throws when it no longer fits in a cookie. */
export function jsonCookie(name: string, value: unknown, what: string): string {
  const encoded = encodeJson(value);
  if (encoded.length > MAX_COOKIE_BYTES) {
    throw new Error(
      `The mock ${what} no longer fits in its cookie (${String(encoded.length)} bytes). Expire the ${name} cookie to start again from the fixtures.`,
    );
  }
  return `${name}=${encoded}; Path=/; Secure; SameSite=Lax; Max-Age=${String(MAX_AGE_SECONDS)}`;
}
