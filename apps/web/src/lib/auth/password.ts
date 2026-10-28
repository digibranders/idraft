import { isApiProblem } from '@/lib/api/problem';

/**
 * What the API asks of a new password (19 section 3.1), for every form that sets one: registration by
 * invitation, reset, and the change in Settings > Security. A shorter one is `422 weak_password` with the
 * reason `too_short`.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** The catalog keys (namespace `auth`) for the reasons of a `422 weak_password`. */
export type WeakPasswordKey =
  | 'weakPassword.tooShort'
  | 'weakPassword.tooLong'
  | 'weakPassword.containsEmail'
  | 'weakPassword.breached'
  | 'weakPassword.unchanged'
  | 'weakPassword.other';

const WEAK_PASSWORD_KEYS: Readonly<Record<string, WeakPasswordKey>> = {
  too_short: 'weakPassword.tooShort',
  too_long: 'weakPassword.tooLong',
  contains_email: 'weakPassword.containsEmail',
  breached: 'weakPassword.breached',
  unchanged: 'weakPassword.unchanged',
};

/**
 * The catalog key for a `422 weak_password` by its `reason` (a reason this app does not know yet gets the
 * general sentence), or `null` for any other error. Its message takes `min`, the length above.
 */
export function weakPasswordKey(error: unknown): WeakPasswordKey | null {
  if (!isApiProblem(error, 'weak_password')) return null;
  return WEAK_PASSWORD_KEYS[error.string('reason') ?? ''] ?? 'weakPassword.other';
}
