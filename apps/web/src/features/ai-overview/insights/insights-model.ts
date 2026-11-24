import { addDays, monthStart, type BusinessDate } from '@/components/app/date-range/business-date';

/** The lines of the Insights box, in the order it shows them (plan 2026-11-24-opportunities-feed). */
export const INSIGHT_KEYS = ['untracked', 'gaps', 'citingCompetitors', 'newDomains'] as const;
export type InsightKey = (typeof INSIGHT_KEYS)[number];

/** A count; `atLeast` when the read was cut at its page size, so the number is a floor and is shown with a plus. */
export interface InsightCount {
  count: number;
  atLeast: boolean;
}

/** The window of "citing competitors", in days: the Overview's default window. */
export const RECENT_DAYS = 28;

/** The month of the "new domains" line and the last days of the "citing competitors" line, ending today. */
export function insightWindows(today: BusinessDate): {
  month: { from: BusinessDate; to: BusinessDate };
  recent: { from: BusinessDate; to: BusinessDate };
} {
  return {
    month: { from: monthStart(today), to: today },
    recent: { from: addDays(today, 1 - RECENT_DAYS), to: today },
  };
}

/** A prompt or keyword as two of them are compared: lower case, one space between words, no closing question mark. */
export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\?+$/, '');
}

/**
 * Keywords whose latest check shows a Google AI Overview and that no prompt has as its text.
 * shortcut: an exact match on the normalized text, over at most one page of each list, until the API counts it
 * (backend request 25); `moreKeywords` and `morePrompts` mark a list that was cut, which makes the number a floor
 * (cut keywords) or unknown, a floor of 0 (cut prompts, which could hide a match).
 */
export function untrackedCount(
  keywords: readonly string[],
  prompts: readonly string[],
  { moreKeywords, morePrompts }: { moreKeywords: boolean; morePrompts: boolean },
): InsightCount {
  // Prompts that did not all load could match any keyword: nothing true can be said, which is a floor of zero
  if (morePrompts) return { count: 0, atLeast: true };
  const tracked = new Set(prompts.map(normalizeText));
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const text = normalizeText(keyword);
    if (!tracked.has(text)) seen.add(text);
  }
  return { count: seen.size, atLeast: moreKeywords };
}

interface DomainWithCitedWith {
  cited_with?: { entity_id: string } | null | undefined;
}

/**
 * Cited domains of other sites whose answers most name a tracked competitor.
 * shortcut: counted in the first page of the most cited domains; `more` makes the number a floor (request 26).
 */
export function citingCompetitorsCount(
  rows: readonly DomainWithCitedWith[],
  competitorIds: ReadonlySet<string>,
  more: boolean,
): InsightCount {
  const count = rows.filter(
    (row) => row.cited_with !== undefined && row.cited_with !== null && competitorIds.has(row.cited_with.entity_id),
  ).length;
  return { count, atLeast: more };
}

/** A count that is only a floor, and a floor of 0 says nothing: the box must not claim there is nothing to do. */
export const isUnknown = (count: InsightCount | undefined): boolean =>
  count !== undefined && count.atLeast && count.count === 0;

/** The lines with something to act on, in order; a line still loading or failed is not among them. */
export function openLines<T extends { count: number }>(
  lines: Readonly<Record<InsightKey, T | undefined>>,
): InsightKey[] {
  return INSIGHT_KEYS.filter((key) => (lines[key]?.count ?? 0) > 0);
}
