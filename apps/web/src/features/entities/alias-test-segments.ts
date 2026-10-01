import type { components } from '@/lib/api/schema';

export type AliasTestResult = components['schemas']['AliasTestResult'];
type Mention = AliasTestResult['mentions'][number];
type Span = Mention['spans'][number];

/** A piece of the tested text, with the offset it starts at: plain, or a span a mention claims. */
export type Segment =
  | { kind: 'text'; start: number; text: string }
  | { kind: 'mention'; start: number; text: string; mention: Mention; span: Span };

/**
 * The tested text cut at the spans that count, in order. Discarded spans stay plain text, as extraction
 * does not count them. Offsets are UTF-16 code units, as a JavaScript string indexes them; a span that
 * overlaps an earlier one or falls outside the text is left out rather than trusted.
 */
export function segmentsOf(text: string, mentions: readonly Mention[]): Segment[] {
  const spans = mentions
    .flatMap((mention) => mention.spans.map((span) => ({ mention, span })))
    .filter(
      ({ span }) => span.status !== 'discarded' && span.start >= 0 && span.end <= text.length && span.start < span.end,
    )
    .sort((a, b) => a.span.start - b.span.start);
  const segments: Segment[] = [];
  let at = 0;
  for (const { mention, span } of spans) {
    if (span.start < at) continue;
    if (span.start > at) segments.push({ kind: 'text', start: at, text: text.slice(at, span.start) });
    segments.push({ kind: 'mention', start: span.start, text: text.slice(span.start, span.end), mention, span });
    at = span.end;
  }
  if (at < text.length) segments.push({ kind: 'text', start: at, text: text.slice(at) });
  return segments;
}

/** How many mentions count, how many are uncertain, and how many matches a negative alias dropped. */
export function countsOf(result: AliasTestResult): { accepted: number; uncertain: number; dropped: number } {
  return {
    accepted: result.mentions.filter((mention) => mention.status === 'accepted').length,
    uncertain: result.mentions.filter((mention) => mention.status === 'uncertain').length,
    dropped: result.negatives_applied.length,
  };
}
