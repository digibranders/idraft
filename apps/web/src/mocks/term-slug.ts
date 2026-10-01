/** The longest slug a term may have (19 section 3.5, TermInput). */
export const MAX_SLUG = 100;

/** A slug made from a name: lower case ASCII letters and digits joined by hyphens. */
export function termSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
  return slug === '' ? 'term' : slug;
}
