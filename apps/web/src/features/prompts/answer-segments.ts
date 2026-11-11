/** What the cutting needs of a mention: the response's mentions fit it, whatever else they carry. */
interface Spanned {
  /** `[start, end)` pairs, as the API sends them; a payload is not checked on the way in, so they are read warily. */
  evidence_spans: readonly (readonly number[])[];
}

/** A piece of an answer, with the UTF-16 offset it starts at: plain, or a span a mention claims. */
export type AnswerSegment<M extends Spanned> =
  { kind: 'text'; start: number; text: string } | { kind: 'mention'; start: number; text: string; mention: M };

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** Whether `at` falls between the two halves of one character past U+FFFF (an emoji, say). */
const splitsCharacter = (text: string, at: number): boolean =>
  at > 0 && at < text.length && isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at));

/** A span is read as the pair of numbers it should be, or not at all. */
const isPair = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';

interface Span<M> {
  mention: M;
  start: number;
  end: number;
}

/**
 * The answer cut at the evidence spans of its mentions, in order. The spans are `[start, end)` in UTF-16 code
 * units of `answer_text`, as a JavaScript string indexes it: the API converts the code points it stores before
 * it answers (`offsets_unit: 'utf16'`), so they are used as they come and never converted here. A span outside
 * the text, an empty or fractional one, or one that would cut a character in two is left out rather than
 * trusted, and the text around it stays plain. Where spans overlap the earlier start wins, then the longer
 * span, then the mention that comes first in the list (the API lists the numbered mentions first); the others
 * stay in the list of mentions. Never throws, and the segments always add up to `text`.
 */
export function answerSegments<M extends Spanned>(text: string, mentions: readonly M[]): AnswerSegment<M>[] {
  const spans: Span<M>[] = mentions
    .flatMap((mention) =>
      (Array.isArray(mention.evidence_spans) ? mention.evidence_spans : [])
        .filter(isPair)
        .map(([start, end]) => ({ mention, start, end })),
    )
    .filter(
      ({ start, end }) =>
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end <= text.length &&
        start < end &&
        !splitsCharacter(text, start) &&
        !splitsCharacter(text, end),
    )
    // Array.prototype.sort is stable, so equal spans keep the order of the list
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: AnswerSegment<M>[] = [];
  let at = 0;
  for (const { mention, start, end } of spans) {
    if (start < at) continue;
    if (start > at) segments.push({ kind: 'text', start: at, text: text.slice(at, start) });
    segments.push({ kind: 'mention', start, text: text.slice(start, end), mention });
    at = end;
  }
  if (at < text.length) segments.push({ kind: 'text', start: at, text: text.slice(at) });
  return segments;
}
