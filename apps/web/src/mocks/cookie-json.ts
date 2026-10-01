import { cookieOf } from './session';
import type { z } from 'zod';

/**
 * What the mocks keep in a cookie as JSON: the workspace's changes (./workspace-state.ts) and the entities'
 * (./entities-state.ts). A cookie is read by the browser's worker and the server's MSW alike, so both see
 * the same state. The value is checked against its shape when read, and refused before it grows too large.
 *
 * JSON is written in a cookie-safe form rather than base64, which costs a third more: the four JSON
 * characters a cookie value cannot hold become others (`"` `'`, `,` `!`, `\` `*`, space `_`), and every
 * character those could be confused with, or that is not printable ASCII, is written as a JSON `\uXXXX`
 * escape first. Nothing is percent-encoded, so a layer that decodes cookies changes nothing.
 */

const TO_COOKIE: Readonly<Record<string, string>> = { '"': "'", ',': '!', '\\': '*', ' ': '_' };
const FROM_COOKIE: Readonly<Record<string, string>> = { "'": '"', '!': ',', '*': '\\', _: ' ' };
/** Characters that only occur inside JSON strings and would clash with the mapping or the cookie syntax. */
const ESCAPED = /['!*_;%~\u007f-￿]/g;

const unicodeEscape = (char: string): string => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;

function encodeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(ESCAPED, unicodeEscape)
    .replace(/["\\, ]/g, (char) => TO_COOKIE[char] ?? char);
}

function decodeJson(text: string): unknown {
  return JSON.parse(text.replace(/['!*_]/g, (char) => FROM_COOKIE[char] ?? char));
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
    // Not JSON: an older format of this cookie
    if (error instanceof SyntaxError) return empty;
    throw error;
  }
}

/** One year, like the other cookies of the mocks' memory. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
/** Browsers refuse a cookie over 4096 bytes and say nothing: the mocks refuse before that. */
const MAX_COOKIE_BYTES = 3800;

/** The `Set-Cookie` that keeps `value` in cookie `name`, or `null` when it no longer fits in a cookie. */
export function jsonCookie(name: string, value: unknown): string | null {
  const encoded = encodeJson(value);
  if (encoded.length > MAX_COOKIE_BYTES) return null;
  return `${name}=${encoded}; Path=/; Secure; SameSite=Lax; Max-Age=${String(MAX_AGE_SECONDS)}`;
}
