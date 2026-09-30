/** A page's search parameters, as Next.js hands them to a page. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a search parameter: `?next=a&next=b` is `a`, as a browser's `URLSearchParams.get` reads it. */
export const firstParam = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' ? value : (value?.[0] ?? null);
