import { createElement, Fragment, type ReactNode } from 'react';

const SEPARATOR = ' · ';

/**
 * The facts of the header's meta line, freshness first: "AI updated Nov 12, 02:10 · 250 prompts · 3 engines". A fact
 * that is not known (`null`) is left out and the rest keep their order; with none known there is no line. The
 * design system allows at most two middle dots (25 section 5.11), so the caller passes at most three facts. A fact
 * is a string, or an element (the freshness indicator); a line of strings is one string.
 */
export function metaLine(facts: readonly (string | null)[]): string | null;
export function metaLine(facts: readonly (ReactNode | null)[]): ReactNode | null;
export function metaLine(facts: readonly (ReactNode | null)[]): ReactNode | null {
  const known = facts.filter((fact): fact is NonNullable<ReactNode> => fact !== null);
  if (known.length === 0) return null;
  if (known.every((fact): fact is string => typeof fact === 'string')) return known.join(SEPARATOR);
  return createElement(Fragment, null, ...known.flatMap((fact, place) => (place === 0 ? [fact] : [SEPARATOR, fact])));
}
