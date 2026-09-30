import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';

/** One entry of `errors[]` in a `422 validation_failed` problem (19-api-specification.md section 2.7). */
export interface ValidationItem {
  location: 'body' | 'query' | 'path' | 'header';
  /** A dot path into that location: `email`, `profile.name`, `items.3.keyword`. */
  path: string;
  /** The type of the validation error, such as `string_too_long` or `slug_reserved`. */
  code: string;
  message: string;
}

export interface ApplyServerErrorsOptions<TValues extends FieldValues> {
  /**
   * The names of the fields the form renders, as given to `FormField`. An item whose path is one of them,
   * or lies under one (`items.3.keyword` under `items`), is shown on that field. Every other item is
   * returned. A form that renders array rows as fields of their own lists those names (`items.3.keyword`).
   */
  fields: readonly FieldPath<TValues>[];
  /** Client copy by error code. An item whose code is not listed shows the message of the server. */
  messages?: Readonly<Partial<Record<string, string>>> | undefined;
}

const isUnder = (path: string, field: string): boolean => path === field || path.startsWith(`${field}.`);

/** The field an item belongs to: the one with its exact path, or the longest one its path lies under. */
function fieldOf<TValues extends FieldValues>(
  path: string,
  fields: readonly FieldPath<TValues>[],
): FieldPath<TValues> | undefined {
  return fields.filter((field) => isUnder(path, field)).sort((a, b) => b.length - a.length)[0];
}

/**
 * Puts the validation errors of a response on the fields they belong to (10-forms.md section 23). Field
 * names equal the paths of the request body, so no translation table is needed. An error for a path under
 * a field (`items.3.keyword` when the form renders `items` as one field) is shown on that field, since
 * nothing renders the deeper path. A field shows the first error it gets. Focus moves to the first field
 * that got an error, and the error clears when the user changes that field.
 *
 * Returns the items that belong to no field of this form: errors of the query string or a header, and body
 * paths the form does not render. The form shows those in a `FormAlert` instead of dropping them.
 */
export function applyServerErrors<TValues extends FieldValues>(
  form: { setError: UseFormSetError<TValues> },
  items: readonly ValidationItem[],
  { fields, messages = {} }: ApplyServerErrorsOptions<TValues>,
): ValidationItem[] {
  const unmatched: ValidationItem[] = [];
  const shown = new Set<string>();
  for (const item of items) {
    const field = item.location === 'body' ? fieldOf(item.path, fields) : undefined;
    if (field === undefined) {
      unmatched.push(item);
      continue;
    }
    if (shown.has(field)) continue;
    form.setError(
      field,
      { type: 'server', message: messages[item.code] ?? item.message },
      { shouldFocus: shown.size === 0 },
    );
    shown.add(field);
  }
  return unmatched;
}
