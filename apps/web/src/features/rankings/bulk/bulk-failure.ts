/** A bulk change that was not made, with the words the person reads about it. */
export class BulkFailure extends Error {
  override name = 'BulkFailure';
}

/** What a dialog says about a failure: its own words, or `fallback` for anything else. */
export const failureText = (error: unknown, fallback: string): string =>
  error instanceof BulkFailure ? error.message : fallback;
