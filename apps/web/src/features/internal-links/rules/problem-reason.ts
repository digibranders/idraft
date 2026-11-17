import { isApiProblem } from '@/lib/api/problem';

/**
 * Why the API refused a request, in its own words: the first field error when it names one (a 422 puts the real
 * reason there and only a count in `detail`, "1 field is invalid."), else the detail, else the title. Empty for
 * anything that is not an answer of the API (a lost connection).
 */
export function reasonOf(error: unknown): string {
  if (!isApiProblem(error)) return '';
  const field = error.errors[0]?.message;
  if (field !== undefined && field.trim() !== '') return field;
  return error.detail ?? error.string('title') ?? '';
}
