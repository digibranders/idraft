import { MIN_PASSWORD_LENGTH } from './rules';
import { isApiProblem } from '@/lib/api/problem';

/** The translator of the `auth` namespace, as the auth forms receive it from `useTranslations('auth')`. */
export type AuthTranslator = (key: AuthMessageKey, values?: Record<string, string | number>) => string;

/** The keys the helpers here read. */
export type AuthMessageKey =
  | 'problems.rateLimited'
  | 'problems.serviceUnavailable'
  | 'problems.unexpected'
  | 'weakPassword.tooShort'
  | 'weakPassword.tooLong'
  | 'weakPassword.containsEmail'
  | 'weakPassword.breached'
  | 'weakPassword.unchanged'
  | 'weakPassword.other';

const SECONDS_PER_MINUTE = 60;

/** The wait of a `429 rate_limited`, in whole minutes, at least one. */
export function retryMinutes(error: { retryAfterSeconds: number | null }): number {
  return Math.max(1, Math.ceil((error.retryAfterSeconds ?? SECONDS_PER_MINUTE) / SECONDS_PER_MINUTE));
}

/**
 * The sentence a form shows in its `FormAlert` for a failed request (19 section 2.7). `known` maps the codes
 * the form expects to its own copy, and wins over the general handling. A lock gives the wait in whole
 * minutes; an unknown problem, or a request that got no answer, gives the general message, never the API's
 * English `detail`.
 */
export function alertMessage(error: unknown, t: AuthTranslator, known: Readonly<Record<string, string>> = {}): string {
  if (!isApiProblem(error)) return t('problems.unexpected');
  const own = known[error.code];
  if (own !== undefined) return own;
  if (error.code === 'rate_limited') return t('problems.rateLimited', { minutes: retryMinutes(error) });
  if (error.code === 'service_unavailable') return t('problems.serviceUnavailable');
  return t('problems.unexpected');
}

const WEAK_PASSWORD_KEYS: Readonly<Record<string, AuthMessageKey>> = {
  too_short: 'weakPassword.tooShort',
  too_long: 'weakPassword.tooLong',
  contains_email: 'weakPassword.containsEmail',
  breached: 'weakPassword.breached',
  unchanged: 'weakPassword.unchanged',
};

/** The message for a `422 weak_password` on the password field, by its `reason`, or `null` for another problem. */
export function weakPasswordMessage(error: unknown, t: AuthTranslator): string | null {
  if (!isApiProblem(error, 'weak_password')) return null;
  return t(WEAK_PASSWORD_KEYS[error.string('reason') ?? ''] ?? 'weakPassword.other', { min: MIN_PASSWORD_LENGTH });
}
