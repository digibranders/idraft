const SEPARATOR = ' · ';

/**
 * The facts of the header's meta line, freshness first: "AI updated Nov 12, 02:10 · 250 prompts · 3 engines". A fact
 * that is not known (`null`) is left out and the rest keep their order; with none known there is no line. The
 * design system allows at most two middle dots (25 section 5.11), so the caller passes at most three facts.
 */
export function metaLine(facts: readonly (string | null)[]): string | null {
  const known = facts.filter((fact): fact is string => fact !== null);
  return known.length === 0 ? null : known.join(SEPARATOR);
}
