import type { FieldPath, FieldValues } from 'react-hook-form';

import { applyServerErrors, type ApplyServerErrorsOptions, type ValidationItem } from './apply-server-errors';
import { isApiProblem, type ApiProblem } from '@/lib/api/problem';

/**
 * Step 2 of 10-forms.md section 23: what a form does with a failed submit, decided by the problem's `code`.
 *
 * | Problem | Outcome |
 * |---|---|
 * | `422 validation_failed` | Field errors (step 1); the items no field renders are returned for a `FormAlert` |
 * | A code in the form's `codeToField` (`409 duplicate` on `slug`) | An error on that field, then as step 1 |
 * | A form-level code (`quota_exceeded`, `competitor_limit`, `budget_exceeded`, or the form's own) | `alert` |
 * | `409 conflict`, `412 precondition_failed` | `conflict`: the conflict dialog with "Reload" |
 * | `403 fresh_session_required` | `fresh-session`: re-authenticate, then retry once |
 * | Anything else, including an error that is not an `ApiProblem` | Rethrown for the route's error boundary |
 */

/** Codes that are about the whole form, with a limit and a way out (10-forms.md section 19). */
const FORM_LEVEL_CODES: readonly string[] = ['quota_exceeded', 'competitor_limit', 'budget_exceeded'];
const CONFLICT_CODES: ReadonlySet<string> = new Set(['conflict', 'precondition_failed']);

export type ProblemOutcome =
  /** Errors are on their fields; `unmatched` are the items no field renders, for a `FormAlert`. */
  | { kind: 'fields'; unmatched: readonly ValidationItem[] }
  /** A form-level problem: show it in a `FormAlert` with the limit and the way out. */
  | { kind: 'alert'; problem: ApiProblem }
  /** Someone else changed the record, or a row was locked: open the conflict dialog. */
  | { kind: 'conflict'; problem: ApiProblem }
  /** The action needs a fresh session: re-authenticate, then send the submit again once. */
  | { kind: 'fresh-session'; problem: ApiProblem };

export interface ApplyProblemOptions<TValues extends FieldValues> extends ApplyServerErrorsOptions<TValues> {
  /** Codes tied to one field of this form, such as `{ duplicate: 'slug' }`. */
  codeToField?: Readonly<Partial<Record<string, FieldPath<TValues>>>> | undefined;
  /** More codes this form shows as a whole-form alert, besides the shared ones. */
  alertCodes?: readonly string[] | undefined;
}

/**
 * Handles the error of a failed submit: puts field errors on their fields and says what else the form has to
 * show. Throws `error` again when it is not something a form handles, so the route's error boundary does.
 */
export function applyProblem<TValues extends FieldValues>(
  form: Parameters<typeof applyServerErrors<TValues>>[0],
  error: unknown,
  { codeToField = {}, alertCodes = [], ...options }: ApplyProblemOptions<TValues>,
): ProblemOutcome {
  if (!isApiProblem(error)) throw error;
  if (error.code === 'validation_failed') {
    return { kind: 'fields', unmatched: applyServerErrors(form, error.errors, options) };
  }
  const field = codeToField[error.code];
  if (field !== undefined) {
    const item: ValidationItem = {
      location: 'body',
      path: field,
      code: error.code,
      message: error.detail ?? error.message,
    };
    return { kind: 'fields', unmatched: applyServerErrors(form, [item], options) };
  }
  const formLevel = FORM_LEVEL_CODES.includes(error.code) || alertCodes.includes(error.code);
  if (formLevel) return { kind: 'alert', problem: error };
  if (CONFLICT_CODES.has(error.code)) return { kind: 'conflict', problem: error };
  if (error.code === 'fresh_session_required') return { kind: 'fresh-session', problem: error };
  throw error;
}
